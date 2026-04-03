// ============================================================
// SIGNAL - Market Regime Assessment
// ============================================================
// Synthesizes global factors into a structured regime that feeds
// directly into conviction scoring. This is the bridge between
// "monitoring everything" and "making trade decisions."
//
// The regime assessment runs every morning before trade generation.
// It answers: what TYPE of day is this, and what does that mean
// for which trades to look for?
// ============================================================

import { TradeDirection } from "./types";

// --- Regime Types ---

export type MarketRegime =
  | "risk-on"        // Strong bullish momentum, low vol, buy dips
  | "risk-off"       // Defensive, flight to quality, sell rallies
  | "rotation"       // Money moving between sectors, not directional
  | "range-bound"    // Low conviction either way, choppy
  | "crisis"         // VIX 30+, correlation spike, liquidity drying up
  | "event-driven";  // Binary catalyst dominates (FOMC, elections, CPI)

export type VolatilityRegime = "compressed" | "normal" | "elevated" | "extreme";

export interface GlobalSignals {
  // ---- INDEX FUTURES (pre-market) ----
  spFuturesChange: number;     // S&P 500 futures % change from prior close
  nasdaqFuturesChange: number;
  dowFuturesChange: number;
  russellFuturesChange: number; // Small-cap sentiment divergence
  vixFuturesChange: number;    // VIX futures % change

  // ---- VOLATILITY & OPTIONS ----
  vix: number;
  vixChange: number;           // % change from prior close
  vixTermStructure: "contango" | "flat" | "backwardation";
  vix9d: number;               // 9-day VIX (near-term fear)
  vix3m: number;               // 3-month VIX (longer-term fear)
  skewIndex: number;           // CBOE SKEW — tail risk pricing (>130 = elevated)
  putCallRatio: number;        // Total equity put/call ratio (>1.0 = bearish sentiment)
  spxGammaExposure: "positive" | "neutral" | "negative"; // Dealer gamma: positive = suppressed vol, negative = amplified vol

  // ---- RATES & YIELD CURVE ----
  tenYearYield: number;
  tenYearYieldChange: number;  // bps change
  twoYearYield: number;
  twoYearYieldChange: number;
  thirtyYearYield: number;
  threeMonthYield: number;
  twoTenSpread: number;        // 2Y-10Y spread (negative = inverted)
  threeMoTenYrSpread: number;  // 3M-10Y spread (Fed's preferred recession indicator)
  realYield10Y: number;        // 10Y TIPS yield (real rate)
  fedFundsRate: number;
  fedFundsExpected: number;    // Next meeting implied rate (Fed Funds futures)

  // ---- DOLLAR & CURRENCIES ----
  dollarIndex: number;
  dollarIndexChange: number;
  eurUsd: number;
  eurUsdChange: number;
  usdJpy: number;
  usdJpyChange: number;        // Yen carry trade indicator
  usdCny: number;
  usdCnyChange: number;        // China devaluation signal

  // ---- COMMODITIES ----
  oilWTI: number;
  oilChange: number;
  brentOil: number;
  brentOilChange: number;
  natGasChange: number;        // Weather/energy demand proxy
  goldPrice: number;
  goldChange: number;
  silverChange: number;
  copperChange: number;        // Dr. Copper = economic bellwether
  ironOreChange: number;       // China construction/industrial demand
  wheatChange: number;         // Food inflation signal
  uraniumChange: number;       // Nuclear/energy transition signal
  balticDryIndex: number;      // Global shipping/trade demand
  balticDryChange: number;

  // ---- INTERNATIONAL EQUITY ----
  nikkeiChange: number;
  daxChange: number;
  ftseChange: number;
  shanghaiChange: number;
  hangSengChange: number;      // Hong Kong/China tech proxy
  kospiChange: number;         // South Korea semiconductor proxy
  emChange: number;            // MSCI EM index % change
  euroStoxx50Change: number;

