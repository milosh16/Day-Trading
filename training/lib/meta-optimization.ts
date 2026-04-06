// ============================================================
// Training - Meta-Optimization Tracking
// ============================================================
// Records every optimization cycle for audit trail and
// convergence detection. Tracks what the optimizer is learning
// so we know when to stop tuning weights and start adding
// new signal sources or dimensions instead.
// ============================================================

import * as fs from "fs";
import * as path from "path";
import type { TrialResult } from "./types.ts";

const LOG_PATH = path.join(
  import.meta.dirname ?? path.resolve("training/results"),
  "..",
  "results",
  "optimization-log.json"
);

interface OptimizationRecord {
  trial: number;
  timestamp: string;

  // What changed
  regimeChanges: {
    regime: string;
    dimensionChanges: { dimension: string; old: number; new: number; delta: number }[];
  }[];
  insightsAdded: string[];       // insight IDs
  insightsRetired: string[];     // insight IDs

  // Counterfactual result (filled after testing)
  counterfactual?: {
    improvement: number;
    recommendation: "apply" | "reject" | "neutral";
  };

  // Regime-specific performance at this checkpoint
  regimePerformance: Record<string, {
    trials: number;
    avgScore: number;
    avgWinRate: number;
    avgAlpha: number;
    trend: "improving" | "stable" | "declining";
  }>;
}

interface OptimizationLog {
  version: number;
  records: OptimizationRecord[];
}

/**
 * Load the optimization log from disk.
 * Creates an empty log if the file doesn't exist.
 */
export function loadOptimizationLog(): OptimizationLog {
  if (fs.existsSync(LOG_PATH)) {
    const raw = fs.readFileSync(LOG_PATH, "utf-8");
    return JSON.parse(raw) as OptimizationLog;
  }
  return { version: 1, records: [] };
}

/**
 * Write the optimization log to disk.
 */
export function saveOptimizationLog(log: OptimizationLog): void {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), "utf-8");
}

/**
 * Append a record to the optimization log (immutable — returns new log).
 */
export function addRecord(
  log: OptimizationLog,
  record: OptimizationRecord
): OptimizationLog {
  return {
    ...log,
    records: [...log.records, record],
  };
}

/**
 * Compute per-regime performance stats from the last N trials.
 *
 * The `trend` is determined by comparing the last 10 trials' average
 * vs the 10 before that: improving if >5% better, declining if >5%
 * worse, stable otherwise.
 */
export function computeRegimePerformance(
  results: TrialResult[],
  windowSize: number = 30
): Record<string, {
  trials: number;
  avgScore: number;
  avgWinRate: number;
  avgAlpha: number;
  trend: "improving" | "stable" | "declining";
}> {
  const window = results.slice(-windowSize);
  const byRegime = new Map<string, TrialResult[]>();

  for (const r of window) {
    const regime = r.regime?.regime?.toLowerCase().trim() || "default";
    if (!byRegime.has(regime)) byRegime.set(regime, []);
    byRegime.get(regime)!.push(r);
  }

  const performance: Record<string, {
    trials: number;
    avgScore: number;
    avgWinRate: number;
    avgAlpha: number;
    trend: "improving" | "stable" | "declining";
  }> = {};

  for (const [regime, trials] of byRegime.entries()) {
    const avgScore = trials.reduce((s, r) => s + r.scores.totalScore, 0) / trials.length;
    const avgWinRate = trials.reduce((s, r) => s + r.scores.winRate, 0) / trials.length;
    const avgAlpha = trials.reduce((s, r) => s + (r.scores.alpha ?? 0), 0) / trials.length;

    // Determine trend: compare last 10 vs 10 before that
    let trend: "improving" | "stable" | "declining" = "stable";
    if (trials.length >= 10) {
      const recent10 = trials.slice(-10);
      const prior10 = trials.slice(-20, -10);
      if (prior10.length >= 5) {
        const recentAvg = recent10.reduce((s, r) => s + r.scores.totalScore, 0) / recent10.length;
        const priorAvg = prior10.reduce((s, r) => s + r.scores.totalScore, 0) / prior10.length;
        const pctChange = priorAvg !== 0 ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
        if (pctChange > 5) trend = "improving";
        else if (pctChange < -5) trend = "declining";
      }
    }

    performance[regime] = {
      trials: trials.length,
      avgScore: Math.round(avgScore * 100) / 100,
      avgWinRate: Math.round(avgWinRate * 100) / 100,
      avgAlpha: Math.round(avgAlpha * 100) / 100,
      trend,
    };
  }

  return performance;
}

/**
 * Check whether the optimization process has converged.
 *
 * Convergence is detected when all three conditions are met:
 * 1. Weight changes are getting smaller (total absolute delta < 0.02 for all regimes)
 * 2. All regime performance trends are 'stable'
 * 3. Counterfactual confirmation rate < 30% (weight changes aren't helping)
 */
export function checkConvergence(log: OptimizationLog): {
  converged: boolean;
  reason: string;
  recommendation: string;
} {
  if (log.records.length < 5) {
    return {
      converged: false,
      reason: `Only ${log.records.length} records — need at least 5 for convergence check.`,
      recommendation: "Continue training.",
    };
  }

  const last5 = log.records.slice(-5);

  // Check 1: Weight changes getting smaller
  const allSmallDeltas = last5.every((record) => {
    const totalDelta = record.regimeChanges.reduce((sum, rc) => {
      return sum + rc.dimensionChanges.reduce((s, dc) => s + Math.abs(dc.delta), 0);
    }, 0);
    return totalDelta < 0.02;
  });

  // Check 2: All regime performance trends are stable
  const latestPerf = last5[last5.length - 1].regimePerformance;
  const allStable = Object.values(latestPerf).every(
    (rp) => rp.trend === "stable"
  );

  // Check 3: Counterfactual confirmation rate < 30%
  const recordsWithCounterfactual = last5.filter((r) => r.counterfactual);
  const appliedCount = recordsWithCounterfactual.filter(
    (r) => r.counterfactual!.recommendation === "apply"
  ).length;
  const confirmationRate =
    recordsWithCounterfactual.length > 0
      ? appliedCount / recordsWithCounterfactual.length
      : 0;
  const lowConfirmation = confirmationRate < 0.3;

  const converged = allSmallDeltas && allStable && lowConfirmation;

  const reasons: string[] = [];
  if (allSmallDeltas) reasons.push("weight deltas < 0.02 for last 5 cycles");
  if (allStable) reasons.push("all regime trends stable");
  if (lowConfirmation)
    reasons.push(
      `counterfactual confirmation rate ${(confirmationRate * 100).toFixed(0)}% < 30%`
    );

  return {
    converged,
    reason: converged
      ? `All convergence criteria met: ${reasons.join("; ")}.`
      : `Not converged yet. Met: [${reasons.join(", ") || "none"}]. Missing: [${
          [
            !allSmallDeltas && "weight deltas still large",
            !allStable && "some regime trends not stable",
            !lowConfirmation && `confirmation rate ${(confirmationRate * 100).toFixed(0)}% >= 30%`,
          ]
            .filter(Boolean)
            .join(", ")
        }].`,
    recommendation: converged
      ? "Algorithm has converged. Further trials unlikely to improve weights. Consider: (1) adding new signal sources, (2) adding new conviction dimensions, (3) regime-specific prompt engineering."
      : "Continue training.",
  };
}

export type { OptimizationRecord, OptimizationLog };
