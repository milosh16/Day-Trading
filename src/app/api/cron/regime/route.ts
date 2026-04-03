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

const GLOBAL_SIGNALS_PROMPT = `You are SIGNAL's market regime scanner. Your job is to gather comprehensive real-time global market data — over 100 data points — and return it as a structured JSON object.

Search THOROUGHLY using multiple web_search calls. Cover every category below. This data feeds directly into regime classification, leading indicator tracking, and conviction scoring. Missing data = missed alpha.

CATEGORY 1 — INDEX FUTURES (pre-market):
- S&P 500, Nasdaq, Dow, Russell 2000 futures % change from prior close
- VIX futures % change

CATEGORY 2 — VOLATILITY & OPTIONS:
- VIX level and % change, VIX term structure (contango/flat/backwardation)
- VIX9D (9-day), VIX3M (3-month)
- CBOE SKEW index (tail risk, normal ~120, elevated >130)
- Total equity put/call ratio
- Dealer gamma exposure (positive/neutral/negative)

CATEGORY 3 — RATES & YIELD CURVE:
- 2Y, 10Y, 30Y Treasury yields and changes (bps)
- 3-month T-bill yield
- 2s10s spread, 3mo-10Y spread
- 10Y TIPS yield (real yield)
- Fed funds rate, next meeting implied rate from futures

CATEGORY 4 — DOLLAR & CURRENCIES:
- DXY level and % change
- EUR/USD, USD/JPY, USD/CNY levels and % changes

CATEGORY 5 — COMMODITIES:
- WTI & Brent oil prices and % changes
- Natural gas % change
- Gold price and % change, silver % change
- Copper, iron ore % changes
- Wheat % change
- Uranium % change
- Baltic Dry Index level and % change

CATEGORY 6 — INTERNATIONAL EQUITY:
- Nikkei, DAX, FTSE, Shanghai, Hang Seng, KOSPI % changes
- MSCI EM % change, Euro Stoxx 50 % change

CATEGORY 7 — CREDIT & FIXED INCOME:
- HY-IG spread and change (bps)
- IG spread and change
- CDX NA IG (CDS index)
- TED spread (or SOFR-T-bill spread)
- 30Y MBS spread

CATEGORY 8 — EQUITY BREADTH:
- NYSE advance/decline ratio
- Net new 52-week highs minus lows
- % of S&P 500 above 200-day and 50-day moving averages
- McClellan Oscillator

CATEGORY 9 — SECTOR PERFORMANCE (prior day % change):
- XLK, XLF, XLE, XLV, XLP, XLU, XLRE, XLI, XLB, XLC, XLY, SMH

CATEGORY 10 — SENTIMENT & FLOWS:
- AAII bull-bear spread
- CNN Fear & Greed Index (0-100)
- NAAIM Exposure Index
- Margin debt trend (increasing/flat/decreasing)
- Equity ETF flows (inflows/flat/outflows)

CATEGORY 11 — CRYPTO:
- Bitcoin and Ethereum % change (24h)
- BTC dominance %
- Total crypto market cap % change

CATEGORY 12 — LIQUIDITY & MONETARY:
- SOFR rate
- Overnight repo rate
- Fed balance sheet trend (expanding/flat/contracting)
- Treasury General Account trend (increasing/flat/decreasing)

CATEGORY 13 — CALENDAR & EVENTS:
- Major economic data today (CPI/NFP/FOMC/GDP/ISM/PPI) — which specific release
- Market-moving earnings today — which companies
- Is it OPEX week? OPEX day? Month-end? Quarter-end?
- Days until next FOMC, CPI, NFP
- Heavy ex-dividend day?
- Geopolitical risk level and active situations

CATEGORY 14 — RECENT CONTEXT (multi-day):
- S&P consecutive up/down days, 5-day and 20-day returns
- Nasdaq vs Russell 5-day divergence
- S&P position in 52-week range (0-100)
- S&P distance from 200-day and 50-day moving averages (%)

Return ONLY a JSON object wrapped in <signals> tags. Use 0 for numbers you cannot find, "" for strings, false for booleans. EVERY field must be present.

<signals>
{
  "spFuturesChange": 0, "nasdaqFuturesChange": 0, "dowFuturesChange": 0, "russellFuturesChange": 0, "vixFuturesChange": 0,
  "vix": 0, "vixChange": 0, "vixTermStructure": "contango", "vix9d": 0, "vix3m": 0, "skewIndex": 0, "putCallRatio": 0, "spxGammaExposure": "neutral",
  "tenYearYield": 0, "tenYearYieldChange": 0, "twoYearYield": 0, "twoYearYieldChange": 0, "thirtyYearYield": 0, "threeMonthYield": 0, "twoTenSpread": 0, "threeMoTenYrSpread": 0, "realYield10Y": 0, "fedFundsRate": 0, "fedFundsExpected": 0,
  "dollarIndex": 0, "dollarIndexChange": 0, "eurUsd": 0, "eurUsdChange": 0, "usdJpy": 0, "usdJpyChange": 0, "usdCny": 0, "usdCnyChange": 0,
  "oilWTI": 0, "oilChange": 0, "brentOil": 0, "brentOilChange": 0, "natGasChange": 0, "goldPrice": 0, "goldChange": 0, "silverChange": 0, "copperChange": 0, "ironOreChange": 0, "wheatChange": 0, "uraniumChange": 0, "balticDryIndex": 0, "balticDryChange": 0,
  "nikkeiChange": 0, "daxChange": 0, "ftseChange": 0, "shanghaiChange": 0, "hangSengChange": 0, "kospiChange": 0, "emChange": 0, "euroStoxx50Change": 0,
  "highYieldSpread": 0, "spreadChange": 0, "igSpread": 0, "igSpreadChange": 0, "cdsIndex": 0, "tedSpread": 0, "mbs30YrSpread": 0,
  "advanceDeclineRatio": 0, "newHighsNewLows": 0, "percentAbove200DMA": 0, "percentAbove50DMA": 0, "mcclellanOscillator": 0,
  "xlkChange": 0, "xlfChange": 0, "xleChange": 0, "xlvChange": 0, "xlpChange": 0, "xluChange": 0, "xlreChange": 0, "xliChange": 0, "xlbChange": 0, "xlcChange": 0, "xlyChange": 0, "smhChange": 0,
  "aaiiBullBear": 0, "cnnFearGreed": 0, "naaim": 0, "marginDebt": "flat", "etfFlows": "flat",
  "bitcoinChange": 0, "ethereumChange": 0, "btcDominance": 0, "cryptoTotalMarketCapChange": 0,
  "sofr": 0, "repoRate": 0, "fedBalanceSheet": "flat", "tgaBalance": "flat",
  "hasMajorEconData": false, "econDataType": "", "hasEarningsOfNote": false, "earningsNames": "", "isOpexWeek": false, "isOpexDay": false, "isMonthEnd": false, "isQuarterEnd": false, "daysToFOMC": 0, "daysToNextCPI": 0, "daysToNextNFP": 0, "isExDividendHeavy": false,
  "geopoliticalRisk": "low", "geopoliticalEvents": "",
  "spConsecutiveUpDays": 0, "spConsecutiveDownDays": 0, "sp5DayReturn": 0, "sp20DayReturn": 0, "nasdaqVsRussell5d": 0, "sp52WeekRange": 0, "spDistanceFrom200DMA": 0, "spDistanceFrom50DMA": 0
}
</signals>

Search MULTIPLE times. Do NOT guess — look up real data. Accuracy is everything.`;

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

    // Full regime payload for GitHub Actions to persist as static JSON
    const fullRegime = {
      ...regime,
      globalSignals: signals,
      regimePrompt: buildRegimePrompt(regime),
      leadingIndicators: indicators,
      indicatorPrompt,
    };

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
      fullRegime,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Regime cron error: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