  // ---- CREDIT & FIXED INCOME ----
  highYieldSpread: number;     // HY-IG spread; widening = stress
  spreadChange: number;
  igSpread: number;            // Investment grade spread
  igSpreadChange: number;
  cdsIndex: number;            // CDX NA IG spread (credit default swaps)
  tedSpread: number;           // T-bill vs LIBOR/SOFR spread (bank stress)
  mbs30YrSpread: number;       // Mortgage-backed securities spread (housing/bank stress)

  // ---- EQUITY BREADTH ----
  advanceDeclineRatio: number; // NYSE advance/decline ratio (>1.5 = strong breadth, <0.5 = weak)
  newHighsNewLows: number;     // Net new 52-week highs minus lows
  percentAbove200DMA: number;  // % of S&P 500 stocks above 200-day MA
  percentAbove50DMA: number;   // % of S&P 500 stocks above 50-day MA
  mcclellanOscillator: number; // Breadth thrust indicator (-100 to +100)

  // ---- SECTOR PERFORMANCE (prior day % change) ----
  xlkChange: number;           // Tech
  xlfChange: number;           // Financials
  xleChange: number;           // Energy
  xlvChange: number;           // Healthcare
  xlpChange: number;           // Consumer Staples (defensive)
  xluChange: number;           // Utilities (defensive/rate-sensitive)
  xlreChange: number;          // Real Estate (rate-sensitive)
  xliChange: number;           // Industrials (cyclical)
  xlbChange: number;           // Materials (cyclical)
  xlcChange: number;           // Communications
  xlyChange: number;           // Consumer Discretionary
  smhChange: number;           // Semiconductors (AI/tech bellwether)

  // ---- SENTIMENT & FLOWS ----
  aaiiBullBear: number;        // AAII bull-bear spread (contrarian: extreme = fade)
  cnnFearGreed: number;        // CNN Fear & Greed Index (0-100)
  naaim: number;               // NAAIM Exposure Index (active manager equity exposure 0-200)
  marginDebt: "increasing" | "flat" | "decreasing"; // NYSE margin debt trend
  etfFlows: "inflows" | "flat" | "outflows"; // Broad equity ETF flow direction

  // ---- CRYPTO ----
  bitcoinChange: number;
  ethereumChange: number;
  btcDominance: number;        // BTC dominance % (>50 = risk-off within crypto)
  cryptoTotalMarketCapChange: number;

  // ---- LIQUIDITY & MONETARY ----
  sofr: number;                // Secured Overnight Financing Rate
  repoRate: number;            // Overnight repo rate (liquidity stress)
  fedBalanceSheet: "expanding" | "flat" | "contracting"; // QE/QT indicator
  tgaBalance: "increasing" | "flat" | "decreasing"; // Treasury General Account (liquidity drain/inject)

  // ---- CALENDAR & EVENTS ----
  hasMajorEconData: boolean;   // CPI, NFP, FOMC, GDP
  econDataType: string;        // Specific: "CPI", "NFP", "FOMC", "GDP", "ISM", "PPI", etc.
  hasEarningsOfNote: boolean;  // Mega-cap or market-moving earnings
  earningsNames: string;       // Which companies: "AAPL, MSFT, AMZN"
  isOpexWeek: boolean;         // Options expiration week
  isOpexDay: boolean;          // Specific OPEX day (quadruple witching, monthly)
  isMonthEnd: boolean;
  isQuarterEnd: boolean;
  daysToFOMC: number;
  daysToNextCPI: number;
  daysToNextNFP: number;
  isExDividendHeavy: boolean;  // Heavy ex-dividend day (index rebalance effect)

  // ---- GEOPOLITICAL ----
  geopoliticalRisk: "low" | "moderate" | "elevated" | "high"; // Overall geopolitical tension
  geopoliticalEvents: string;  // Brief description of any active geopolitical situations

