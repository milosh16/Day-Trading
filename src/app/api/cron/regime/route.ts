// ============================================================
// SIGNAL - Market Regime Assessment Cron
// ============================================================
// Runs pre-market (~6:00 AM ET) to gather global market signals
// and classify the trading day's regime. The regime feeds into
// conviction scoring to adjust trade recommendations.
//
// Flow: Claude (web search) -> GlobalSignals JSON -> classifyRegime()
//       -> RegimeAssessment -> stored in KV
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  storeRegime,
  storeSignalHistory,
  getSignalHistory,
  storeLeadingIndicators,
} from "@/lib/briefing-store";
import {
  classifyRegime,
  buildRegimePrompt,
  type GlobalSignals,
  type RegimeAssessment,
} from "@/lib/market-regime";
import {
  computeLeadingIndicators,
  computeStressIndex,
  computeRiskAppetiteIndex,
  buildLeadingIndicatorPrompt,
  type DailySignalRecord,
} from "@/lib/leading-indicators";

export const maxDuration = 300;

const MODEL = process.env.BRIEFING_MODEL || "claude-opus-4-6";

const GLOBAL_SIGNALS_PROMPT = `You are SIGNAL's market regime scanner. Your job is to gather real-time global market data and return it as a structured JSON object.

Search for ALL of the following data points. Use the web_search tool multiple times to find each category.

Required data points:
1. S&P 500 futures % change from prior close
2. Nasdaq futures % change from prior close
3. Dow futures % change from prior close
4. VIX current level and % change from prior close
5. VIX term structure: is VIX futures curve in contango, flat, or backwardation?
6. 10-year Treasury yield (level and basis point change)
7. 2-year Treasury yield
8. US Dollar Index (DXY) level and % change
9. WTI Oil price and % change
10. Gold price and % change
11. Copper % change
12. Nikkei 225 % change (today's session)
13. DAX % change (today's session)
14. Shanghai Composite % change (today's session)
15. High-yield credit spread (HY-IG) and change in bps
16. Bitcoin % change (24h)
17. Is there major economic data today? (CPI, NFP, FOMC, GDP)
18. Are there market-moving earnings today? (mega-cap or bellwether)
19. Is this options expiration week?
20. Is this month-end?
21. Days until next FOMC meeting
22. S&P 500 consecutive up/down days and 5-day return

Return ONLY a JSON object wrapped in <signals> tags with this EXACT structure (use 0 for any value you cannot find):

<signals>
{
  "spFuturesChange": <number>,
  "nasdaqFuturesChange": <number>,
  "dowFuturesChange": <number>,
  "vix": <number>,
  "vixChange": <number>,
  "vixTermStructure": "contango" | "flat" | "backwardation",
  "tenYearYield": <number>,
  "tenYearYieldChange": <number>,
  "twoYearYield": <number>,
  "dollarIndex": <number>,
  "dollarIndexChange": <number>,
  "oilWTI": <number>,
  "oilChange": <number>,
  "goldPrice": <number>,
  "goldChange": <number>,
  "copperChange": <number>,
  "nikkeiChange": <number>,
  "daxChange": <number>,
  "shanghaiChange": <number>,
  "highYieldSpread": <number>,
  "spreadChange": <number>,
  "bitcoinChange": <number>,
  "hasMajorEconData": <boolean>,
  "hasEarningsOfNote": <boolean>,
  "isOpexWeek": <boolean>,
  "isMonthEnd": <boolean>,
  "daysToFOMC": <number>,
  "spConsecutiveUpDays": <number>,
  "spConsecutiveDownDays": <number>,
  "sp5DayReturn": <number>
}
</signals>

Search thoroughly. Accuracy matters more than speed. The regime classification depends on these numbers being correct.`;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get("x-anthropic-key");
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const now = new Date();
  const dateKey = now.toISOString().split("T")[0];

  try {
    // Step 1: Use Claude with web search to gather GlobalSignals
    const requestBody = {
      model: MODEL,
      max_tokens: 4096,
      stream: true,
      system: GLOBAL_SIGNALS_PROMPT,
      messages: [
        {
          role: "user",
          content: `Gather all global market signals for today (${dateKey}). Search for pre-market futures, VIX, yields, dollar, commodities, international markets, credit spreads, crypto, and calendar events. Return the structured JSON.`,
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

    // Step 2: Parse GlobalSignals from Claude's response
    const signalsMatch = textContent.match(/<signals>([\s\S]*?)<\/signals>/);
    let signalsJson: string;
    if (signalsMatch) {
      signalsJson = signalsMatch[1];
    } else {
      // Fallback: find JSON object in response
      const jsonStart = textContent.indexOf("{");
      const jsonEnd = textContent.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) {
        return NextResponse.json(
          { error: "Could not parse signals from Claude response", raw: textContent.slice(0, 500) },
          { status: 500 }
        );
      }
      signalsJson = textContent.slice(jsonStart, jsonEnd + 1);
    }

    let signals: GlobalSignals;
    try {
      signals = JSON.parse(signalsJson) as GlobalSignals;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse signals JSON", raw: signalsJson.slice(0, 500) },
        { status: 500 }
      );
    }

    // Step 3: Run local regime classification (no LLM needed)
    const regime: RegimeAssessment = classifyRegime(signals);

    // Step 4: Compute stress and risk appetite for today
    const stressIndex = computeStressIndex(signals);
    const riskAppetiteIndex = computeRiskAppetiteIndex(signals);

    // Step 5: Store daily signal record for leading indicator history
    const dailyRecord: DailySignalRecord = {
      date: dateKey,
      signals,
      regime: regime.regime,
      stressIndex,
      riskAppetiteIndex,
    };
    await storeSignalHistory(dateKey, dailyRecord as unknown as Record<string, unknown>);

    // Step 6: Compute leading indicators from signal history
    const rawHistory = await getSignalHistory(20);
    const history = rawHistory
      .filter((r): r is Record<string, unknown> & DailySignalRecord =>
        r != null && "date" in r && "signals" in r)
      .filter(r => r.date !== dateKey) as DailySignalRecord[]; // Exclude today (already in 'signals')

    const indicators = computeLeadingIndicators(history, signals, dateKey);
    const indicatorPrompt = buildLeadingIndicatorPrompt(indicators);
    await storeLeadingIndicators({
      ...indicators,
      indicatorPrompt,
    } as unknown as Record<string, unknown>);

    // Step 7: Store regime in KV (now includes leading indicator prompt)
    const stored = await storeRegime(dateKey, {
      ...regime,
      globalSignals: signals,
      regimePrompt: buildRegimePrompt(regime),
      leadingIndicators: indicators,
      indicatorPrompt,
    });

    return NextResponse.json({
      success: true,
      stored,
      date: dateKey,
      regime: regime.regime,
      volatilityRegime: regime.volatilityRegime,
      confidence: regime.confidence,
      directionalBias: regime.directionalBias,
      keyFactors: regime.keyFactors,
      sectorTilts: regime.sectorTilts,
      convictionModifiers: regime.convictionModifiers,
      leadingIndicators: {
        stressIndex: indicators.stressIndex,
        stressIndexTrend: indicators.stressIndexTrend,
        riskAppetiteIndex: indicators.riskAppetiteIndex,
        riskAppetiteTrend: indicators.riskAppetiteTrend,
        patternsDetected: indicators.patterns.length,
        patterns: indicators.patterns.map(p => ({ name: p.name, severity: p.severity })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Regime cron error: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
