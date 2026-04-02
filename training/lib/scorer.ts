// ============================================================
// Training - Outcome Scorer
// ============================================================
// Uses Claude with web search to look up real outcomes for
// trade recommendations, then scores accuracy.
// ============================================================

import { callClaude, extractJson } from "./api.ts";
import type { TradeRecommendation, RealOutcome, ConvictionWeights } from "./types.ts";

// Ask Claude to look up real prices for a given date and score outcomes
export async function scoreRecommendations(
  date: string,
  recommendations: TradeRecommendation[]
): Promise<{ outcomes: RealOutcome[]; tokensUsed: number }> {
  if (recommendations.length === 0) {
    return { outcomes: [], tokensUsed: 0 };
  }

  const symbolList = recommendations.map((r) =>
    `${r.symbol}: ${r.direction} @ $${r.entryPrice}, target $${r.targetPrice}, stop $${r.stopLoss}`
  ).join("\n");

  const response = await callClaude({
    system: `You are a financial data analyst. Your job is to look up REAL historical stock price data and score trade predictions. Be precise and factual. Only report data you can verify through web search.

For each trade below, search for the ACTUAL price data on ${date} (and the following 1-3 trading days if the trade was meant to play out over multiple days).

Return a JSON array with one entry per trade. Wrap in <json> tags.

<json>[
  {
    "symbol": "TICKER",
    "openPrice": 123.45,
    "highPrice": 125.00,
    "lowPrice": 121.00,
    "closePrice": 124.00,
    "hitTarget": true/false,
    "hitStop": true/false,
    "directionCorrect": true/false,
    "actualReturnPercent": 2.5,
    "notes": "Brief explanation of what actually happened"
  }
]</json>

Rules:
- hitTarget: true if at any point the stock reached or exceeded the target price (for longs) or fell below it (for shorts)
- hitStop: true if at any point the stock hit the stop loss level
- directionCorrect: true if the stock moved in the predicted direction from the entry price
- actualReturnPercent: calculate from entry to close price, positive for gains, negative for losses
- If you cannot find reliable data for a symbol, set actualReturnPercent to 0 and note "data unavailable"
- Use REAL data only. Do not fabricate prices.`,
    messages: [
      {
        role: "user",
        content: `Look up the actual price data for these trades on ${date}:\n\n${symbolList}`,
      },
    ],
    maxTokens: 4096,
    useWebSearch: true,
  });

  const outcomes = extractJson<RealOutcome[]>(response.text, true) || [];

  return {
    outcomes,
    tokensUsed: response.inputTokens + response.outputTokens,
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