  // ---- RECENT CONTEXT (multi-day) ----
  spConsecutiveUpDays: number;
  spConsecutiveDownDays: number;
  sp5DayReturn: number;        // % return over last 5 sessions
  sp20DayReturn: number;       // % return over last 20 sessions (monthly trend)
  nasdaqVsRussell5d: number;   // Nasdaq minus Russell 5-day return (growth vs value divergence)
  sp52WeekRange: number;       // Where S&P sits in 52-week range (0-100, 100=high)
  spDistanceFrom200DMA: number; // % distance from 200-day MA (>5 = extended, <-5 = oversold)
  spDistanceFrom50DMA: number;  // % distance from 50-day MA
}

export interface RegimeAssessment {
  regime: MarketRegime;
  volatilityRegime: VolatilityRegime;
  confidence: number;          // 0-100, how clear is the regime signal

  // Directional bias from global signals (-100 to +100)
  // Negative = bearish, Positive = bullish, 0 = neutral
  directionalBias: number;

  // Sector tilts based on regime
  sectorTilts: {
    sector: string;
    bias: "overweight" | "neutral" | "underweight";
    reason: string;
  }[];

  // Conviction modifiers that feed into the scoring algorithm
  convictionModifiers: {
    longPenalty: number;       // Subtract from long conviction (0 in risk-on, 5-15 in risk-off)
    shortPenalty: number;      // Subtract from short conviction (0 in risk-off, 5-15 in risk-on)
    targetMultiplier: number;  // Scale targets (0.7 in low-vol, 1.5 in high-vol)
    minConvictionOverride?: number; // Raise threshold on ambiguous days
  };

  // Key factors driving the assessment
  keyFactors: string[];

  // Generated at
  timestamp: string;
}

// --- Regime Classification Logic ---

