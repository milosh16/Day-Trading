#!/usr/bin/env npx tsx
// ============================================================
// SIGNAL - Standalone Briefing Generator
// ============================================================
// Runs entirely in GitHub Actions. No Vercel dependency.
// Calls Claude API directly, writes JSON to public/data/.
//
// Usage: ANTHROPIC_API_KEY=sk-... npx tsx scripts/generate-briefing.ts
// ============================================================

import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  classifyRegime,
  buildRegimePrompt,
  type GlobalSignals,
} from "../src/lib/market-regime";
import {
  computeLeadingIndicators,
  computeStressIndex,
  computeRiskAppetiteIndex,
  buildLeadingIndicatorPrompt,
  type DailySignalRecord,
} from "../src/lib/leading-indicators";

// --- Config ---
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.BRIEFING_MODEL || "claude-opus-4-6";
const DATA_DIR = join(process.cwd(), "public", "data");
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_RETRIES = 3;

if (!API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY not set");
  process.exit(1);
}

// --- Helpers ---

async function callClaude(
  system: string,
  userMessage: string,
  maxTokens = 8192,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`  Claude call attempt ${attempt}/${MAX_RETRIES}...`);
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          stream: true,
          system,
          messages: [{ role: "user", content: userMessage }],
          tools: [{ type: "web_search_20260209", name: "web_search" }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`  API error ${response.status}: ${err.slice(0, 300)}`);
        if (response.status === 429 || response.status === 529) {
          const wait = Math.pow(2, attempt) * 2000;
          console.log(`  Rate limited. Waiting ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`API ${response.status}: ${err.slice(0, 300)}`);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let text = "";
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
              text += event.delta.text;
            }
          } catch { /* skip */ }
        }
      }

      if (!text) throw new Error("Empty response from Claude");
      return text;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const wait = Math.pow(2, attempt) * 1000;
      console.error(`  Error: ${err}. Retrying in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error("Max retries exceeded");
}

function extractJson(text: string, tag: string): string {
  const tagMatch = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (tagMatch) return tagMatch[1].trim();

  // Fallback: find JSON in text
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) return text.slice(jsonStart, jsonEnd + 1);

  throw new Error(`Could not extract JSON (tag: ${tag}) from response`);
}

function writeData(filename: string, data: unknown): void {
  const filepath = join(DATA_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`  Wrote ${filepath}`);
}

function loadSignalHistory(): DailySignalRecord[] {
  try {
    const historyDir = join(DATA_DIR, "history");
    if (!existsSync(historyDir)) return [];
    const files = readdirSync(historyDir)
      .filter(f => f.startsWith("signals-") && f.endsWith(".json"))
      .sort()
      .slice(-20); // Last 20 days
    return files.map(f => {
      const content = readFileSync(join(historyDir, f), "utf-8");
      return JSON.parse(content) as DailySignalRecord;
    });
  } catch {
    return [];
  }
}

function saveSignalHistory(record: DailySignalRecord): void {
  const historyDir = join(DATA_DIR, "history");
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(
    join(historyDir, `signals-${record.date}.json`),
    JSON.stringify(record, null, 2),
  );
}

// --- Prompts ---

const SIGNALS_PROMPT = `You are SIGNAL's market regime scanner. Your job is to gather comprehensive real-time global market data — over 100 data points — and return it as a structured JSON object.

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
- Wheat % change, Uranium % change
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

function buildBriefingPrompt(dateStr: string, regimeContext: string): string {
  return `You are SIGNAL, an AI trading intelligence system. Today is ${dateStr}. Generate a comprehensive morning market briefing by searching for current market data. Be factual and concise. Do not use emojis.${regimeContext}

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

