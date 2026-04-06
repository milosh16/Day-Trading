// ============================================================
// Training - Regime-Conditional Weight Vectors
// ============================================================
// Instead of one global weight vector, maintains 6 regime-
// specific weight vectors plus a default fallback. Each regime
// optimizes independently based on trials classified under it.
// ============================================================

import type { ConvictionWeights, TrialResult } from "./types.ts";
import { optimizeWeights, DEFAULT_WEIGHTS } from "./optimizer.ts";

// All 6 regime types plus a default fallback
export type RegimeType =
  | "risk-on"
  | "risk-off"
  | "rotation"
  | "range-bound"
  | "crisis"
  | "event-driven"
  | "default";

export interface RegimeWeightTable {
  "risk-on": ConvictionWeights;
  "risk-off": ConvictionWeights;
  rotation: ConvictionWeights;
  "range-bound": ConvictionWeights;
  crisis: ConvictionWeights;
  "event-driven": ConvictionWeights;
  default: ConvictionWeights;
}

export interface RegimeOptimizationLog {
  regime: RegimeType;
  trialsUsed: number;
  oldWeights: ConvictionWeights;
  newWeights: ConvictionWeights;
  changes: { dimension: string; old: number; new: number; delta: number }[];
}

const ALL_REGIMES: RegimeType[] = [
  "risk-on",
  "risk-off",
  "rotation",
  "range-bound",
  "crisis",
  "event-driven",
  "default",
];

const DIMENSIONS = [
  "catalystClarity",
  "technicalSetup",
  "riskReward",
  "volumeLiquidity",
  "marketAlignment",
  "informationEdge",
  "timingUrgency",
] as const;

/**
 * Create a new RegimeWeightTable with all regimes initialized to DEFAULT_WEIGHTS.
 */
export function createDefaultTable(): RegimeWeightTable {
  return {
    "risk-on": { ...DEFAULT_WEIGHTS },
    "risk-off": { ...DEFAULT_WEIGHTS },
    rotation: { ...DEFAULT_WEIGHTS },
    "range-bound": { ...DEFAULT_WEIGHTS },
    crisis: { ...DEFAULT_WEIGHTS },
    "event-driven": { ...DEFAULT_WEIGHTS },
    default: { ...DEFAULT_WEIGHTS },
  };
}

/**
 * Look up regime-specific weights, falling back to 'default' if the
 * regime string doesn't match any known regime type.
 */
export function getWeightsForRegime(
  table: RegimeWeightTable,
  regime: string
): ConvictionWeights {
  const normalized = regime.toLowerCase().trim() as RegimeType;
  if (normalized in table) {
    return table[normalized];
  }
  return table.default;
}

/**
 * Partition trial results by regime and optimize each regime's weights
 * independently. Only optimizes regimes with >= minTrialsPerRegime results.
 *
 * Returns the updated table and a log of what changed per regime.
 */
export function optimizeByRegime(
  table: RegimeWeightTable,
  results: TrialResult[],
  minTrialsPerRegime: number = 5
): { newTable: RegimeWeightTable; changes: RegimeOptimizationLog[] } {
  // Partition results by regime
  const byRegime = new Map<RegimeType, TrialResult[]>();
  for (const regime of ALL_REGIMES) {
    byRegime.set(regime, []);
  }

  for (const result of results) {
    const regimeStr = result.regime?.regime?.toLowerCase().trim() || "default";
    const regimeKey = (ALL_REGIMES.includes(regimeStr as RegimeType)
      ? regimeStr
      : "default") as RegimeType;
    byRegime.get(regimeKey)!.push(result);
  }

  const newTable: RegimeWeightTable = {
    "risk-on": { ...table["risk-on"] },
    "risk-off": { ...table["risk-off"] },
    rotation: { ...table.rotation },
    "range-bound": { ...table["range-bound"] },
    crisis: { ...table.crisis },
    "event-driven": { ...table["event-driven"] },
    default: { ...table.default },
  };

  const changes: RegimeOptimizationLog[] = [];

  for (const regime of ALL_REGIMES) {
    const regimeResults = byRegime.get(regime)!;
    if (regimeResults.length < minTrialsPerRegime) {
      continue; // Not enough data to optimize this regime
    }

    const oldWeights = table[regime];
    const newWeights = optimizeWeights(oldWeights, regimeResults);
    newTable[regime] = newWeights;

    // Build change log for this regime
    const dimensionChanges: RegimeOptimizationLog["changes"] = [];
    for (const dim of DIMENSIONS) {
      const oldVal = oldWeights[dim];
      const newVal = newWeights[dim];
      const delta = newVal - oldVal;
      if (Math.abs(delta) > 0.001) {
        dimensionChanges.push({
          dimension: dim,
          old: oldVal,
          new: newVal,
          delta: Math.round(delta * 1000) / 1000,
        });
      }
    }

    changes.push({
      regime,
      trialsUsed: regimeResults.length,
      oldWeights,
      newWeights,
      changes: dimensionChanges,
    });
  }

  return { newTable, changes };
}

/**
 * Format a ConvictionWeights object for injection into Claude prompts.
 * Each dimension is shown as a percentage.
 */
export function weightsToPrompt(weights: ConvictionWeights): string {
  return Object.entries(weights)
    .map(([key, val]) => `- ${key}: ${(val * 100).toFixed(1)}%`)
    .join("\n");
}

/**
 * Format the full RegimeWeightTable as a human-readable summary,
 * showing how weights differ across regimes.
 */
export function regimeTableToSummary(table: RegimeWeightTable): string {
  const lines: string[] = ["Regime Weight Table"];
  lines.push("=".repeat(70));

  // Header row
  const dimLabels = DIMENSIONS.map((d) =>
    d.replace(/([A-Z])/g, " $1").trim().slice(0, 8).padEnd(8)
  );
  lines.push(
    `${"Regime".padEnd(16)} ${dimLabels.join(" ")}`
  );
  lines.push("-".repeat(70));

  for (const regime of ALL_REGIMES) {
    const w = table[regime];
    const vals = DIMENSIONS.map((d) =>
      `${(w[d] * 100).toFixed(1)}%`.padEnd(8)
    );
    lines.push(`${regime.padEnd(16)} ${vals.join(" ")}`);
  }

  lines.push("-".repeat(70));

  // Show which regimes differ from default
  const defaultW = table.default;
  const divergent: string[] = [];
  for (const regime of ALL_REGIMES) {
    if (regime === "default") continue;
    const w = table[regime];
    let totalDelta = 0;
    for (const dim of DIMENSIONS) {
      totalDelta += Math.abs(w[dim] - defaultW[dim]);
    }
    if (totalDelta > 0.01) {
      divergent.push(`${regime} (total delta: ${(totalDelta * 100).toFixed(1)}%)`);
    }
  }

  if (divergent.length > 0) {
    lines.push(`\nRegimes diverged from default: ${divergent.join(", ")}`);
  } else {
    lines.push("\nAll regimes currently match default weights.");
  }

  return lines.join("\n");
}