export function classifyRegime(signals: GlobalSignals): RegimeAssessment {
  const factors: string[] = [];

  // Step 1: Volatility regime
  const volRegime = classifyVolatility(signals.vix, signals.vixChange);

  // Step 2: Detect crisis
  if (volRegime === "extreme" || signals.vixTermStructure === "backwardation") {
    factors.push(`VIX ${signals.vix} (${volRegime}), term structure ${signals.vixTermStructure}`);
    return buildCrisisRegime(signals, volRegime, factors);
  }

  // Step 3: Detect event-driven
  if (signals.hasMajorEconData || (signals.hasEarningsOfNote && signals.daysToFOMC <= 1)) {
    factors.push("Major economic data or imminent FOMC");
    return buildEventDrivenRegime(signals, volRegime, factors);
  }

  // Step 4: Assess directional bias from global signals
  let bias = 0;

  // Futures direction (±20 points)
  const avgFutures = (signals.spFuturesChange + signals.nasdaqFuturesChange) / 2;
  bias += avgFutures * 15;
  if (Math.abs(avgFutures) > 0.3) factors.push(`Futures ${avgFutures > 0 ? "+" : ""}${avgFutures.toFixed(2)}%`);

  // Small-cap divergence — Russell leading/lagging signals breadth (±5 points)
  const russellDivergence = signals.russellFuturesChange - avgFutures;
  if (Math.abs(russellDivergence) > 0.3) {
    bias += russellDivergence * 5;
    factors.push(`Russell ${russellDivergence > 0 ? "leading" : "lagging"} by ${Math.abs(russellDivergence).toFixed(2)}pp`);
  }

  // Yield moves (±10 points)
  if (Math.abs(signals.tenYearYieldChange) > 5) {
    bias -= signals.tenYearYieldChange * 1.2;
    factors.push(`10Y yield ${signals.tenYearYieldChange > 0 ? "+" : ""}${signals.tenYearYieldChange}bps`);
  }

  // Dollar strength (±8 points)
  if (Math.abs(signals.dollarIndexChange) > 0.3) {
    bias -= signals.dollarIndexChange * 8;
    factors.push(`Dollar ${signals.dollarIndexChange > 0 ? "+" : ""}${signals.dollarIndexChange.toFixed(2)}%`);
  }

  // International signals — expanded to 6 markets (±8 points)
  const intlAvg = (signals.nikkeiChange + signals.daxChange + signals.shanghaiChange +
    signals.ftseChange + signals.hangSengChange + signals.kospiChange) / 6;
  bias += intlAvg * 6;
  if (Math.abs(intlAvg) > 0.5) factors.push(`International avg ${intlAvg > 0 ? "+" : ""}${intlAvg.toFixed(2)}%`);

  // Copper as economic signal (±5 points)
  if (Math.abs(signals.copperChange) > 1) {
    bias += signals.copperChange * 4;
    factors.push(`Copper ${signals.copperChange > 0 ? "+" : ""}${signals.copperChange.toFixed(1)}%`);
  }

  // Credit spreads (±8 points)
  if (signals.spreadChange > 5) {
    bias -= signals.spreadChange * 1.5;
    factors.push(`HY spreads widening +${signals.spreadChange}bps`);
  } else if (signals.spreadChange < -5) {
    bias += Math.abs(signals.spreadChange) * 0.5;
    factors.push(`HY spreads tightening ${signals.spreadChange}bps`);
  }

  // Gold as fear signal (±5 points)
  if (signals.goldChange > 1) {
    bias -= 4;
    factors.push(`Gold +${signals.goldChange.toFixed(1)}%`);
  }

  // Equity breadth (±8 points)
  if (signals.percentAbove200DMA > 70) {
    bias += 5;
    factors.push(`Strong breadth: ${signals.percentAbove200DMA}% above 200 DMA`);
  } else if (signals.percentAbove200DMA < 40) {
    bias -= 5;
    factors.push(`Weak breadth: ${signals.percentAbove200DMA}% above 200 DMA`);
  }
  if (signals.advanceDeclineRatio > 2.0) {
    bias += 3;
  } else if (signals.advanceDeclineRatio < 0.5) {
    bias -= 3;
  }

  // Sector internals: cyclicals vs defensives (±5 points)
  const cyclicalAvg = (signals.xlyChange + signals.xliChange + signals.xlbChange) / 3;
  const defensiveAvg = (signals.xlpChange + signals.xluChange + signals.xlvChange) / 3;
  if (cyclicalAvg - defensiveAvg > 0.5) {
    bias += 4;
    factors.push("Cyclicals outperforming defensives");
  } else if (defensiveAvg - cyclicalAvg > 0.5) {
    bias -= 4;
    factors.push("Defensives outperforming cyclicals");
  }

  // Sentiment (±5 points) — contrarian at extremes
  if (signals.cnnFearGreed < 20) {
    bias += 3; // Extreme fear = contrarian bullish
    factors.push(`Extreme fear (F&G: ${signals.cnnFearGreed})`);
  } else if (signals.cnnFearGreed > 80) {
    bias -= 3; // Extreme greed = contrarian bearish
    factors.push(`Extreme greed (F&G: ${signals.cnnFearGreed})`);
  }

  // Crypto as risk sentiment (±4 points)
  if (Math.abs(signals.bitcoinChange) > 3) {
    bias += signals.bitcoinChange > 0 ? 3 : -3;
    factors.push(`Bitcoin ${signals.bitcoinChange > 0 ? "+" : ""}${signals.bitcoinChange.toFixed(1)}%`);
  }

  // Yen as risk proxy (±4 points) — JPY strengthening = risk-off
  if (Math.abs(signals.usdJpyChange) > 0.5) {
    bias += signals.usdJpyChange * 3; // JPY weakening (USD/JPY up) = risk-on
    factors.push(`USD/JPY ${signals.usdJpyChange > 0 ? "+" : ""}${signals.usdJpyChange.toFixed(2)}%`);
  }

  // Recent momentum (±5 points)
  if (signals.spConsecutiveUpDays >= 5) {
    bias -= 5;
    factors.push(`${signals.spConsecutiveUpDays} consecutive up days — overbought`);
  } else if (signals.spConsecutiveDownDays >= 5) {
    bias += 5;
    factors.push(`${signals.spConsecutiveDownDays} consecutive down days — oversold`);
  }

  // 52-week range positioning (±3 points)
  if (signals.sp52WeekRange > 90) {
    bias -= 2; // Near highs — extended
    factors.push("S&P near 52-week high");
  } else if (signals.sp52WeekRange < 20) {
    bias += 2; // Near lows — potential bounce
    factors.push("S&P near 52-week low");
  }

  // Clamp bias to -100..100
  bias = Math.max(-100, Math.min(100, Math.round(bias)));

  // Step 5: Classify regime from bias + context
  let regime: MarketRegime;

  // Rotation detection: sectors diverging significantly while index is flat
  const sectorChanges = [
    signals.xlkChange, signals.xlfChange, signals.xleChange, signals.xlvChange,
    signals.xlpChange, signals.xluChange, signals.xlreChange, signals.xliChange,
    signals.xlbChange, signals.xlcChange, signals.xlyChange, signals.smhChange,
  ].filter(v => v !== 0);
  const sectorDispersion = sectorChanges.length > 2
    ? Math.max(...sectorChanges) - Math.min(...sectorChanges)
    : 0;
  const isRotating = sectorDispersion > 2.0 && Math.abs(avgFutures) < 0.5;

  if (Math.abs(bias) < 15 && volRegime === "normal" && !isRotating) {
    regime = "range-bound";
  } else if (isRotating && Math.abs(bias) < 30) {
    regime = "rotation";
    factors.push(`Sector dispersion ${sectorDispersion.toFixed(1)}pp with flat futures — rotation day`);
  } else if (bias > 25) {
    regime = "risk-on";
  } else if (bias < -25) {
    regime = "risk-off";
  } else if (Math.abs(bias) < 15) {
    regime = "range-bound";
  } else {
    regime = "rotation";
  }

  // Step 6: Build conviction modifiers
  const modifiers = buildConvictionModifiers(regime, volRegime, signals);

  return {
    regime,
    volatilityRegime: volRegime,
    confidence: Math.min(100, Math.abs(bias) + 30),
    directionalBias: bias,
    sectorTilts: buildSectorTilts(regime, signals),
    convictionModifiers: modifiers,
    keyFactors: factors,
    timestamp: new Date().toISOString(),
  };
}

