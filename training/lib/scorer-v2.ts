// ============================================================
// Training - Composite Scorer v2
// ============================================================
// Replaces the broken scoring formula where totalScore hits 100
// on trial 1 and stays there. This version produces a meaningful
// gradient centered on 50 (no edge) with 100 nearly unreachable.
//
// Score semantics:
//   0  = catastrophic (all wrong direction, all stops hit)
//  50  = random / no edge (also the score for zero-trade days)
//  70  = good (60%+ direction, PF > 1.3)
//  85  = excellent (70%+ direction, PF > 2.0)
// 100  = near-perfect (extremely hard to achieve)
// ============================================================

import * as fs from "fs";
import * as path from "path";
import type { TrialResult, TrainingState } from "./types.ts";

/**
 * Calculate a composite 0-100 score from individual metrics.
 *
 * Components (points added to a base of 50):
 *   Direction Score  : (directionAccuracy - 50) * 0.3, range 0 to 15
 *   Profit Factor    : log2(max(1, PF)) * 6, range 0 to 10
 *   Target/Stop Net  : (targetHitRate - stopHitRate) * 0.16, range -8 to +8
 *   Return Score     : avgReturnPercent * 1.5, range -12 to +12
 *   Win Rate Score   : (winRate - 50) * 0.21, range 0 to 7
 *
 * Max theoretical = 50 + 15 + 10 + 8 + 12 + 7 = 102 (clamped to 100)
 * Typical good    = 70-80
 * Random/no edge  = 50
 *
 * Final = clamp(50 + sum_of_components, 0, 100)
 */
export function calculateCompositeScore(metrics: {
  directionAccuracy: number;
  targetHitRate: number;
  stopHitRate: number;
  avgReturnPercent: number;
  profitFactor: number;
  winRate: number;
}): number {
  const {
    directionAccuracy,
    targetHitRate,
    stopHitRate,
    avgReturnPercent,
    profitFactor,
    winRate,
  } = metrics;

  // Direction Score (max 15 pts)
  // 50% → 0, 75% → 7.5, 100% → 15
  const directionPts = Math.max(0, Math.min(15, (directionAccuracy - 50) * 0.3));

  // Profit Factor Score (max 10 pts, log-scaled so diminishing returns)
  // PF 1.0 → 0, PF 2.0 → 6, PF 4.0 → 10 (redistributed pts to return score)
  const pfPts = Math.min(10, Math.max(0, Math.log2(Math.max(1, profitFactor)) * 6));

  // Target/Stop Net Score (range -8 to +8)
  const targetStopRaw = (targetHitRate - stopHitRate) * 0.16;
  const targetStopPts = Math.max(-8, Math.min(8, targetStopRaw));

  // Return Score (range -12 to +12) — wider cap preserves gradient for high-alpha days
  const returnRaw = avgReturnPercent * 1.5;
  const returnPts = Math.max(-12, Math.min(12, returnRaw));

  // Win Rate Score (max 7 pts)
  // 50% → 0, 75% → 5.25, 90% → 7 (capped)
  const winRatePts = Math.min(7, Math.max(0, (winRate - 50) * 0.21));

  // Base of 50 + all component points, clamped 0-100
  const raw = 50 + directionPts + pfPts + targetStopPts + returnPts + winRatePts;
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

/**
 * Rescore a single TrialResult using the v2 composite formula.
 * Returns a new TrialResult with only scores.totalScore changed.
 * All other score fields (directionAccuracy, targetHitRate, etc.) are preserved.
 */
export function rescoreTrialResult(trial: TrialResult): TrialResult {
  const { scores } = trial;

  // Zero-trade days get exactly 50
  const hasOutcomes =
    trial.outcomes.length > 0 &&
    trial.outcomes.some((o) => o.notes !== "data unavailable");

  const newTotal = hasOutcomes
    ? calculateCompositeScore({
        directionAccuracy: scores.directionAccuracy,
        targetHitRate: scores.targetHitRate,
        stopHitRate: scores.stopHitRate,
        avgReturnPercent: scores.avgReturnPercent,
        profitFactor: scores.profitFactor,
        winRate: scores.winRate,
      })
    : 50;

  return {
    ...trial,
    scores: {
      ...scores,
      totalScore: newTotal,
    },
  };
}

/**
 * Rescore ALL trials in training-state.json using the v2 formula.
 * Updates bestScore and bestWeights to reflect the new scoring.
 * Writes the updated state back to disk and returns it.
 */
export async function rescoreAllTrials(): Promise<TrainingState> {
  const statePath = path.resolve(
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
    "../results/training-state.json"
  );

  const raw = fs.readFileSync(statePath, "utf-8");
  const state: TrainingState = JSON.parse(raw);

  let bestScore = -Infinity;
  let bestWeights = state.bestWeights;

  // Rescore every trial
  state.results = state.results.map((trial) => {
    const rescored = rescoreTrialResult(trial);

    if (rescored.scores.totalScore > bestScore) {
      bestScore = rescored.scores.totalScore;
      bestWeights = { ...rescored.weights };
    }

    return rescored;
  });

  // Update weight history scores too
  state.weightHistory = state.weightHistory.map((entry) => {
    const matchingTrial = state.results.find((r) => r.trialId === entry.trial);
    return matchingTrial
      ? { ...entry, score: matchingTrial.scores.totalScore }
      : entry;
  });

  state.bestScore = bestScore === -Infinity ? 50 : bestScore;
  state.bestWeights = bestWeights;
  state.lastUpdatedAt = new Date().toISOString();

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(
    `Rescored ${state.results.length} trials. New best: ${state.bestScore} (was ${JSON.parse(raw).bestScore})`
  );

  return state;
}
