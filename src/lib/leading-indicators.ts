// ============================================================
// SIGNAL - Multi-Day Leading Indicator System
// ============================================================
// Tracks GlobalSignals over time to identify BUILDING conditions
// that precede major market moves. This answers the user's core
// question: "What LED UP to these crazy days?"
//
// The system stores daily signals and computes trend metrics over
// 5, 10, and 20-day windows. These trends feed into both the
// regime assessment and conviction scoring.
//
// Key insight from training: Trials 27-28 showed that tariff
// shocks and historic rallies were preceded by DAYS of building
// signals — VIX creep, yield curve shifts, credit stress, political
// pressure. A daily snapshot misses these trends entirely.
// ============================================================

import type { GlobalSignals } from "./market-regime";

// --- Types ---

export interface SignalTrend {
  current: number;
  change5d: number;       // 5-day change (absolute)
  change10d: number;
  change20d: number;
  percentile5d: number;   // Where current sits in 5-day range (0-100)
  direction: "rising" | "falling" | "flat";
  acceleration: "accelerating" | "decelerating" | "steady";
}

export interface LeadingIndicatorReport {
  date: string;
  daysOfHistory: number;

  // Composite stress indicators
  stressIndex: number;           // 0-100, composite market stress
  stressIndexTrend: "building" | "easing" | "stable";
  stressDaysRising: number;      // Consecutive days stress has risen

  // Risk appetite indicators
  riskAppetiteIndex: number;     // 0-100, composite risk-on/risk-off
  riskAppetiteTrend: "improving" | "deteriorating" | "stable";

  // Individual signal trends (most actionable)
  trends: {
    vix: SignalTrend;
    tenYearYield: SignalTrend;
    highYieldSpread: SignalTrend;
    dollarIndex: SignalTrend;
    sp5DayReturn: SignalTrend;
    goldPrice: SignalTrend;
    oilWTI: SignalTrend;
    copperChange: SignalTrend;    // Dr. Copper = growth bellwether
    bitcoinChange: SignalTrend;   // Risk sentiment proxy
  };

  // Pattern detection
  patterns: DetectedPattern[];

  // Generated prompt section for Claude
  timestamp: string;
}

export interface DetectedPattern {
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  historicalContext: string;
  actionableInsight: string;
}

// --- Signal History ---

export interface DailySignalRecord {
  date: string;
  signals: GlobalSignals;
  regime: string;         // MarketRegime from that day
  stressIndex: number;
  riskAppetiteIndex: number;
}

// --- Core Computation ---

/**
 * Compute leading indicator report from a history of daily signals.
 * Requires at least 2 days of history; 20+ for full trend analysis.
 */
export function computeLeadingIndicators(
  history: DailySignalRecord[],
  today: GlobalSignals,
  todayDate: string,
): LeadingIndicatorReport {
  // Sort by date ascending
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));

  const stress = computeStressIndex(today);
  const riskAppetite = computeRiskAppetiteIndex(today);

  // Compute stress trend
  const stressDaysRising = countConsecutiveRising(sorted.map(r => r.stressIndex), stress);
  const stressTrend = stressDaysRising >= 3 ? "building" :
    stressDaysRising <= -3 ? "easing" : "stable";

  // Compute risk appetite trend
  const riskDaysRising = countConsecutiveRising(sorted.map(r => r.riskAppetiteIndex), riskAppetite);
  const riskTrend = riskDaysRising >= 3 ? "improving" :
    riskDaysRising <= -3 ? "deteriorating" : "stable";

  // Individual signal trends
  const trends = {
    vix: computeTrend(sorted.map(r => r.signals.vix), today.vix),
    tenYearYield: computeTrend(sorted.map(r => r.signals.tenYearYield), today.tenYearYield),
    highYieldSpread: computeTrend(sorted.map(r => r.signals.highYieldSpread), today.highYieldSpread),
    dollarIndex: computeTrend(sorted.map(r => r.signals.dollarIndex), today.dollarIndex),
    sp5DayReturn: computeTrend(sorted.map(r => r.signals.sp5DayReturn), today.sp5DayReturn),
    goldPrice: computeTrend(sorted.map(r => r.signals.goldPrice), today.goldPrice),
    oilWTI: computeTrend(sorted.map(r => r.signals.oilWTI), today.oilWTI),
    copperChange: computeTrend(sorted.map(r => r.signals.copperChange), today.copperChange),
    bitcoinChange: computeTrend(sorted.map(r => r.signals.bitcoinChange), today.bitcoinChange),
  };

  // Detect patterns
  const patterns = detectPatterns(sorted, today, stress, riskAppetite, trends);

  return {
    date: todayDate,
    daysOfHistory: sorted.length,
    stressIndex: stress,
    stressIndexTrend: stressTrend,
    stressDaysRising: Math.max(0, stressDaysRising),
    riskAppetiteIndex: riskAppetite,
    riskAppetiteTrend: riskTrend,
    trends,
    patterns,
    timestamp: new Date().toISOString(),
  };
}