function classifyVolatility(vix: number, vixChange: number): VolatilityRegime {
  if (vix >= 35) return "extreme";
  if (vix >= 22 || vixChange > 15) return "elevated";
  if (vix <= 13) return "compressed";
  return "normal";
}

function buildCrisisRegime(
  signals: GlobalSignals,
  volRegime: VolatilityRegime,
  factors: string[],
): RegimeAssessment {
  factors.push("CRISIS REGIME: elevated correlation, liquidity stress");
  return {
    regime: "crisis",
    volatilityRegime: volRegime,
    confidence: 90,
    directionalBias: -60,
    sectorTilts: [
      { sector: "tech", bias: "underweight", reason: "High-beta sells first in crisis" },
      { sector: "utilities", bias: "overweight", reason: "Defensive rotation" },
      { sector: "healthcare", bias: "overweight", reason: "Defensive rotation" },
      { sector: "financials", bias: "underweight", reason: "Credit stress" },
    ],
    convictionModifiers: {
      longPenalty: 15,       // Very hard to go long in crisis
      shortPenalty: 0,
      targetMultiplier: 1.5, // Wider moves in crisis
      minConvictionOverride: 80, // Only high-conviction trades
    },
    keyFactors: factors,
    timestamp: new Date().toISOString(),
  };
}

function buildEventDrivenRegime(
  signals: GlobalSignals,
  volRegime: VolatilityRegime,
  factors: string[],
): RegimeAssessment {
  const bias = (signals.spFuturesChange + signals.nasdaqFuturesChange) / 2 * 15;
  // Training insight: pre-data trades on CPI/NFP days are gambling (Trials 13, 19, 21).
  // Soft CPI reliably rallies but hot CPI does NOT reliably sell off.
  // Apply a -5 penalty to all directions on scheduled data days.
  const dataDayPenalty = signals.hasMajorEconData ? 5 : 0;

  return {
    regime: "event-driven",
    volatilityRegime: volRegime,
    confidence: 70,
    directionalBias: Math.round(bias),
    sectorTilts: [],
    convictionModifiers: {
      longPenalty: dataDayPenalty,
      shortPenalty: dataDayPenalty,
      targetMultiplier: signals.hasMajorEconData ? 1.2 : 1.0,
      minConvictionOverride: signals.hasMajorEconData ? 77 : undefined,
    },
    keyFactors: factors,
    timestamp: new Date().toISOString(),
  };
}

