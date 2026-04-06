// ============================================================
// Training - Composite Signal Aggregator
// ============================================================
// Merges signals from Yahoo Finance, FRED, and the event
// calendar into a single GlobalSignals object.
//
// Priority: FRED overrides Yahoo for authoritative fields
// (yields, spreads, fed funds). Calendar fills calendar
// fields. Yahoo is the base layer for everything else.
// ============================================================

import type { GlobalSignals } from "../../src/lib/market-regime.ts";
import { fetchHistoricalSignals } from "./yahoo-signals.ts";
import { fetchFredSignals } from "./fred-signals.ts";
import { lookupCalendarSignals } from "./event-calendar.ts";

export interface CompositeSignalResult {
  signals: GlobalSignals;
  fieldsPopulated: number;
  sources: Partial<Record<keyof GlobalSignals, "yahoo" | "fred" | "calendar" | "computed" | "default">>;
  warnings: string[];
}

// Fields where FRED is authoritative (more accurate than Yahoo proxies)
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

// Fields that the calendar source provides
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

// Default values — used to detect whether a field was actually populated
const DEFAULT_VALUES: Record<string, unknown> = {
  number: 0,
  string: "",
  boolean: false,
};

const CATEGORICAL_DEFAULTS = new Set([
  "flat", "neutral", "contango", "low",
]);

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "" && !CATEGORICAL_DEFAULTS.has(value);
  if (typeof value === "boolean") return value !== false;
  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fetch and merge signals from all available sources.
 *
 * 1. Yahoo Finance: base layer (indices, sectors, commodities, crypto, etc.)
 * 2. FRED: overrides Yahoo for yields, spreads, and monetary fields
 * 3. Calendar: fills event/calendar fields
 * 4. Computed: twoTenSpread recalculated using FRED 2Y yield when available
 */
export async function fetchCompositeSignals(date: string): Promise<CompositeSignalResult> {
  const warnings: string[] = [];
  const sources: Partial<Record<keyof GlobalSignals, "yahoo" | "fred" | "calendar" | "computed" | "default">> = {};

  // --- Fetch all three sources in parallel ---
  const [yahooResult, fredResult, calendarResult] = await Promise.allSettled([
    fetchHistoricalSignals(date),
    fetchFredSignals(date),
    lookupCalendarSignals(date),
  ]);

  // --- Yahoo (base layer) ---
  let signals: GlobalSignals;
  if (yahooResult.status === "fulfilled") {
    signals = yahooResult.value.signals;
    // Mark all populated Yahoo fields
    for (const key of Object.keys(signals) as (keyof GlobalSignals)[]) {
      if (isPopulated(signals[key])) {
        sources[key] = "yahoo";
      } else {
        sources[key] = "default";
      }
    }
  } else {
    warnings.push(`Yahoo Finance fetch failed: ${yahooResult.reason}`);
    // Create a zeroed-out GlobalSignals as fallback — the other sources
    // will overlay what they can
    signals = createEmptySignals();
    for (const key of Object.keys(signals) as (keyof GlobalSignals)[]) {
      sources[key] = "default";
    }
  }

  // --- FRED (override layer for authoritative fields) ---
  if (fredResult.status === "fulfilled") {
    const fredSignals = fredResult.value as Partial<GlobalSignals>;
    for (const field of FRED_AUTHORITATIVE_FIELDS) {
      const fredValue = fredSignals[field];
      if (fredValue !== undefined && fredValue !== null && isPopulated(fredValue)) {
        (signals as any)[field] = fredValue;
        sources[field] = "fred";
      }
    }

    // Recompute twoTenSpread using FRED 2Y yield if available (more accurate
    // than Yahoo's interpolation from 3M and 5Y)
    const fredTwoYear = fredSignals.twoYearYield;
    const tenYearForSpread = sources.tenYearYield === "fred"
      ? signals.tenYearYield
      : signals.tenYearYield;

    if (fredTwoYear !== undefined && fredTwoYear !== 0 && tenYearForSpread !== 0) {
      signals.twoTenSpread = round2(tenYearForSpread - (fredTwoYear as number));
      sources.twoTenSpread = "computed";
    }

    // Also recompute threeMoTenYrSpread if FRED provided 3M yield
    const fredThreeMo = fredSignals.threeMonthYield;
    if (fredThreeMo !== undefined && fredThreeMo !== 0 && tenYearForSpread !== 0) {
      signals.threeMoTenYrSpread = round2(tenYearForSpread - (fredThreeMo as number));
      sources.threeMoTenYrSpread = "computed";
    }
  } else {
    warnings.push(
      `FRED unavailable, using Yahoo interpolated 2Y yield`
    );
  }

  // --- Calendar (fill calendar/event fields) ---
  if (calendarResult.status === "fulfilled") {
    const calSignals = calendarResult.value as Partial<GlobalSignals>;
    for (const field of CALENDAR_FIELDS) {
      const calValue = calSignals[field];
      if (calValue !== undefined && calValue !== null) {
        (signals as any)[field] = calValue;
        sources[field] = "calendar";
      }
    }
  } else {
    warnings.push(`Calendar lookup failed: ${calendarResult.reason}`);
  }

  // --- Count populated fields ---
  const fieldsPopulated = Object.entries(signals).filter(
    ([, v]) => isPopulated(v)
  ).length;

  return {
    signals,
    fieldsPopulated,
    sources,
    warnings,
  };
}