// --- Stress Index (0-100) ---
// Composite of: VIX level, VIX change, credit spreads, gold strength, dollar strength

export function computeStressIndex(signals: GlobalSignals): number {
  let stress = 0;

  // VIX contribution (0-35 points)
  if (signals.vix >= 35) stress += 35;
  else if (signals.vix >= 25) stress += 20 + (signals.vix - 25) * 1.5;
  else if (signals.vix >= 18) stress += 8 + (signals.vix - 18) * 1.7;
  else if (signals.vix >= 14) stress += (signals.vix - 14) * 2;

  // VIX change contribution (0-15 points)
  if (signals.vixChange > 0) stress += Math.min(15, signals.vixChange * 0.75);

  // Credit spread contribution (0-20 points)
  // Normal HY spread ~350bps, stress >500bps
  if (signals.highYieldSpread > 500) stress += 20;
  else if (signals.highYieldSpread > 400) stress += 10 + (signals.highYieldSpread - 400) * 0.1;
  else if (signals.highYieldSpread > 350) stress += (signals.highYieldSpread - 350) * 0.2;

  // Spread widening (0-10 points)
  if (signals.spreadChange > 0) stress += Math.min(10, signals.spreadChange * 0.5);

  // Gold as fear proxy (0-10 points)
  if (signals.goldChange > 0) stress += Math.min(10, signals.goldChange * 3);

  // Dollar surge = flight to safety (0-10 points)
  if (signals.dollarIndexChange > 0) stress += Math.min(10, signals.dollarIndexChange * 5);

  return Math.min(100, Math.round(stress));
}

// --- Risk Appetite Index (0-100) ---
// Composite of: futures direction, crypto, copper, international markets, yield curve

export function computeRiskAppetiteIndex(signals: GlobalSignals): number {
  let appetite = 50; // Neutral baseline

  // Futures (±15 points)
  const avgFutures = (signals.spFuturesChange + signals.nasdaqFuturesChange) / 2;
  appetite += Math.max(-15, Math.min(15, avgFutures * 10));

  // Crypto sentiment (±10 points)
  appetite += Math.max(-10, Math.min(10, signals.bitcoinChange * 2));

  // Copper = growth bellwether (±8 points)
  appetite += Math.max(-8, Math.min(8, signals.copperChange * 3));

  // International markets (±8 points)
  const intlAvg = (signals.nikkeiChange + signals.daxChange + signals.shanghaiChange) / 3;
  appetite += Math.max(-8, Math.min(8, intlAvg * 4));

  // VIX inverse (±9 points) — low VIX = high appetite
  if (signals.vix < 14) appetite += 9;
  else if (signals.vix < 18) appetite += 4;
  else if (signals.vix > 25) appetite -= 9;
  else if (signals.vix > 20) appetite -= 4;

  return Math.max(0, Math.min(100, Math.round(appetite)));
}

// --- Trend Computation ---

function computeTrend(history: number[], current: number): SignalTrend {
  const len = history.length;

  const get = (daysAgo: number) => len >= daysAgo ? history[len - daysAgo] : null;

  const val5d = get(5);
  const val10d = get(10);
  const val20d = get(20);

  const change5d = val5d != null ? current - val5d : 0;
  const change10d = val10d != null ? current - val10d : 0;
  const change20d = val20d != null ? current - val20d : 0;

  // Percentile: where does current sit in last 5 values?
  const recent5 = history.slice(-5).concat(current);
  const sorted = [...recent5].sort((a, b) => a - b);
  const rank = sorted.indexOf(current);
  const percentile5d = recent5.length > 1 ? Math.round((rank / (recent5.length - 1)) * 100) : 50;

  // Direction from 3-day trend
  const recent3 = history.slice(-3);
  let direction: SignalTrend["direction"] = "flat";
  if (recent3.length >= 2) {
    const avg = recent3.reduce((s, v) => s + v, 0) / recent3.length;
    const diff = current - avg;
    const threshold = Math.abs(avg) * 0.01 || 0.1; // 1% of value or 0.1 minimum
    if (diff > threshold) direction = "rising";
    else if (diff < -threshold) direction = "falling";
  }

  // Acceleration: is the rate of change increasing?
  let acceleration: SignalTrend["acceleration"] = "steady";
  if (history.length >= 4) {
    const recentChange = current - history[len - 1];
    const priorChange = history[len - 1] - history[len - 2];
    if (Math.abs(recentChange) > Math.abs(priorChange) * 1.3) {
      acceleration = "accelerating";
    } else if (Math.abs(recentChange) < Math.abs(priorChange) * 0.7) {
      acceleration = "decelerating";
    }
  }

  return { current, change5d, change10d, change20d, percentile5d, direction, acceleration };
}