IMPORTANT: Wrap your final JSON in <json> tags like this: <json>{"summary": ...}</json>`;
}

// --- Main ---

async function main() {
  const now = new Date();
  const dateKey = now.toISOString().split("T")[0];
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  mkdirSync(DATA_DIR, { recursive: true });

  console.log(`\n=== SIGNAL Briefing Generator ===`);
  console.log(`Date: ${dateStr} (${dateKey})`);
  console.log(`Model: ${MODEL}`);
  console.log(`Output: ${DATA_DIR}`);

  // ---- PHASE 1: Regime Assessment ----
  console.log(`\n--- Phase 1: Regime Assessment ---`);

  console.log("Calling Claude for global signals...");
  const signalsText = await callClaude(
    SIGNALS_PROMPT,
    `Gather all global market signals for today (${dateKey}). Search for pre-market futures, VIX, yields, dollar, commodities, international markets, credit spreads, crypto, and calendar events. Return the structured JSON.`,
  );

  console.log("Parsing signals...");
  const signalsJson = extractJson(signalsText, "signals");
  const signals: GlobalSignals = JSON.parse(signalsJson);
  console.log(`  Parsed ${Object.keys(signals).length} signal fields`);

  // Run local classification
  console.log("Running regime classification...");
  const regime = classifyRegime(signals);
  console.log(`  Regime: ${regime.regime} (${regime.confidence}% confidence)`);
  console.log(`  Bias: ${regime.directionalBias}, Vol: ${regime.volatilityRegime}`);

  const stressIndex = computeStressIndex(signals);
  const riskAppetiteIndex = computeRiskAppetiteIndex(signals);
  console.log(`  Stress: ${stressIndex}/100, Risk Appetite: ${riskAppetiteIndex}/100`);

  // Leading indicators from history
  const history = loadSignalHistory().filter(r => r.date !== dateKey);
  const indicators = computeLeadingIndicators(history, signals, dateKey);
  const indicatorPrompt = buildLeadingIndicatorPrompt(indicators);
  console.log(`  Leading indicators: ${history.length}d history, ${indicators.patterns.length} patterns detected`);

  // Save signal history for tomorrow
  const dailyRecord: DailySignalRecord = {
    date: dateKey,
    signals,
    regime: regime.regime,
    stressIndex,
    riskAppetiteIndex,
  };
  saveSignalHistory(dailyRecord);

  // Build full regime payload
  const regimePrompt = buildRegimePrompt(regime);
  const fullRegime = {
    ...regime,
    globalSignals: signals,
    regimePrompt,
    leadingIndicators: indicators,
    indicatorPrompt,
  };

  writeData("regime-latest.json", fullRegime);
  writeData(`regime-${dateKey}.json`, fullRegime);
  console.log("Regime data saved.");

  // ---- PHASE 2: Morning Briefing ----
  console.log(`\n--- Phase 2: Morning Briefing ---`);

  let regimeContext = "";
  regimeContext += `\n\n--- REGIME ASSESSMENT (auto-generated) ---\n${regimePrompt}\n--- END REGIME ASSESSMENT ---`;
  regimeContext += `\n\n--- LEADING INDICATORS (multi-day trends) ---\n${indicatorPrompt}\n--- END LEADING INDICATORS ---`;
  regimeContext += `\n\nIncorporate both the regime assessment AND multi-day leading indicators into your briefing. Reference the regime type, key factors, sector tilts, and any detected patterns (stress accumulation, credit stress, oversold bounce setups, etc.) in your analysis. Leading indicator patterns are especially important — they show what is BUILDING over days/weeks.`;

  const briefingSystemPrompt = buildBriefingPrompt(dateStr, regimeContext);

  console.log("Calling Claude for briefing...");
  const briefingText = await callClaude(
    briefingSystemPrompt,
    "Generate today's morning market briefing. Search for current market data, futures, economic calendar, earnings, VIX, yields, dollar index, commodities, crypto, sector performance, breaking news, and prediction market odds for key events.",
  );

  console.log("Parsing briefing...");
  const briefingJson = extractJson(briefingText, "json");
  const briefingData = JSON.parse(briefingJson);

  const storedBriefing = {
    id: `briefing-${dateKey}-${Date.now()}`,
    date: dateKey,
    generatedAt: now.toISOString(),
    model: MODEL,
    summary: briefingData.summary || "Market briefing generated.",
    marketCondition: briefingData.marketCondition || "neutral",
    sections: briefingData.sections || [],
    scenarios: briefingData.scenarios || [],
    regimeType: regime.regime,
    regimeConfidence: regime.confidence,
  };

  writeData("briefing-latest.json", storedBriefing);
  writeData(`briefing-${dateKey}.json`, storedBriefing);

  console.log(`\n=== DONE ===`);
  console.log(`Briefing: ${storedBriefing.sections.length} sections, ${storedBriefing.scenarios.length} scenarios`);
  console.log(`Market condition: ${storedBriefing.marketCondition}`);
  console.log(`Regime: ${regime.regime} | Stress: ${stressIndex} | Risk Appetite: ${riskAppetiteIndex}`);
  if (indicators.patterns.length > 0) {
    console.log(`Patterns: ${indicators.patterns.map(p => `[${p.severity}] ${p.name}`).join(", ")}`);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message || err}`);
  process.exit(1);
});