function buildConvictionModifiers(
  regime: MarketRegime,
  volRegime: VolatilityRegime,
  signals: GlobalSignals,
): RegimeAssessment["convictionModifiers"] {
  switch (regime) {
    case "risk-on":
      return {
        longPenalty: 0,
        shortPenalty: 8,      // Shorting into momentum is hard
        targetMultiplier: 1.0,
      };
    case "risk-off":
      return {
        longPenalty: 8,       // Buying into weakness is hard
        shortPenalty: 0,
        targetMultiplier: 1.1,
      };
    case "rotation":
      return {
        longPenalty: 3,
        shortPenalty: 3,
        targetMultiplier: 0.9, // Rotation days have less follow-through
      };
    case "range-bound":
      return {
        longPenalty: 5,
        shortPenalty: 5,
        targetMultiplier: 0.7, // Tight ranges
        minConvictionOverride: 78, // Higher bar on boring days
      };
    default:
      return { longPenalty: 0, shortPenalty: 0, targetMultiplier: 1.0 };
  }
}

function buildSectorTilts(
  regime: MarketRegime,
  signals: GlobalSignals,
): RegimeAssessment["sectorTilts"] {
  const tilts: RegimeAssessment["sectorTilts"] = [];

  if (regime === "risk-on") {
    tilts.push({ sector: "tech", bias: "overweight", reason: "Risk-on favors growth/momentum" });
    tilts.push({ sector: "consumer-discretionary", bias: "overweight", reason: "Risk appetite" });
    tilts.push({ sector: "utilities", bias: "underweight", reason: "Defensive rotation out" });
    if (signals.smhChange > 1) tilts.push({ sector: "semiconductors", bias: "overweight", reason: `SMH +${signals.smhChange.toFixed(1)}%, AI/tech bellwether leading` });
  } else if (regime === "risk-off") {
    tilts.push({ sector: "utilities", bias: "overweight", reason: "Defensive haven" });
    tilts.push({ sector: "healthcare", bias: "overweight", reason: "Defensive haven" });
    tilts.push({ sector: "staples", bias: "overweight", reason: "Defensive rotation" });
    tilts.push({ sector: "tech", bias: "underweight", reason: "De-risking from high-beta" });
  }

  // Yield-sensitive tilts
  if (signals.tenYearYieldChange > 5) {
    tilts.push({ sector: "financials", bias: "overweight", reason: "Rising yields boost NIM" });
    tilts.push({ sector: "real-estate", bias: "underweight", reason: "Rising rates pressure REITs" });
    tilts.push({ sector: "utilities", bias: "underweight", reason: "Bond proxy underperforms when yields rise" });
  } else if (signals.tenYearYieldChange < -5) {
    tilts.push({ sector: "real-estate", bias: "overweight", reason: "Falling rates boost REITs" });
    tilts.push({ sector: "utilities", bias: "overweight", reason: "Bond proxy rally" });
  }

  // Oil-sensitive tilts
  if (signals.oilChange > 2) {
    tilts.push({ sector: "energy", bias: "overweight", reason: `Oil +${signals.oilChange.toFixed(1)}%` });
    tilts.push({ sector: "airlines", bias: "underweight", reason: "Fuel cost headwind" });
  } else if (signals.oilChange < -2) {
    tilts.push({ sector: "airlines", bias: "overweight", reason: "Fuel cost tailwind" });
    tilts.push({ sector: "consumer-discretionary", bias: "overweight", reason: "Lower gas prices" });
  }

  // Semiconductor momentum — AI capex cycle
  if (signals.smhChange > 2 || signals.kospiChange > 1.5) {
    tilts.push({ sector: "semiconductors", bias: "overweight", reason: "Semi momentum + Korea leading (fab demand)" });
  } else if (signals.smhChange < -2) {
    tilts.push({ sector: "semiconductors", bias: "underweight", reason: `SMH ${signals.smhChange.toFixed(1)}%, semi weakness` });
  }

  // Materials/industrials — copper and Baltic Dry driven
  if (signals.copperChange > 1.5 || signals.balticDryChange > 2) {
    tilts.push({ sector: "materials", bias: "overweight", reason: "Copper/shipping demand rising — industrial expansion" });
    tilts.push({ sector: "industrials", bias: "overweight", reason: "Cyclical expansion signal" });
  } else if (signals.copperChange < -1.5) {
    tilts.push({ sector: "materials", bias: "underweight", reason: "Dr. Copper declining — growth concerns" });
  }

  // China-sensitive tilts
  if (signals.shanghaiChange > 1 || signals.hangSengChange > 1.5) {
    tilts.push({ sector: "materials", bias: "overweight", reason: "China recovery trade" });
  }

  return tilts;
}

