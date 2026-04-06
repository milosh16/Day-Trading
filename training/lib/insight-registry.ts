// ============================================================
// Training - Automated Insight Registry
// ============================================================
// Manages training-derived insights that can be automatically
// promoted to production prompts. Insights are discovered during
// Opus algorithm reviews, validated via counterfactual testing,
// and injected into live prompts when activated.
// ============================================================

import * as fs from "fs";
import * as path from "path";

const REGISTRY_PATH = path.join(
  import.meta.dirname ?? path.resolve("training/results"),
  "..",
  "results",
  "insight-registry.json"
);

type InsightCategory =
  | "conviction_prompt"
  | "regime_rule"
  | "signal_interpretation"
  | "trade_selection";

interface TrainingInsight {
  id: string;
  discoveredAtTrial: number;
  discoveredAt: string;
  category: InsightCategory;
  insight: string;
  promptFragment: string;
  supportingTrials: number[];
  confidenceScore: number;
  validated: boolean;
  active: boolean;
  supersedes?: string[];
  retiredAt?: string;
  retiredReason?: string;
}

interface InsightRegistry {
  version: number;
  lastUpdated: string;
  insights: TrainingInsight[];
}

/**
 * Load the insight registry from disk.
 * Creates an empty registry if the file doesn't exist.
 */
export function loadRegistry(): InsightRegistry {
  if (fs.existsSync(REGISTRY_PATH)) {
    const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
    return JSON.parse(raw) as InsightRegistry;
  }
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    insights: [],
  };
}

/**
 * Write the insight registry to disk.
 */
export function saveRegistry(registry: InsightRegistry): void {
  registry.lastUpdated = new Date().toISOString();
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
}

/**
 * Add a new insight to the registry with auto-generated ID and timestamps.
 */
export function addInsight(
  registry: InsightRegistry,
  insight: Omit<TrainingInsight, "id" | "discoveredAt" | "validated" | "active">
): InsightRegistry {
  const id = `insight-${insight.category}-${Date.now().toString(36)}`;
  const newInsight: TrainingInsight = {
    ...insight,
    id,
    discoveredAt: new Date().toISOString(),
    validated: false,
    active: false,
  };
  return {
    ...registry,
    version: registry.version,
    lastUpdated: new Date().toISOString(),
    insights: [...registry.insights, newInsight],
  };
}

/**
 * Mark an insight as validated (passed counterfactual testing) or not.
 */
export function validateInsight(
  registry: InsightRegistry,
  insightId: string,
  passed: boolean
): InsightRegistry {
  return {
    ...registry,
    lastUpdated: new Date().toISOString(),
    insights: registry.insights.map((i) =>
      i.id === insightId ? { ...i, validated: passed } : i
    ),
  };
}

/**
 * Activate an insight for production use.
 * If the insight supersedes others, those are deactivated.
 */
export function activateInsight(
  registry: InsightRegistry,
  insightId: string
): InsightRegistry {
  const target = registry.insights.find((i) => i.id === insightId);
  if (!target) return registry;

  const supersededIds = new Set(target.supersedes || []);

  return {
    ...registry,
    lastUpdated: new Date().toISOString(),
    insights: registry.insights.map((i) => {
      if (i.id === insightId) {
        return { ...i, active: true };
      }
      if (supersededIds.has(i.id)) {
        return {
          ...i,
          active: false,
          retiredAt: new Date().toISOString(),
          retiredReason: `Superseded by ${insightId}`,
        };
      }
      return i;
    }),
  };
}

/**
 * Retire an insight, removing it from production use.
 */
export function retireInsight(
  registry: InsightRegistry,
  insightId: string,
  reason: string
): InsightRegistry {
  return {
    ...registry,
    lastUpdated: new Date().toISOString(),
    insights: registry.insights.map((i) =>
      i.id === insightId
        ? {
            ...i,
            active: false,
            retiredAt: new Date().toISOString(),
            retiredReason: reason,
          }
        : i
    ),
  };
}

/**
 * Get all active insights, optionally filtered by category.
 */
export function getActiveInsights(
  registry: InsightRegistry,
  category?: string
): TrainingInsight[] {
  return registry.insights.filter(
    (i) => i.active && (!category || i.category === category)
  );
}

/**
 * Concatenate all active prompt fragments for a given category,
 * separated by newlines. Ready to inject into production prompts.
 */
export function getActivePromptFragments(
  registry: InsightRegistry,
  category: string
): string {
  return getActiveInsights(registry, category)
    .map((i) => i.promptFragment)
    .join("\n");
}

/**
 * Retire insights older than maxAgeDays with confidence below 60.
 */
export function pruneStaleInsights(
  registry: InsightRegistry,
  maxAgeDays: number = 90
): InsightRegistry {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const now = new Date().toISOString();

  return {
    ...registry,
    lastUpdated: now,
    insights: registry.insights.map((i) => {
      if (
        i.active &&
        i.confidenceScore < 60 &&
        new Date(i.discoveredAt).getTime() < cutoff
      ) {
        return {
          ...i,
          active: false,
          retiredAt: now,
          retiredReason: `Auto-pruned: age > ${maxAgeDays} days with confidence ${i.confidenceScore} < 60`,
        };
      }
      return i;
    }),
  };
}

export type { TrainingInsight, InsightRegistry, InsightCategory };
