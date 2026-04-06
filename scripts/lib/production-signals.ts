// ============================================================
// Production - Hybrid Signal Pipeline
// ============================================================
// Uses Yahoo Finance + FRED + Calendar as deterministic base,
// then Claude web search ONLY for qualitative fields that
// deterministic sources cannot provide.
//
// Cross-validates overlapping fields: if deterministic and
// web search diverge, logs a warning and uses deterministic.
// ============================================================

import type { GlobalSignals } from "../../src/lib/market-regime";
import { fetchHistoricalSignals } from "../../training/lib/yahoo-signals";
import { fetchFredSignals } from "../../training/lib/fred-signals";
import { lookupCalendarSignals } from "../../training/lib/event-calendar";

// --- Source tracking type (extends training's to include web_search) ---

type SignalSource = "yahoo" | "fred" | "calendar" | "web_search" | "computed" | "default";

// --- Fields that ONLY web search can provide ---

const WEB_SEARCH_ONLY_FIELDS: (keyof GlobalSignals)[] = [
  "cnnFearGreed",
  "aaiiBullBear",
  "naaim",
  "putCallRatio",
  "spxGammaExposure",
  "geopoliticalRisk",
  "geopoliticalEvents",
  "hasEarningsOfNote",
  "earningsNames",
  "marginDebt",
  "etfFlows",
  "percentAbove200DMA",
  "percentAbove50DMA",
  "skewIndex",
  "mcclellanOscillator",
];

// --- Fields where FRED is authoritative over Yahoo ---

const FRED_AUTHORITATIVE_FIELDS: (keyof GlobalSignals)[] = [
  "tenYearYield",
  "tenYearYieldChange",
  "twoYearYield",
  "twoYearYieldChange",
  "thirtyYearYield",
  "threeMonthYield",
  "twoTenSpread",
  "threeMoTenYrSpread",
  "realYield10Y",
  "fedFundsRate",
  "fedFundsExpected",
  "highYieldSpread",
  "spreadChange",
  "igSpread",
  "igSpreadChange",
  "tedSpread",
  "sofr",
  "repoRate",
];

// --- Calendar fields ---

const CALENDAR_FIELDS: (keyof GlobalSignals)[] = [
  "hasMajorEconData",
  "econDataType",
  "hasEarningsOfNote",
  "earningsNames",
  "isOpexWeek",
  "isOpexDay",
  "isMonthEnd",
  "isQuarterEnd",
  "daysToFOMC",
  "daysToNextCPI",
  "daysToNextNFP",
  "isExDividendHeavy",
];

// --- Categorical defaults used to detect unpopulated fields ---

const CATEGORICAL_DEFAULTS = new Set(["flat", "neutral", "contango", "low"]);