// --- Integration with Conviction Scoring ---

/**
 * Apply regime-based modifiers to a raw conviction score.
 * Called after calculateConviction() to adjust for market context.
 */
export function applyRegimeModifiers(
  rawConviction: number,
  direction: TradeDirection,
  regime: RegimeAssessment,
): { adjustedConviction: number; adjustedTarget: number; reason: string } {
  const { convictionModifiers } = regime;
  const penalty = direction === "long"
    ? convictionModifiers.longPenalty
    : convictionModifiers.shortPenalty;

  const adjustedConviction = Math.max(0, rawConviction - penalty);
  const reason = penalty > 0
    ? `${regime.regime} regime: -${penalty} ${direction} penalty`
    : `${regime.regime} regime: no directional penalty`;

  return {
    adjustedConviction,
    adjustedTarget: convictionModifiers.targetMultiplier,
    reason,
  };
}

// --- Prompt Builder for Claude ---

export function buildRegimePrompt(regime: RegimeAssessment): string {
  const sectorList = regime.sectorTilts
    .map((t) => `  - ${t.sector}: ${t.bias} (${t.reason})`)
    .join("\n");

  return `
CURRENT MARKET REGIME: ${regime.regime.toUpperCase()} (confidence: ${regime.confidence}%)
Volatility: ${regime.volatilityRegime} | Directional Bias: ${regime.directionalBias > 0 ? "+" : ""}${regime.directionalBias}

Key factors driving today's regime:
${regime.keyFactors.map((f) => `- ${f}`).join("\n")}

Sector tilts:
${sectorList || "  - No strong sector tilts today"}

REGIME RULES:
- Long trades carry a -${regime.convictionModifiers.longPenalty} conviction penalty today
- Short trades carry a -${regime.convictionModifiers.shortPenalty} conviction penalty today
- Target distances should be scaled by ${regime.convictionModifiers.targetMultiplier.toFixed(1)}x
${regime.convictionModifiers.minConvictionOverride ? `- Minimum conviction RAISED to ${regime.convictionModifiers.minConvictionOverride} today (${regime.regime} regime)` : ""}
${regime.regime === "range-bound" ? "- RANGE-BOUND DAY: Consider outputting ZERO trades. Forcing trades on boring days is a losing strategy." : ""}
${regime.regime === "crisis" ? "- CRISIS MODE: Only take trades with 80+ conviction. Prefer shorts or defensive longs." : ""}
${regime.regime === "event-driven" ? "- EVENT DAY: Pre-data trades are gambling. If the primary catalyst is a scheduled release (CPI, NFP, FOMC), apply extra scrutiny. Soft CPI reliably rallies but hot CPI does NOT reliably sell off in bull markets." : ""}

Use this regime context when scoring conviction dimensions. Do NOT fight the regime.
`;
}
