// ============================================================
// Training - Weight Optimizer
// ============================================================
// Adjusts conviction weights based on accumulated trial data.
// Uses gradient-free optimization: analyze which dimensions
// best predict winning trades, then shift weights accordingly.
// ============================================================

import type { ConvictionWeights, TrialResult } from "./types.ts";

const DIMENSIONS = [
  "catalystClarity", "technicalSetup", "riskReward",
  "volumeLiquidity", "marketAlignment", "informationEdge", "timingUrgency",
] as const;

// Default weights (starting point)
export const DEFAULT_WEIGHTS: ConvictionWeights = {
  catalystClarity: 0.20,
  technicalSetup: 0.15,
  riskReward: 0.15,
  volumeLiquidity: 0.10,
  marketAlignment: 0.15,
  informationEdge: 0.15,
  timingUrgency: 0.10,
};

// Normalize weights to sum to 1.0
function normalizeWeights(weights: ConvictionWeights): ConvictionWeights {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum === 0) return { ...DEFAULT_WEIGHTS };

  const normalized: Record<string, number> = {};
  for (const [key, val] of Object.entries(weights)) {
    // Enforce minimum weight of 0.05 (5%) — no dimension fully zeroed out
    normalized[key] = Math.max(0.05, val / sum);
  }

  // Re-normalize after applying minimums
  const newSum = Object.values(normalized).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(normalized)) {
    normalized[key] = Math.round((normalized[key] / newSum) * 1000) / 1000;
  }

  return normalized as unknown as ConvictionWeights;
}

// Optimize weights based on accumulated results
export function optimizeWeights(
  currentWeights: ConvictionWeights,
  results: TrialResult[],
  learningRate: number = 0.15
): ConvictionWeights {
  if (results.length < 3) return currentWeights; // Need at least 3 trials

  // Aggregate dimension analysis across all recent trials (last 50)
  const recentResults = results.slice(-50);
  const dimAccum: Record<string, { totalPP: number; count: number }> = {};

  for (const dim of DIMENSIONS) {
    dimAccum[dim] = { totalPP: 0, count: 0 };
  }

  for (const result of recentResults) {
    if (!result.dimensionAnalysis) continue;
    for (const dim of DIMENSIONS) {
      const analysis = result.dimensionAnalysis[dim];
      if (analysis) {
        dimAccum[dim].totalPP += analysis.predictivePower;
        dimAccum[dim].count += 1;
      }
    }
  }

  // Calculate average predictive power per dimension
  const avgPP: Record<string, number> = {};
  for (const dim of DIMENSIONS) {
    avgPP[dim] = dimAccum[dim].count > 0
      ? dimAccum[dim].totalPP / dimAccum[dim].count
      : 50; // neutral
  }

  // Shift weights toward dimensions with higher predictive power
  const newWeights: Record<string, number> = {};
  for (const dim of DIMENSIONS) {
    const current = currentWeights[dim as keyof ConvictionWeights];
    // predictivePower is 0-100, 50 = neutral
    // Above 50 → increase weight, below 50 → decrease
    const adjustment = (avgPP[dim] - 50) / 100; // -0.5 to +0.5
    newWeights[dim] = current + adjustment * learningRate;
  }

  return normalizeWeights(newWeights as unknown as ConvictionWeights);
}

// Also optimize the conviction threshold based on results
export function optimizeThreshold(results: TrialResult[]): number {
  if (results.length < 10) return 72; // default

  // Find the threshold that maximizes profit factor
  const recentResults = results.slice(-50);
  let bestThreshold = 72;
  let bestPF = 0;

  // We don't have per-trade threshold data, but we can analyze overall patterns
  // If most trials have high win rates, we might lower threshold to get more trades
  // If most trials have low win rates, we should raise threshold
  const avgWinRate = recentResults.reduce((s, r) => s + r.scores.winRate, 0) / recentResults.length;
  const avgPF = recentResults.reduce((s, r) => s + r.scores.profitFactor, 0) / recentResults.length;

  if (avgWinRate > 65 && avgPF > 1.5) {
    // Strong performance — can afford to lower threshold for more trades
    bestThreshold = Math.max(65, 72 - Math.floor((avgWinRate - 65) / 5) * 2);
  } else if (avgWinRate < 50 || avgPF < 1.0) {
    // Weak performance — raise threshold to be more selective
    bestThreshold = Math.min(85, 72 + Math.floor((50 - avgWinRate) / 5) * 2);
  }

  return bestThreshold;
}

// Generate a human-readable summary of weight changes
export function summarizeChanges(
  oldWeights: ConvictionWeights,
  newWeights: ConvictionWeights
): string {
  const lines: string[] = ["Weight changes:"];

  for (const dim of DIMENSIONS) {
    const old = oldWeights[dim as keyof ConvictionWeights];
    const curr = newWeights[dim as keyof ConvictionWeights];
    const diff = curr - old;
    const arrow = diff > 0.005 ? "↑" : diff < -0.005 ? "↓" : "=";
    lines.push(
      `  ${dim}: ${(old * 100).toFixed(1)}% → ${(curr * 100).toFixed(1)}% ${arrow}`
    );
  }

  return lines.join("\n");
}