function countConsecutiveRising(history: number[], current: number): number {
  const values = [...history, current];
  let count = 0;
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i] > values[i - 1]) count++;
    else if (values[i] < values[i - 1]) { count = -count || -1; break; }
    else break;
  }
  return count;
}

// --- Pattern Detection ---

function detectPatterns(
  history: DailySignalRecord[],
  today: GlobalSignals,
  stress: number,
  riskAppetite: number,
  trends: LeadingIndicatorReport["trends"],
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // 1. Stress accumulation — building toward potential crisis
  if (stress > 40 && trends.vix.direction === "rising" && trends.vix.acceleration === "accelerating") {
    patterns.push({
      name: "Stress Accumulation",
      severity: stress > 65 ? "critical" : stress > 50 ? "high" : "medium",
      description: `Stress index at ${stress} with VIX rising and accelerating (${trends.vix.current} → ${trends.vix.change5d > 0 ? "+" : ""}${trends.vix.change5d.toFixed(1)} over 5d)`,
      historicalContext: "Trial 28: VIX rose from 16→45 over 4 sessions before the April 9 tariff pause rally. Stress accumulation preceded both the crash AND the reversal.",
      actionableInsight: "Watch for policy reversal catalysts. Extreme stress + political pressure = high probability of intervention. Prepare 'Day After Event' trades.",
    });
  }

  // 2. Credit spread widening — financial stress building
  if (trends.highYieldSpread.direction === "rising" && trends.highYieldSpread.change5d > 10) {
    patterns.push({
      name: "Credit Stress Building",
      severity: trends.highYieldSpread.change5d > 30 ? "high" : "medium",
      description: `HY spreads widening ${trends.highYieldSpread.change5d.toFixed(0)}bps over 5 sessions`,
      historicalContext: "Credit spreads widen before equity selloffs by 1-3 days. Bond market often leads stock market.",
      actionableInsight: "Defensive bias. Reduce long conviction, increase short conviction on high-beta names. Watch for contagion to equities.",
    });
  }

  // 3. VIX term structure inversion building
  if (today.vixTermStructure === "backwardation") {
    patterns.push({
      name: "VIX Term Structure Inversion",
      severity: "high",
      description: "VIX futures in backwardation — near-term fear exceeds long-term",
      historicalContext: "Backwardation has preceded every major selloff. Also precedes sharp reversals when fear peaks.",
      actionableInsight: "Crisis regime likely. Only high-conviction trades. If stress has been building 3+ days, watch for mean-reversion bounce.",
    });
  }

  // 4. Oversold bounce setup
  const recentCrisisDays = history.slice(-5).filter(r => r.regime === "crisis").length;
  if (today.sp5DayReturn < -5 && stress > 50 && recentCrisisDays >= 2) {
    patterns.push({
      name: "Oversold Bounce Setup",
      severity: "high",
      description: `S&P down ${today.sp5DayReturn.toFixed(1)}% over 5 sessions with ${recentCrisisDays} crisis-regime days`,
      historicalContext: "Trial 28: After -10.5% in 4 sessions, the April 9 rally was +9.5%. Trial 22: Aug 5 yen crash preceded by rapid selloff, then recovery.",
      actionableInsight: "Don't short into extreme oversold. Prepare long-biased 'Day After Event' setups. Watch for policy response or capitulation signals.",
    });
  }

  // 5. Yield curve stress — rapid moves in rates
  if (Math.abs(trends.tenYearYield.change5d) > 15) {
    const rising = trends.tenYearYield.change5d > 0;
    patterns.push({
      name: rising ? "Yield Spike" : "Yield Collapse",
      severity: Math.abs(trends.tenYearYield.change5d) > 25 ? "high" : "medium",
      description: `10Y yield moved ${trends.tenYearYield.change5d > 0 ? "+" : ""}${trends.tenYearYield.change5d.toFixed(0)}bps over 5 sessions`,
      historicalContext: rising
        ? "Rapid yield spikes pressure growth/tech stocks and rate-sensitive sectors (REITs, utilities). Bond vigilantes can force policy change."
        : "Rapid yield drops signal flight to safety. Equities may lag the move — watch for catch-down risk.",
      actionableInsight: rising
        ? "Underweight tech/growth, overweight financials. Watch for policy response if move is disorderly."
        : "Overweight rate-sensitive sectors (REITs, utilities). Watch for recession fears if yields dropping on weak data.",
    });
  }

  // 6. Dollar strength building — headwind for multinationals
  if (trends.dollarIndex.direction === "rising" && trends.dollarIndex.change5d > 1) {
    patterns.push({
      name: "Dollar Strength Building",
      severity: trends.dollarIndex.change5d > 2 ? "high" : "medium",
      description: `Dollar index up ${trends.dollarIndex.change5d.toFixed(2)} over 5 sessions`,
      historicalContext: "Strong dollar = headwind for S&P 500 multinationals (60%+ revenue international). Also pressures EM and commodities.",
      actionableInsight: "Favor domestic-revenue companies over multinationals. Bearish for commodities and EM-exposed sectors.",
    });
  }

  // 7. Copper divergence — growth signal vs equity direction
  if (trends.copperChange.direction === "falling" && riskAppetite > 55) {
    patterns.push({
      name: "Copper Divergence",
      severity: "medium",
      description: "Dr. Copper falling while risk appetite elevated — potential growth warning",
      historicalContext: "Copper often leads equities by 1-2 weeks. Falling copper with rising equities = bearish divergence.",
      actionableInsight: "Be cautious on cyclical longs. Industrial/materials sector may underperform. Watch for confirmation in ISM data.",
    });
  }

  // 8. Complacency signal — low VIX + extended rally
  if (today.vix < 14 && today.spConsecutiveUpDays >= 5 && today.sp5DayReturn > 2) {
    patterns.push({
      name: "Complacency Signal",
      severity: "medium",
      description: `VIX at ${today.vix} with ${today.spConsecutiveUpDays} consecutive up days and +${today.sp5DayReturn.toFixed(1)}% 5d return`,
      historicalContext: "Low VIX + extended rallies precede vol explosions. Mean reversion risk is elevated.",
      actionableInsight: "Reduce position sizes. Tighten stops. Consider hedges. Don't chase momentum at these levels.",
    });
  }

  // 9. Multi-day momentum exhaustion
  if ((today.spConsecutiveUpDays >= 7 || today.spConsecutiveDownDays >= 5) && trends.vix.direction === "rising") {
    const isUp = today.spConsecutiveUpDays >= 7;
    patterns.push({
      name: isUp ? "Rally Exhaustion" : "Selloff Exhaustion",
      severity: "medium",
      description: `${isUp ? today.spConsecutiveUpDays + " up" : today.spConsecutiveDownDays + " down"} days with VIX rising — momentum losing conviction`,
      historicalContext: isUp
        ? "7+ up days with rising VIX = smart money hedging while retail chases. Correction risk elevated."
        : "5+ down days typically see a 1-2 day bounce. Short covering + dip buying creates temporary relief.",
      actionableInsight: isUp
        ? "Reduce long exposure. Don't initiate new longs. Watch for first red day as reversal signal."
        : "Prepare bounce trades but keep them small. Oversold doesn't mean bottom.",
    });
  }

  return patterns;
}

