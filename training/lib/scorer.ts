// ============================================================
// Training - Outcome Scorer
// ============================================================
// Scores trade recommendations against REAL Yahoo Finance data.
// Zero tokens, zero leakage — deterministic price lookups.
// ============================================================

import type { TradeRecommendation, RealOutcome, ConvictionWeights } from "./types.ts";
import { getMultiDayOHLC, type OHLC } from "./market-data.ts";

// Score recommendations against REAL price data from Yahoo Finance API.
// No LLM involved — deterministic, zero tokens, zero leakage risk.
export async function scoreRecommendations(
  date: string,
  recommendations: TradeRecommendation[]
): Promise<{ outcomes: RealOutcome[]; tokensUsed: number }> {
  if (recommendations.length === 0) {
    return { outcomes: [], tokensUsed: 0 };
  }

  const outcomes: RealOutcome[] = [];

  for (const rec of recommendations) {
    // Get OHLC for trading day + next 2 days (3-day window for trade to play out)
    const bars = await getMultiDayOHLC(rec.symbol, date, 3);

    if (bars.length === 0) {
      console.log(`    ${rec.symbol}: no price data from Yahoo Finance`);
      outcomes.push({
        symbol: rec.symbol,
        openPrice: 0,
        highPrice: 0,
        lowPrice: 0,
        closePrice: 0,
        hitTarget: false,
        hitStop: false,
        directionCorrect: false,
        actualReturnPercent: 0,
        notes: "data unavailable",
      });
      continue;
    }

    // Use first day as primary bar
    const primary = bars[0];

    // Check target/stop across entire multi-day window
    const allTimeHigh = Math.max(...bars.map((b) => b.high));
    const allTimeLow = Math.min(...bars.map((b) => b.low));
    const lastClose = bars[bars.length - 1].close;

    const isLong = rec.direction === "long";
    const hitTarget = isLong
      ? allTimeHigh >= rec.targetPrice
      : allTimeLow <= rec.targetPrice;
    const hitStop = isLong
      ? allTimeLow <= rec.stopLoss
      : allTimeHigh >= rec.stopLoss;
    const directionCorrect = isLong
      ? lastClose > rec.entryPrice
      : lastClose < rec.entryPrice;

    // Return from entry to last close
    const returnPct = isLong
      ? ((lastClose - rec.entryPrice) / rec.entryPrice) * 100
      : ((rec.entryPrice - lastClose) / rec.entryPrice) * 100;

    const daysStr = bars.map((b) => b.date).join(", ");
    const notes = `${bars.length}-day window (${daysStr}). Open $${primary.open}, High $${allTimeHigh}, Low $${allTimeLow}, Close $${lastClose}.`;

    outcomes.push({
      symbol: rec.symbol,
      openPrice: primary.open,
      highPrice: allTimeHigh,
      lowPrice: allTimeLow,
      closePrice: lastClose,
      hitTarget,
      hitStop,
      directionCorrect,
      actualReturnPercent: Math.round(returnPct * 100) / 100,
      notes,
    });

    console.log(`    ${rec.symbol}: open=$${primary.open} high=$${allTimeHigh} low=$${allTimeLow} close=$${lastClose} | target=${hitTarget} stop=${hitStop} dir=${directionCorrect} ret=${returnPct.toFixed(2)}%`);
  }

  return {
    outcomes,
    tokensUsed: 0, // No API tokens — deterministic Yahoo Finance lookup
  };
}

