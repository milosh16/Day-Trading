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
  // Index futures (pre-market)
  spFuturesChange: number;     // S&P 500 futures % change from prior close
  nasdaqFuturesChange: number;
  dowFuturesChange: number;

  // Volatility
  vix: number;
  vixChange: number;           // % change from prior close
  vixTermStructure: "contango" | "flat" | "backwardation"; // backwardation = fear

  // Rates & Dollar
  tenYearYield: number;
  tenYearYieldChange: number;  // bps change
  twoYearYield: number;
  dollarIndex: number;
  dollarIndexChange: number;

  // Commodities
  oilWTI: number;
  oilChange: number;
  goldPrice: number;
  goldChange: number;
  copperChange: number;        // Dr. Copper = economic bellwether

  // International
  nikkeiChange: number;
  daxChange: number;
  shanghaiChange: number;

  // Credit
  highYieldSpread: number;     // HY-IG spread; widening = stress
  spreadChange: number;

  // Crypto
  bitcoinChange: number;

  // Calendar
  hasMajorEconData: boolean;   // CPI, NFP, FOMC, GDP
  hasEarningsOfNote: boolean;  // Mega-cap or market-moving earnings
  isOpexWeek: boolean;         // Options expiration week
  isMonthEnd: boolean;
  daysToFOMC: number;

  // Recent context
  spConsecutiveUpDays: number;
  spConsecutiveDownDays: number;
  sp5DayReturn: number;        // % return over last 5 sessions
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

  // Futures direction
  const avgFutures = (signals.spFuturesChange + signals.nasdaqFuturesChange) / 2;
  bias += avgFutures * 20; // Each 1% in futures = 20 points of bias
  if (Math.abs(avgFutures) > 0.3) factors.push(`Futures ${avgFutures > 0 ? "+" : ""}${avgFutures.toFixed(2)}%`);

  // Yield moves
  if (Math.abs(signals.tenYearYieldChange) > 5) {
    bias -= signals.tenYearYieldChange * 1.5; // Rising yields = bearish for equities
    factors.push(`10Y yield ${signals.tenYearYieldChange > 0 ? "+" : ""}${signals.tenYearYieldChange}bps`);
  }

  // Dollar strength
  if (Math.abs(signals.dollarIndexChange) > 0.3) {
    bias -= signals.dollarIndexChange * 10; // Strong dollar = headwind for equities
    factors.push(`Dollar ${signals.dollarIndexChange > 0 ? "+" : ""}${signals.dollarIndexChange.toFixed(2)}%`);
  }

  // International signals
  const intlAvg = (signals.nikkeiChange + signals.daxChange + signals.shanghaiChange) / 3;
  bias += intlAvg * 8;
  if (Math.abs(intlAvg) > 0.5) factors.push(`International avg ${intlAvg > 0 ? "+" : ""}${intlAvg.toFixed(2)}%`);

  // Copper as economic signal
  if (Math.abs(signals.copperChange) > 1) {
    bias += signals.copperChange * 5;
    factors.push(`Copper ${signals.copperChange > 0 ? "+" : ""}${signals.copperChange.toFixed(1)}%`);
  }

  // Credit spreads
  if (signals.spreadChange > 5) {
    bias -= signals.spreadChange * 2;
    factors.push(`HY spreads widening +${signals.spreadChange}bps`);
  }

  // Gold as fear signal
  if (signals.goldChange > 1) {
    bias -= 5; // Gold up = fear
    factors.push(`Gold +${signals.goldChange.toFixed(1)}%`);
  }

  // Recent momentum
  if (signals.spConsecutiveUpDays >= 5) {
    bias -= 5; // Mean reversion risk
    factors.push(`${signals.spConsecutiveUpDays} consecutive up days — overbought`);
  } else if (signals.spConsecutiveDownDays >= 5) {
    bias += 5; // Bounce likely
    factors.push(`${signals.spConsecutiveDownDays} consecutive down days — oversold`);
  }

  // Clamp bias to -100..100
  bias = Math.max(-100, Math.min(100, Math.round(bias)));

  // Step 5: Classify regime from bias + context
  let regime: MarketRegime;
  if (Math.abs(bias) < 15 && volRegime === "normal") {
    regime = "range-bound";
  } else if (bias > 25) {
    regime = "risk-on";
  } else if (bias < -25) {
    regime = "risk-off";
  } else {
    // Check for rotation signals: sectors diverging
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
  } else if (regime === "risk-off") {
    tilts.push({ sector: "utilities", bias: "overweight", reason: "Defensive haven" });
    tilts.push({ sector: "healthcare", bias: "overweight", reason: "Defensive haven" });
    tilts.push({ sector: "tech", bias: "underweight", reason: "De-risking from high-beta" });
  }

  // Yield-sensitive tilts
  if (signals.tenYearYieldChange > 5) {
    tilts.push({ sector: "financials", bias: "overweight", reason: "Rising yields boost NIM" });
    tilts.push({ sector: "real-estate", bias: "underweight", reason: "Rising rates pressure REITs" });
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