function isDefault(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") return value === "" || CATEGORICAL_DEFAULTS.has(value);
  if (typeof value === "boolean") return value === false;
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Cross-validation thresholds ---

const CROSS_VALIDATION: Record<string, { threshold: number; label: string }> = {
  vix: { threshold: 1.0, label: "VIX points" },
  tenYearYield: { threshold: 0.10, label: "yield %" },
  twoYearYield: { threshold: 0.10, label: "yield %" },
  thirtyYearYield: { threshold: 0.10, label: "yield %" },
  threeMonthYield: { threshold: 0.10, label: "yield %" },
  oilWTI: { threshold: 1.0, label: "$/bbl" },
  goldPrice: { threshold: 10.0, label: "$/oz" },
  dollarIndex: { threshold: 0.5, label: "DXY points" },
  bitcoinChange: { threshold: 2.0, label: "% change" },
  spFuturesChange: { threshold: 0.5, label: "% change" },
  nasdaqFuturesChange: { threshold: 0.5, label: "% change" },
};

// --- Web search qualitative fields interface ---

interface QualitativeData {
  cnnFearGreed: number;
  aaiiBullBear: number;
  naaim: number;
  putCallRatio: number;
  spxGammaExposure: "positive" | "neutral" | "negative";
  geopoliticalRisk: "low" | "moderate" | "elevated" | "high";
  geopoliticalEvents: string;
  hasEarningsOfNote: boolean;
  earningsNames: string;
  marginDebt: "increasing" | "flat" | "decreasing";
  etfFlows: "inflows" | "flat" | "outflows";
  percentAbove200DMA: number;
  percentAbove50DMA: number;
  skewIndex: number;
  mcclellanOscillator: number;
  // Web search may also return overlapping fields for cross-validation
  vix?: number;
  tenYearYield?: number;
  oilWTI?: number;
  goldPrice?: number;
}

function buildQualitativePrompt(dateStr: string): { system: string; user: string } {
  const system = `You are a market data scanner. You already have accurate market data from deterministic sources (Yahoo Finance, FRED). You ONLY need to search for specific qualitative and hard-to-get data points. Search MULTIPLE sources and cross-reference. Return accurate, current values.`;

  const user = `Gather the following market data points as of ${dateStr}. You already have accurate data for indices, yields, commodities, currencies, sectors, and crypto from Yahoo Finance and FRED — do NOT waste time searching for those.

Search for ONLY these additional data points that require web search:

1. CNN Fear & Greed Index (0-100): search "CNN fear greed index today"
2. AAII Bull/Bear Spread: search "AAII investor sentiment survey"
3. NAAIM Exposure Index (0-200): search "NAAIM exposure index"
4. Put/Call Ratio: search "CBOE put call ratio"
5. SPX Gamma Exposure: search "SPX dealer gamma"
6. Geopolitical risk level and events: search for current geopolitical tensions
7. Notable earnings today: search "${dateStr} earnings reports"
8. S&P 500 breadth: search "percent S&P 500 above 200 day moving average"
9. CBOE SKEW Index: search "CBOE SKEW index"
10. McClellan Oscillator: search "McClellan oscillator NYSE"
11. Margin debt trend: search "NYSE margin debt"
12. ETF fund flows: search "equity ETF flows this week"

Also search for VIX, 10-year Treasury yield, WTI oil price, and gold price so we can cross-validate against our deterministic sources.

Return JSON in <qualitative> tags with ONLY these fields (use 0 for unknown numbers, "" for strings, false for booleans):
<qualitative>{
  "cnnFearGreed": 0,
  "aaiiBullBear": 0,
  "naaim": 0,
  "putCallRatio": 0,
  "spxGammaExposure": "neutral",
  "geopoliticalRisk": "low",
  "geopoliticalEvents": "",
  "hasEarningsOfNote": false,
  "earningsNames": "",
  "marginDebt": "flat",
  "etfFlows": "flat",
  "percentAbove200DMA": 0,
  "percentAbove50DMA": 0,
  "skewIndex": 0,
  "mcclellanOscillator": 0,
  "vix": 0,
  "tenYearYield": 0,
  "oilWTI": 0,
  "goldPrice": 0
}</qualitative>`;

  return { system, user };
}

/**
 * Production signal pipeline: deterministic base + Claude web search for qualitative data.
 *
 * 1. Fetch Yahoo Finance + FRED + Calendar in parallel (deterministic)
 * 2. Call Claude web search for ~15 qualitative fields
 * 3. Cross-validate overlapping fields; log conflicts, use deterministic value
 * 4. Return merged signals with full source tracking
 */
export async function getProductionSignals(
  dateStr: string,
  callClaude: (system: string, userMessage: string, maxTokens?: number) => Promise<string>,
  extractJson: (text: string, tag: string) => string,
): Promise<{
  signals: GlobalSignals;
  fieldsPopulated: number;
  sources: Partial<Record<keyof GlobalSignals, SignalSource>>;
  conflicts: { field: string; deterministic: unknown; webSearch: unknown }[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const conflicts: { field: string; deterministic: unknown; webSearch: unknown }[] = [];
  const sources: Partial<Record<keyof GlobalSignals, SignalSource>> = {};

  // --- Step 1: Fetch deterministic sources in parallel ---
  console.log(`  [Deterministic] Fetching Yahoo + FRED + Calendar...`);
  const detT = Date.now();

  // Extract YYYY-MM-DD from the human-readable dateStr for API calls
  const today = new Date();
  const dateKey = today.toISOString().split("T")[0];

  const [yahooResult, fredResult, calendarResult] = await Promise.allSettled([
    fetchHistoricalSignals(dateKey),
    fetchFredSignals(dateKey),
    lookupCalendarSignals(dateKey),
  ]);

  // --- Build base signals from Yahoo ---
  let signals: GlobalSignals;
  if (yahooResult.status === "fulfilled") {
    signals = yahooResult.value.signals;
    for (const key of Object.keys(signals) as (keyof GlobalSignals)[]) {
      sources[key] = isDefault(signals[key]) ? "default" : "yahoo";
    }
    console.log(`  [Yahoo] ${yahooResult.value.fieldsPopulated} fields populated`);
  } else {
    warnings.push(`Yahoo Finance failed: ${yahooResult.reason}`);
    console.log(`  [Yahoo] FAILED — using empty base`);
    signals = createEmptySignals();
    for (const key of Object.keys(signals) as (keyof GlobalSignals)[]) {
      sources[key] = "default";
    }
  }

  // --- Overlay FRED (authoritative for yields, spreads, monetary) ---
  if (fredResult.status === "fulfilled") {
    const fredSignals = fredResult.value as Partial<GlobalSignals>;
    let fredCount = 0;
    for (const field of FRED_AUTHORITATIVE_FIELDS) {
      const fredValue = fredSignals[field];
      if (fredValue !== undefined && fredValue !== null && !isDefault(fredValue)) {
        (signals as any)[field] = fredValue;
        sources[field] = "fred";
        fredCount++;
      }
    }

    // Recompute twoTenSpread with FRED 2Y yield
    const fredTwoYear = fredSignals.twoYearYield;
    if (fredTwoYear !== undefined && fredTwoYear !== 0 && signals.tenYearYield !== 0) {
      signals.twoTenSpread = round2(signals.tenYearYield - (fredTwoYear as number));
      sources.twoTenSpread = "computed";
    }

    // Recompute threeMoTenYrSpread with FRED 3M yield
    const fredThreeMo = fredSignals.threeMonthYield;
    if (fredThreeMo !== undefined && fredThreeMo !== 0 && signals.tenYearYield !== 0) {
      signals.threeMoTenYrSpread = round2(signals.tenYearYield - (fredThreeMo as number));
      sources.threeMoTenYrSpread = "computed";
    }

    console.log(`  [FRED] ${fredCount} fields overlaid`);
  } else {
    warnings.push(`FRED unavailable: ${fredResult.reason}`);
    console.log(`  [FRED] FAILED — using Yahoo yields`);
  }

  // --- Overlay Calendar ---
  if (calendarResult.status === "fulfilled") {
    const calSignals = calendarResult.value as Partial<GlobalSignals>;
    let calCount = 0;
    for (const field of CALENDAR_FIELDS) {
      const calValue = calSignals[field];
      if (calValue !== undefined && calValue !== null) {
        (signals as any)[field] = calValue;
        sources[field] = "calendar";
        calCount++;
      }
    }
    console.log(`  [Calendar] ${calCount} fields filled`);
  } else {
    warnings.push(`Calendar lookup failed: ${calendarResult.reason}`);
    console.log(`  [Calendar] FAILED`);
  }

  console.log(`  [Deterministic] Done (${((Date.now() - detT) / 1000).toFixed(0)}s)`);

  // --- Step 2: Check which qualitative fields are still at defaults ---
  const fieldsStillDefault = WEB_SEARCH_ONLY_FIELDS.filter(
    (field) => isDefault(signals[field]),
  );

  if (fieldsStillDefault.length === 0) {
    console.log(`  [Web Search] All qualitative fields already populated — skipping`);
  } else {
    // --- Call Claude web search for qualitative fields ---
    console.log(`  [Web Search] ${fieldsStillDefault.length} qualitative fields need web search...`);
    const wsT = Date.now();

    try {
      const prompt = buildQualitativePrompt(dateStr);
      const qualitativeText = await callClaude(prompt.system, prompt.user, 4096);
      const qualitativeJson = extractJson(qualitativeText, "qualitative");
      const qualitative: Partial<QualitativeData> = JSON.parse(qualitativeJson);

      console.log(`  [Web Search] Done (${((Date.now() - wsT) / 1000).toFixed(0)}s)`);

      // --- Step 3: Cross-validate overlapping fields ---
      for (const [field, config] of Object.entries(CROSS_VALIDATION)) {
        const detValue = signals[field as keyof GlobalSignals];
        const wsValue = qualitative[field as keyof QualitativeData];

        if (
          wsValue !== undefined &&
          wsValue !== null &&
          wsValue !== 0 &&
          !isDefault(detValue)
        ) {
          const detNum = Number(detValue);
          const wsNum = Number(wsValue);

          if (!isNaN(detNum) && !isNaN(wsNum)) {
            const diff = Math.abs(detNum - wsNum);
            if (diff > config.threshold) {
              conflicts.push({
                field,
                deterministic: detValue,
                webSearch: wsValue,
              });
              warnings.push(
                `Cross-validation conflict: ${field} — deterministic=${detValue}, webSearch=${wsValue} (diff=${round2(diff)} ${config.label}) — using deterministic`,
              );
              // Keep deterministic value (already set)
            }
          }
        }
      }

      // --- Step 4: Apply qualitative fields that are still at defaults ---
      const qualitativeFieldMap: Record<string, keyof QualitativeData> = {
        cnnFearGreed: "cnnFearGreed",
        aaiiBullBear: "aaiiBullBear",
        naaim: "naaim",
        putCallRatio: "putCallRatio",
        spxGammaExposure: "spxGammaExposure",
        geopoliticalRisk: "geopoliticalRisk",
        geopoliticalEvents: "geopoliticalEvents",
        hasEarningsOfNote: "hasEarningsOfNote",
        earningsNames: "earningsNames",
        marginDebt: "marginDebt",
        etfFlows: "etfFlows",
        percentAbove200DMA: "percentAbove200DMA",
        percentAbove50DMA: "percentAbove50DMA",
        skewIndex: "skewIndex",
        mcclellanOscillator: "mcclellanOscillator",
      };

      let wsApplied = 0;
      for (const field of fieldsStillDefault) {
        const qKey = qualitativeFieldMap[field];
        if (!qKey) continue;

        const wsValue = qualitative[qKey];
        if (wsValue !== undefined && wsValue !== null && !isDefault(wsValue)) {
          (signals as any)[field] = wsValue;
          sources[field] = "web_search";
          wsApplied++;
        }
      }

      // Also apply earnings from web search if calendar didn't have them
      // (calendar has OPEX/FOMC/CPI/NFP but not individual company earnings)
      if (
        qualitative.hasEarningsOfNote &&
        !signals.hasEarningsOfNote
      ) {
        signals.hasEarningsOfNote = qualitative.hasEarningsOfNote;
        sources.hasEarningsOfNote = "web_search";
        wsApplied++;
      }
      if (
        qualitative.earningsNames &&
        qualitative.earningsNames !== "" &&
        signals.earningsNames === ""
      ) {
        signals.earningsNames = qualitative.earningsNames;
        sources.earningsNames = "web_search";
        wsApplied++;
      }

      console.log(`  [Web Search] Applied ${wsApplied} qualitative fields`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Web search failed: ${msg}`);
      console.log(`  [Web Search] FAILED: ${msg}`);
    }
  }

  // --- Count final populated fields ---
  const fieldsPopulated = Object.entries(signals).filter(
    ([, v]) => !isDefault(v),
  ).length;

  return {
    signals,
    fieldsPopulated,
    sources,
    conflicts,
    warnings,
  };
}

/**
 * Create an empty GlobalSignals object with all fields at type-appropriate defaults.
 */
function createEmptySignals(): GlobalSignals {
  return {
    spFuturesChange: 0,
    nasdaqFuturesChange: 0,
    dowFuturesChange: 0,
    russellFuturesChange: 0,
    vixFuturesChange: 0,
    vix: 0,
    vixChange: 0,
    vixTermStructure: "contango",
    vix9d: 0,
    vix3m: 0,
    skewIndex: 0,
    putCallRatio: 0,
    spxGammaExposure: "neutral",
    tenYearYield: 0,
    tenYearYieldChange: 0,
    twoYearYield: 0,
    twoYearYieldChange: 0,
    thirtyYearYield: 0,
    threeMonthYield: 0,
    twoTenSpread: 0,
    threeMoTenYrSpread: 0,
    realYield10Y: 0,
    fedFundsRate: 0,
    fedFundsExpected: 0,
    dollarIndex: 0,
    dollarIndexChange: 0,
    eurUsd: 0,
    eurUsdChange: 0,
    usdJpy: 0,
    usdJpyChange: 0,
    usdCny: 0,
    usdCnyChange: 0,
    oilWTI: 0,
    oilChange: 0,
    brentOil: 0,
    brentOilChange: 0,
    natGasChange: 0,
    goldPrice: 0,
    goldChange: 0,
    silverChange: 0,
    copperChange: 0,
    ironOreChange: 0,
    wheatChange: 0,
    uraniumChange: 0,
    balticDryIndex: 0,
    balticDryChange: 0,
    nikkeiChange: 0,
    daxChange: 0,
    ftseChange: 0,
    shanghaiChange: 0,
    hangSengChange: 0,
    kospiChange: 0,
    emChange: 0,
    euroStoxx50Change: 0,
    highYieldSpread: 0,
    spreadChange: 0,
    igSpread: 0,
    igSpreadChange: 0,
    cdsIndex: 0,
    tedSpread: 0,
    mbs30YrSpread: 0,
    advanceDeclineRatio: 0,
    newHighsNewLows: 0,
    percentAbove200DMA: 0,
    percentAbove50DMA: 0,
    mcclellanOscillator: 0,
    xlkChange: 0,
    xlfChange: 0,
    xleChange: 0,
    xlvChange: 0,
    xlpChange: 0,
    xluChange: 0,
    xlreChange: 0,
    xliChange: 0,
    xlbChange: 0,
    xlcChange: 0,
    xlyChange: 0,
    smhChange: 0,
    aaiiBullBear: 0,
    cnnFearGreed: 0,
    naaim: 0,
    marginDebt: "flat",
    etfFlows: "flat",
    bitcoinChange: 0,
    ethereumChange: 0,
    btcDominance: 0,
    cryptoTotalMarketCapChange: 0,
    sofr: 0,
    repoRate: 0,
    fedBalanceSheet: "flat",
    tgaBalance: "flat",
    hasMajorEconData: false,
    econDataType: "",
    hasEarningsOfNote: false,
    earningsNames: "",
    isOpexWeek: false,
    isOpexDay: false,
    isMonthEnd: false,
    isQuarterEnd: false,
    daysToFOMC: 0,
    daysToNextCPI: 0,
    daysToNextNFP: 0,
    isExDividendHeavy: false,
    geopoliticalRisk: "low",
    geopoliticalEvents: "",
    spConsecutiveUpDays: 0,
    spConsecutiveDownDays: 0,
    sp5DayReturn: 0,
    sp20DayReturn: 0,
    nasdaqVsRussell5d: 0,
    sp52WeekRange: 0,
    spDistanceFrom200DMA: 0,
    spDistanceFrom50DMA: 0,
  };
}
