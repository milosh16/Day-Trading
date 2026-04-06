// ============================================================
// Training - Counterfactual A/B Testing for Weight Changes
// ============================================================
// Re-scores historical trials with new weights to determine
// whether a weight change actually improves trade filtering
// without requiring any API calls.
// ============================================================

import type { ConvictionWeights, TrialResult, TradeRecommendation, RealOutcome } from "./types.ts";
import type { RegimeWeightTable } from "./regime-weights.ts";
import { getWeightsForRegime } from "./regime-weights.ts";

const DIMENSIONS = [
  "catalystClarity",
  "technicalSetup",
  "riskReward",
  "volumeLiquidity",
  "marketAlignment",
  "informationEdge",
  "timingUrgency",
] as const;

interface CounterfactualResult {
  trialsCompared: number;
  oldAvgScore: number;
  newAvgScore: number;
  improvement: number;
  improvementPercent: number;
  trialByTrial: {
    date: string;
    trialId: number;
    regime: string;
    oldScore: number;
    newScore: number;
    oldTradeCount: number;
    newTradeCount: number;
    delta: number;
  }[];
  recommendation: "apply" | "reject" | "neutral";
  reason: string;
}

/**
 * Compute the weighted conviction score for a recommendation
 * given a set of weights.
 */
function computeWeightedScore(
  rec: TradeRecommendation,
  weights: ConvictionWeights
): number {
  let score = 0;
  for (const dim of DIMENSIONS) {
    score += rec.conviction[dim].score * weights[dim];
  }
  return score;
}

/**
 * Find the matching outcome for a recommendation by symbol.
 */
function findOutcome(
  rec: TradeRecommendation,
  outcomes: RealOutcome[]
): RealOutcome | undefined {
  return outcomes.find((o) => o.symbol === rec.symbol);
}

/**
 * Run a counterfactual comparison: re-score all historical trials
 * with new regime weights and determine whether the change improves
 * trade filtering (keeping more winners, dropping more losers).
 */
export function runCounterfactual(
  results: TrialResult[],
  oldTable: RegimeWeightTable,
  newTable: RegimeWeightTable,
  convictionThreshold: number = 72
): CounterfactualResult {
  const trialByTrial: CounterfactualResult["trialByTrial"] = [];

  // Aggregate winner/loser tracking across all trials
  let winnersKeptOld = 0;
  let winnersKeptNew = 0;
  let losersKeptOld = 0;
  let losersKeptNew = 0;

  for (const trial of results) {
    const regime = trial.regime?.regime?.toLowerCase().trim() || "default";
    const oldWeights = getWeightsForRegime(oldTable, regime);
    const newWeights = getWeightsForRegime(newTable, regime);

    let oldTradeCount = 0;
    let newTradeCount = 0;

    for (const rec of trial.recommendations) {
      const oldScore = computeWeightedScore(rec, oldWeights);
      const newScore = computeWeightedScore(rec, newWeights);
      const passesOld = oldScore >= convictionThreshold;
      const passesNew = newScore >= convictionThreshold;

      if (passesOld) oldTradeCount++;
      if (passesNew) newTradeCount++;

      // Determine if this trade was a winner or loser from outcomes
      const outcome = findOutcome(rec, trial.outcomes);
      if (outcome) {
        const isWinner = outcome.actualReturnPercent > 0;
        if (isWinner) {
          if (passesOld) winnersKeptOld++;
          if (passesNew) winnersKeptNew++;
        } else {
          if (passesOld) losersKeptOld++;
          if (passesNew) losersKeptNew++;
        }
      }
    }

    trialByTrial.push({
      date: trial.date,
      trialId: trial.trialId,
      regime,
      oldScore: trial.scores.totalScore,
      newScore: trial.scores.totalScore, // can't re-score outcomes without API
      oldTradeCount,
      newTradeCount,
      delta: newTradeCount - oldTradeCount,
    });
  }

  const trialsCompared = trialByTrial.length;
  const oldAvgScore =
    trialsCompared > 0
      ? trialByTrial.reduce((sum, t) => sum + t.oldScore, 0) / trialsCompared
      : 0;
  const newAvgScore =
    trialsCompared > 0
      ? trialByTrial.reduce((sum, t) => sum + t.newScore, 0) / trialsCompared
      : 0;
  const improvement = newAvgScore - oldAvgScore;
  const improvementPercent = oldAvgScore !== 0 ? (improvement / oldAvgScore) * 100 : 0;

  // Decision logic based on winner/loser filtering changes
  const winnersDropped = winnersKeptOld - winnersKeptNew; // positive = new drops winners
  const losersDropped = losersKeptOld - losersKeptNew;     // positive = new drops losers

  let recommendation: CounterfactualResult["recommendation"];
  let reason: string;

  if (losersDropped > winnersDropped && losersDropped > 0) {
    recommendation = "apply";
    reason =
      `New weights filter out ${losersDropped} more losers than winners dropped (${winnersDropped}). ` +
      `Winners kept: ${winnersKeptNew} (was ${winnersKeptOld}), losers kept: ${losersKeptNew} (was ${losersKeptOld}). ` +
      `Net improvement in trade quality.`;
  } else if (winnersDropped > losersDropped && winnersDropped > 0) {
    recommendation = "reject";
    reason =
      `New weights drop ${winnersDropped} winners but only ${losersDropped} losers. ` +
      `Winners kept: ${winnersKeptNew} (was ${winnersKeptOld}), losers kept: ${losersKeptNew} (was ${losersKeptOld}). ` +
      `Net degradation in trade quality.`;
  } else {
    recommendation = "neutral";
    reason =
      `Weight change has minimal differential impact. ` +
      `Winners dropped: ${winnersDropped}, losers dropped: ${losersDropped}. ` +
      `Winners kept: ${winnersKeptNew} (was ${winnersKeptOld}), losers kept: ${losersKeptNew} (was ${losersKeptOld}).`;
  }

  return {
    trialsCompared,
    oldAvgScore: Math.round(oldAvgScore * 100) / 100,
    newAvgScore: Math.round(newAvgScore * 100) / 100,
    improvement: Math.round(improvement * 100) / 100,
    improvementPercent: Math.round(improvementPercent * 100) / 100,
    trialByTrial,
    recommendation,
    reason,
  };
}