// Calculate composite scores from outcomes
export function calculateScores(
  recommendations: TradeRecommendation[],
  outcomes: RealOutcome[]
): {
  directionAccuracy: number;
  targetHitRate: number;
  stopHitRate: number;
  avgReturnPercent: number;
  profitFactor: number;
  winRate: number;
  totalScore: number;
} {
  if (outcomes.length === 0) {
    return {
      directionAccuracy: 0,
      targetHitRate: 0,
      stopHitRate: 0,
      avgReturnPercent: 0,
      profitFactor: 0,
      winRate: 0,
      totalScore: 0,
    };
  }

  const validOutcomes = outcomes.filter((o) => o.notes !== "data unavailable");
  if (validOutcomes.length === 0) {
    return {
      directionAccuracy: 0,
      targetHitRate: 0,
      stopHitRate: 0,
      avgReturnPercent: 0,
      profitFactor: 0,
      winRate: 0,
      totalScore: 0,
    };
  }

  const n = validOutcomes.length;
  const directionCorrect = validOutcomes.filter((o) => o.directionCorrect).length;
  const targetHits = validOutcomes.filter((o) => o.hitTarget).length;
  const stopHits = validOutcomes.filter((o) => o.hitStop).length;
  const wins = validOutcomes.filter((o) => o.actualReturnPercent > 0).length;
  const avgReturn = validOutcomes.reduce((s, o) => s + o.actualReturnPercent, 0) / n;
  const grossProfit = validOutcomes.filter((o) => o.actualReturnPercent > 0).reduce((s, o) => s + o.actualReturnPercent, 0);
  const grossLoss = Math.abs(validOutcomes.filter((o) => o.actualReturnPercent < 0).reduce((s, o) => s + o.actualReturnPercent, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 0;

  const directionAccuracy = (directionCorrect / n) * 100;
  const targetHitRate = (targetHits / n) * 100;
  const stopHitRate = (stopHits / n) * 100;
  const winRate = (wins / n) * 100;

  // Composite score: weighted combination
  // Direction accuracy: 25%, target hit rate: 25%, win rate: 20%, profit factor: 15%, stop avoidance: 15%
  const stopAvoidance = 100 - stopHitRate;
  const pfScore = Math.min(100, profitFactor * 20); // cap at 100

  const totalScore =
    directionAccuracy * 0.25 +
    targetHitRate * 0.25 +
    winRate * 0.20 +
    pfScore * 0.15 +
    stopAvoidance * 0.15;

  return {
    directionAccuracy: Math.round(directionAccuracy * 10) / 10,
    targetHitRate: Math.round(targetHitRate * 10) / 10,
    stopHitRate: Math.round(stopHitRate * 10) / 10,
    avgReturnPercent: Math.round(avgReturn * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    winRate: Math.round(winRate * 10) / 10,
    totalScore: Math.round(totalScore * 10) / 10,
  };
}

// Analyze which conviction dimensions predict winners vs losers
export function analyzeDimensions(
  recommendations: TradeRecommendation[],
  outcomes: RealOutcome[]
): Record<string, { avgScoreWinners: number; avgScoreLosers: number; predictivePower: number }> {
  const dims = [
    "catalystClarity", "technicalSetup", "riskReward",
    "volumeLiquidity", "marketAlignment", "informationEdge", "timingUrgency",
  ] as const;

  const result: Record<string, { avgScoreWinners: number; avgScoreLosers: number; predictivePower: number }> = {};

  for (const dim of dims) {
    const winners: number[] = [];
    const losers: number[] = [];

    for (let i = 0; i < recommendations.length; i++) {
      const rec = recommendations[i];
      const outcome = outcomes.find((o) => o.symbol === rec.symbol);
      if (!outcome || outcome.notes === "data unavailable") continue;

      const score = rec.conviction[dim].score;
      if (outcome.actualReturnPercent > 0) {
        winners.push(score);
      } else {
        losers.push(score);
      }
    }

    const avgWin = winners.length > 0 ? winners.reduce((a, b) => a + b, 0) / winners.length : 0;
    const avgLose = losers.length > 0 ? losers.reduce((a, b) => a + b, 0) / losers.length : 0;

    // Predictive power: how much higher do winners score vs losers (normalized)
    const spread = avgWin - avgLose;
    const predictivePower = Math.max(0, Math.min(100, 50 + spread));

    result[dim] = {
      avgScoreWinners: Math.round(avgWin * 10) / 10,
      avgScoreLosers: Math.round(avgLose * 10) / 10,
      predictivePower: Math.round(predictivePower * 10) / 10,
    };
  }

  return result;
}