/**
 * Create an empty GlobalSignals object with all fields set to their
 * type-appropriate defaults. Used as fallback when Yahoo fails.
 */
function createEmptySignals(): GlobalSignals {
  return {
    // Index Futures
    spFuturesChange: 0,
    nasdaqFuturesChange: 0,
    dowFuturesChange: 0,
    russellFuturesChange: 0,
    vixFuturesChange: 0,

    // Volatility & Options
    vix: 0,
    vixChange: 0,
    vixTermStructure: "contango",
    vix9d: 0,
    vix3m: 0,
    skewIndex: 0,
    putCallRatio: 0,
    spxGammaExposure: "neutral",

    // Rates & Yield Curve
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

    // Dollar & Currencies
    dollarIndex: 0,
    dollarIndexChange: 0,
    eurUsd: 0,
    eurUsdChange: 0,
    usdJpy: 0,
    usdJpyChange: 0,
    usdCny: 0,
    usdCnyChange: 0,

    // Commodities
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

    // International Equity
    nikkeiChange: 0,
    daxChange: 0,
    ftseChange: 0,
    shanghaiChange: 0,
    hangSengChange: 0,
    kospiChange: 0,
    emChange: 0,
    euroStoxx50Change: 0,

    // Credit & Fixed Income
    highYieldSpread: 0,
    spreadChange: 0,
    igSpread: 0,
    igSpreadChange: 0,
    cdsIndex: 0,
    tedSpread: 0,
    mbs30YrSpread: 0,

    // Equity Breadth
    advanceDeclineRatio: 0,
    newHighsNewLows: 0,
    percentAbove200DMA: 0,
    percentAbove50DMA: 0,
    mcclellanOscillator: 0,

    // Sectors
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

    // Sentiment & Flows
    aaiiBullBear: 0,
    cnnFearGreed: 0,
    naaim: 0,
    marginDebt: "flat",
    etfFlows: "flat",

    // Crypto
    bitcoinChange: 0,
    ethereumChange: 0,
    btcDominance: 0,
    cryptoTotalMarketCapChange: 0,

    // Liquidity & Monetary
    sofr: 0,
    repoRate: 0,
    fedBalanceSheet: "flat",
    tgaBalance: "flat",

    // Calendar & Events
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

    // Geopolitical
    geopoliticalRisk: "low",
    geopoliticalEvents: "",

    // Recent Context
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
