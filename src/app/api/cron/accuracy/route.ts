// ============================================================
// SIGNAL - Accuracy Scoring Cron
// ============================================================
// Runs after market close to score the morning briefing.
// Claude reviews what actually happened vs what was predicted.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getBriefingByDate, storeAccuracy } from "@/lib/briefing-store";

export const maxDuration = 300;

const MODEL = process.env.BRIEFING_MODEL || "claude-sonnet-4-6";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const today = new Date().toISOString().split("T")[0];
  const briefing = await getBriefingByDate(today);

  if (!briefing) {
    return NextResponse.json({ error: "No briefing found for today" }, { status: 404 });
  }

  if (briefing.accuracy) {
    return NextResponse.json({ message: "Already scored", score: briefing.accuracy.overallScore });
  }

  try {
    const requestBody = {
      model: MODEL,
      max_tokens: 4096,
      stream: true,
      system: `You are SIGNAL's accuracy scoring system. Your job is to compare a morning market briefing's predictions against what actually happened in the market today. Be objective and precise.

Score each prediction and scenario. For the overall score:
- 90-100: Exceptional — nearly all predictions correct, market direction called perfectly
- 70-89: Good — most major calls correct, minor misses
- 50-69: Mixed — some hits, some misses
- 30-49: Poor — more wrong than right
- 0-29: Bad — significantly off base

Return your assessment as JSON wrapped in <json> tags:
<json>{
  "marketConditionCorrect": true/false,
  "scenarioOutcomes": [
    {
      "event": "Event name from the briefing",
      "predictedCondition": "What the briefing said would happen",
      "actualOutcome": "What actually happened",
      "accurate": true/false
    }
  ],
  "overallScore": 75,
  "notes": "Brief summary of accuracy"
}</json>`,
      messages: [
        {
          role: "user",
          content: `Here is this morning's briefing to score:

Market Condition Called: ${briefing.marketCondition}
Summary: ${briefing.summary}

Sections:
${briefing.sections.map((s) => `- ${s.title}: ${s.content}`).join("\n")}

Scenarios:
${briefing.scenarios.map((s) => `- ${s.event}: ${s.scenarios.map((sc) => sc.condition + " -> " + sc.implication).join("; ")}`).join("\n")}

Search for what actually happened in markets today and score the accuracy of these predictions.`,
        },
      ],
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
        },
      ],
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `API error: ${response.status}`, detail: err }, { status: 502 });
    }

    // Read SSE stream
    const reader = response.body?.getReader();
    if (!reader) return NextResponse.json({ error: "No stream" }, { status: 502 });

    const decoder = new TextDecoder();
    let textContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            textContent += event.delta.text;
          }
        } catch { /* skip */ }
      }
    }

    const jsonMatch = textContent.match(/<json>([\s\S]*?)<\/json>/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse accuracy response" }, { status: 500 });
    }

    const accuracyData = JSON.parse(jsonMatch[1]);
    const accuracy = {
      scoredAt: new Date().toISOString(),
      ...accuracyData,
    };

    await storeAccuracy(today, accuracy);

    return NextResponse.json({ success: true, score: accuracy.overallScore });
  } catch (error) {
    return NextResponse.json(
      { error: `Accuracy scoring error: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
