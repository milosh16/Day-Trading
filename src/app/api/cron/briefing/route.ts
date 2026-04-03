// ============================================================
// SIGNAL - Scheduled Briefing Generation (Cron)
// ============================================================
// Triggered by Vercel Cron to generate daily briefings.
// Uses Opus when on Pro plan (300s timeout), Sonnet on Hobby.
// Stores result in Vercel KV for instant loading.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { storeBriefing, getLatestRegime, type StoredBriefing } from "@/lib/briefing-store";

export const maxDuration = 300; // 5 min — works on Pro plan

// Use Opus in prod (Pro plan), Sonnet in testing (Hobby)
const MODEL = process.env.BRIEFING_MODEL || "claude-opus-4-6";

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized triggers
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Accept API key from env (Vercel) or header (GitHub Actions caller)
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get("x-anthropic-key");
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const dateKey = now.toISOString().split("T")[0]; // YYYY-MM-DD

  try {
    // Load today's regime assessment and leading indicators if available (regime cron runs first)
    let regimeContext = "";
    try {
      const regime = await getLatestRegime();
      if (regime && typeof regime.regimePrompt === "string") {
        regimeContext = `\n\n--- REGIME ASSESSMENT (auto-generated) ---\n${regime.regimePrompt}\n--- END REGIME ASSESSMENT ---`;
      }
      if (regime && typeof regime.indicatorPrompt === "string") {
        regimeContext += `\n\n--- LEADING INDICATORS (multi-day trends) ---\n${regime.indicatorPrompt}\n--- END LEADING INDICATORS ---`;
      }
      if (regimeContext) {
        regimeContext += `\n\nIncorporate both the regime assessment AND multi-day leading indicators into your briefing. Reference the regime type, key factors, sector tilts, and any detected patterns (stress accumulation, credit stress, oversold bounce setups, etc.) in your analysis. Leading indicator patterns are especially important — they show what is BUILDING over days/weeks.`;
      }
    } catch { /* regime not available, proceed without */ }

    const requestBody = {
      model: MODEL,
      max_tokens: MODEL.includes("opus") ? 8192 : 4096,
      stream: true,
      system: `You are SIGNAL, an AI trading intelligence system. Today is ${dateStr}. Generate a comprehensive morning market briefing by searching for current market data. Be factual and concise. Do not use emojis.${regimeContext}

You MUST use the web_search tool to find current, real-time market data. Search for multiple topics to build a complete picture.

Return your briefing as a JSON object with this exact structure:
{
  "summary": "2-3 sentence market overview",
  "marketCondition": "bullish" | "bearish" | "neutral" | "volatile",
  "sections": [
    { "title": "Section Title", "content": "Detailed content...", "importance": "high" | "medium" | "low" }
  ],
  "scenarios": [
    {
      "event": "Event name",
      "scenarios": [
        { "condition": "If X happens...", "implication": "Then Y...", "trade": "Consider Z..." }
      ]
    }
  ]
}

Sections to include:
1. Index Futures & Overnight Moves (importance: high)
2. Economic Calendar & Earnings (importance: high if major events, medium otherwise)
3. VIX / Yields / Dollar / Commodities / Crypto (importance: medium)
4. Sector Sentiment (importance: medium)
5. Breaking News & Key Developments (importance: high if significant)
6. Prediction Market Signals (importance: medium)

For EVERY high-importance event today, provide scenario analysis with at least 2 scenarios.

IMPORTANT: Wrap your final JSON in <json> tags like this: <json>{"summary": ...}</json>`,
      messages: [
        {
          role: "user",
          content: "Generate today's morning market briefing. Search for current market data, futures, economic calendar, earnings, VIX, yields, dollar index, commodities, crypto, sector performance, breaking news, and prediction market odds for key events.",
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
      return NextResponse.json(
        { error: `Anthropic API error: ${response.status}`, detail: err },
        { status: 502 }
      );
    }

    // Read SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: "No response stream" }, { status: 502 });
    }

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

    // Parse the briefing JSON
    const jsonMatch = textContent.match(/<json>([\s\S]*?)<\/json>/);
    let briefingData;
    try {
      if (jsonMatch) {
        briefingData = JSON.parse(jsonMatch[1]);
      } else {
        const jsonStart = textContent.indexOf("{");
        const jsonEnd = textContent.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          briefingData = JSON.parse(textContent.slice(jsonStart, jsonEnd + 1));
        } else {
          return NextResponse.json(
            { error: "Could not parse briefing", raw: textContent.slice(0, 500) },
            { status: 500 }
          );
        }
      }
    } catch {
      return NextResponse.json(
        { error: "Failed to parse briefing JSON", raw: textContent.slice(0, 500) },
        { status: 500 }
      );
    }

    // Attach regime metadata if available
    let regimeType: string | undefined;
    let regimeConfidence: number | undefined;
    try {
      const regime = await getLatestRegime();
      if (regime) {
        regimeType = regime.regime as string;
        regimeConfidence = regime.confidence as number;
      }
    } catch { /* ok */ }

    const storedBriefing: StoredBriefing = {
      id: crypto.randomUUID(),
      date: dateKey,
      generatedAt: now.toISOString(),
      model: MODEL,
      summary: briefingData.summary || "Market briefing generated.",
      marketCondition: briefingData.marketCondition || "neutral",
      sections: briefingData.sections || [],
      scenarios: briefingData.scenarios || [],
      regimeType,
      regimeConfidence,
    };

    // Store in KV
    const stored = await storeBriefing(storedBriefing);

    return NextResponse.json({
      success: true,
      stored,
      date: dateKey,
      model: MODEL,
      sectionsCount: storedBriefing.sections.length,
      scenariosCount: storedBriefing.scenarios.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Cron error: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
