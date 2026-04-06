// ============================================================
// Recommendation Tracker — Queryable history of all recommendations
// and their outcomes. Manages public/data/recommendation-history.json
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const HISTORY_PATH = join(process.cwd(), "public", "data", "recommendation-history.json");

// --- Types ---

export interface RecommendationRecord {
  date: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  convictionScore: number;
  regime: string;
  // Filled by accuracy scorer
  actualOpen?: number;
  actualClose?: number;
  actualReturn?: number;
  hitTarget?: boolean;
  hitStop?: boolean;
  directionCorrect?: boolean;
  scored?: boolean;
}

export interface RecommendationHistory {
  lastUpdated: string;
  totalRecords: number;
  records: RecommendationRecord[];
}

// --- Core CRUD ---

export function loadHistory(): RecommendationHistory {
  try {
    if (existsSync(HISTORY_PATH)) {
      const data = JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
      return data as RecommendationHistory;
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {
    lastUpdated: new Date().toISOString(),
    totalRecords: 0,
    records: [],
  };
}

export function saveHistory(history: RecommendationHistory): void {
  history.lastUpdated = new Date().toISOString();
  history.totalRecords = history.records.length;
  const dir = dirname(HISTORY_PATH);
  mkdirSync(dir, { recursive: true });
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

// --- Add & Score ---

export function addRecommendations(
  history: RecommendationHistory,
  date: string,
  recs: any[],
  regime: string,
): RecommendationHistory {
  for (const rec of recs) {
    const symbol = rec.ticker || rec.symbol;
    if (!symbol) continue;

    const record: RecommendationRecord = {
      date,
      symbol: symbol.toUpperCase(),
      direction: rec.direction || "long",
      entryPrice: rec.entryPrice || 0,
      targetPrice: rec.targetPrice || 0,
      stopPrice: rec.stopPrice || 0,
      convictionScore: rec.conviction?.compositeScore ?? rec.compositeScore ?? 0,
      regime,
      scored: false,
    };

    // Avoid duplicates (same date + symbol + direction)
    const exists = history.records.some(
      r => r.date === date && r.symbol === record.symbol && r.direction === record.direction,
    );
    if (!exists) {
      history.records.push(record);
    }
  }

  history.totalRecords = history.records.length;
  return history;
}

export function scoreRecommendations(
  history: RecommendationHistory,
  date: string,
  outcomes: any[],
): RecommendationHistory {
  for (const outcome of outcomes) {
    const symbol = (outcome.ticker || outcome.symbol || "").toUpperCase();
    if (!symbol) continue;

    const record = history.records.find(
      r => r.date === date && r.symbol === symbol && !r.scored,
    );
    if (!record) continue;

    record.actualOpen = outcome.actualOpen ?? outcome.openPrice;
    record.actualClose = outcome.actualClose ?? outcome.closePrice;
    record.actualReturn = outcome.actualReturn ?? outcome.return;
    record.hitTarget = outcome.hitTarget ?? outcome.targetHit ?? false;
    record.hitStop = outcome.hitStop ?? outcome.stopHit ?? false;
    record.directionCorrect = outcome.directionCorrect ?? undefined;

    // Infer directionCorrect if not provided
    if (record.directionCorrect === undefined && record.actualReturn !== undefined) {
      if (record.direction === "long") {
        record.directionCorrect = record.actualReturn > 0;
      } else {
        record.directionCorrect = record.actualReturn < 0;
      }
    }

    record.scored = true;
  }

  return history;
}

// --- Query Functions ---

export function getSymbolStats(
  history: RecommendationHistory,
  symbol: string,
): {
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  byDirection: Record<string, { count: number; winRate: number }>;
} {
  const scored = history.records.filter(
    r => r.symbol === symbol.toUpperCase() && r.scored,
  );

  const totalTrades = scored.length;
  if (totalTrades === 0) {
    return { totalTrades: 0, winRate: 0, avgReturn: 0, byDirection: {} };
  }

  const wins = scored.filter(r => r.directionCorrect).length;
  const avgReturn =
    scored.reduce((sum, r) => sum + (r.actualReturn || 0), 0) / totalTrades;

  const byDirection: Record<string, { count: number; winRate: number }> = {};
  for (const dir of ["long", "short"]) {
    const dirRecs = scored.filter(r => r.direction === dir);
    if (dirRecs.length > 0) {
      const dirWins = dirRecs.filter(r => r.directionCorrect).length;
      byDirection[dir] = {
        count: dirRecs.length,
        winRate: Math.round((dirWins / dirRecs.length) * 100),
      };
    }
  }

  return {
    totalTrades,
    winRate: Math.round((wins / totalTrades) * 100),
    avgReturn: Math.round(avgReturn * 100) / 100,
    byDirection,
  };
}

export function getRegimeStats(
  history: RecommendationHistory,
  regime: string,
): {
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  avgAlpha: number;
} {
  const scored = history.records.filter(
    r => r.regime === regime && r.scored,
  );

  const totalTrades = scored.length;
  if (totalTrades === 0) {
    return { totalTrades: 0, winRate: 0, avgReturn: 0, avgAlpha: 0 };
  }

  const wins = scored.filter(r => r.directionCorrect).length;
  const avgReturn =
    scored.reduce((sum, r) => sum + (r.actualReturn || 0), 0) / totalTrades;

  // Alpha not stored per-record, so return 0 for now
  return {
    totalTrades,
    winRate: Math.round((wins / totalTrades) * 100),
    avgReturn: Math.round(avgReturn * 100) / 100,
    avgAlpha: 0,
  };
}

export function getDirectionStats(
  history: RecommendationHistory,
  direction: string,
): {
  totalTrades: number;
  winRate: number;
  avgReturn: number;
} {
  const scored = history.records.filter(
    r => r.direction === direction && r.scored,
  );

  const totalTrades = scored.length;
  if (totalTrades === 0) {
    return { totalTrades: 0, winRate: 0, avgReturn: 0 };
  }

  const wins = scored.filter(r => r.directionCorrect).length;
  const avgReturn =
    scored.reduce((sum, r) => sum + (r.actualReturn || 0), 0) / totalTrades;

  return {
    totalTrades,
    winRate: Math.round((wins / totalTrades) * 100),
    avgReturn: Math.round(avgReturn * 100) / 100,
  };
}

// --- Performance Context Builder ---

export function buildPerformanceContext(history: RecommendationHistory): string {
  const scored = history.records.filter(r => r.scored);
  if (scored.length < 5) return ""; // Not enough data for meaningful context

  const lines: string[] = ["HISTORICAL PERFORMANCE CONTEXT:"];

  // Long trades by regime
  const regimes = [...new Set(scored.map(r => r.regime))];
  for (const regime of regimes) {
    const longInRegime = scored.filter(r => r.direction === "long" && r.regime === regime);
    if (longInRegime.length >= 3) {
      const winRate = Math.round(
        (longInRegime.filter(r => r.directionCorrect).length / longInRegime.length) * 100,
      );
      lines.push(`- Long trades in ${regime}: ${winRate}% win rate (${longInRegime.length} trades)`);
    }
  }

  // Short trades overall
  const shorts = scored.filter(r => r.direction === "short");
  if (shorts.length >= 3) {
    const winRate = Math.round(
      (shorts.filter(r => r.directionCorrect).length / shorts.length) * 100,
    );
    lines.push(`- Short trades overall: ${winRate}% win rate (${shorts.length} trades)`);
  }

  // Most recommended symbols
  const symbolCounts: Record<string, { total: number; wins: number }> = {};
  for (const r of scored) {
    if (!symbolCounts[r.symbol]) symbolCounts[r.symbol] = { total: 0, wins: 0 };
    symbolCounts[r.symbol].total++;
    if (r.directionCorrect) symbolCounts[r.symbol].wins++;
  }
  const topSymbols = Object.entries(symbolCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);
  if (topSymbols.length > 0) {
    const symbolParts = topSymbols.map(
      ([sym, s]) => `${sym} (${s.total} trades, ${Math.round((s.wins / s.total) * 100)}% win)`,
    );
    lines.push(`- Most recommended: ${symbolParts.join(", ")}`);
  }

  // Best and worst performing regimes
  const regimePerf: Record<string, { total: number; wins: number; returnSum: number }> = {};
  for (const r of scored) {
    if (!regimePerf[r.regime]) regimePerf[r.regime] = { total: 0, wins: 0, returnSum: 0 };
    regimePerf[r.regime].total++;
    if (r.directionCorrect) regimePerf[r.regime].wins++;
    regimePerf[r.regime].returnSum += r.actualReturn || 0;
  }

  const regimeEntries = Object.entries(regimePerf).filter(([, s]) => s.total >= 3);
  if (regimeEntries.length > 0) {
    const sorted = regimeEntries.sort(
      (a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total),
    );
    const best = sorted[0];
    const bestWinRate = Math.round((best[1].wins / best[1].total) * 100);
    const bestAvgRet = (best[1].returnSum / best[1].total).toFixed(1);
    lines.push(`- Best performing regime: ${best[0]} (${bestWinRate}% win, ${Number(bestAvgRet) > 0 ? '+' : ''}${bestAvgRet}% avg return)`);

    if (sorted.length > 1) {
      const worst = sorted[sorted.length - 1];
      const worstWinRate = Math.round((worst[1].wins / worst[1].total) * 100);
      const worstAvgRet = (worst[1].returnSum / worst[1].total).toFixed(1);
      lines.push(`- Worst performing regime: ${worst[0]} (${worstWinRate}% win, ${Number(worstAvgRet) > 0 ? '+' : ''}${worstAvgRet}% avg return)`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

// --- Maintenance ---

export function pruneOldRecords(
  history: RecommendationHistory,
  maxRecords: number = 500,
): RecommendationHistory {
  if (history.records.length <= maxRecords) return history;

  // Sort by date descending, keep most recent
  history.records.sort((a, b) => b.date.localeCompare(a.date));
  history.records = history.records.slice(0, maxRecords);
  history.totalRecords = history.records.length;

  return history;
}