// --- Prompt Builder ---

export function buildLeadingIndicatorPrompt(report: LeadingIndicatorReport): string {
  const patternSection = report.patterns.length > 0
    ? report.patterns.map(p =>
      `  [${p.severity.toUpperCase()}] ${p.name}: ${p.description}\n    Context: ${p.historicalContext}\n    Action: ${p.actionableInsight}`
    ).join("\n\n")
    : "  No significant multi-day patterns detected.";

  const trendLines = Object.entries(report.trends).map(([key, t]) => {
    const arrow = t.direction === "rising" ? "↑" : t.direction === "falling" ? "↓" : "→";
    const accel = t.acceleration === "accelerating" ? " ⚡" : t.acceleration === "decelerating" ? " 🔻" : "";
    return `  ${key}: ${t.current} ${arrow}${accel} (5d: ${t.change5d > 0 ? "+" : ""}${t.change5d.toFixed(2)}, 10d: ${t.change10d > 0 ? "+" : ""}${t.change10d.toFixed(2)})`;
  }).join("\n");

  return `
MULTI-DAY LEADING INDICATORS (${report.daysOfHistory} days of history):

Stress Index: ${report.stressIndex}/100 — ${report.stressIndexTrend.toUpperCase()}${report.stressDaysRising > 0 ? ` (${report.stressDaysRising} consecutive days rising)` : ""}
Risk Appetite: ${report.riskAppetiteIndex}/100 — ${report.riskAppetiteTrend.toUpperCase()}

Signal Trends:
${trendLines}

DETECTED PATTERNS:
${patternSection}

LEADING INDICATOR RULES:
- These trends show what is BUILDING over days/weeks, not just today's snapshot.
- When stress is "building" for 3+ days, expect a catalyst-driven resolution (crash or policy reversal).
- When risk appetite is "deteriorating" for 5+ days, even good news may not sustain rallies.
- Oversold bounce setups after 5+ days of crisis are among the highest-probability trades in the dataset.
- DO NOT fight multi-day trends. A single day's data point does not reverse a 2-week trend.
`;
}
