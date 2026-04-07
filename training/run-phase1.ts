#!/usr/bin/env npx tsx
// Phase 1: Composite Signals + Regime Classification
// No API calls — uses Yahoo Finance, FRED, and local computation only.
// Reads from backtest-state.json for the full 3-year calendar.
// Writes /tmp/trial-signals.json for Phase 2 (agent) and Phase 3 (scorer).

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { fetchCompositeSignals } from "./lib/composite-signals.ts";
import { classifyRegime, buildRegimePrompt } from "../src/lib/market-regime.ts";
import type { GlobalSignals, RegimeAssessment } from "../src/lib/market-regime.ts";
import {
  computeLeadingIndicators,
  computeStressIndex,
  computeRiskAppetiteIndex,
  buildLeadingIndicatorPrompt,
  type DailySignalRecord,
} from "../src/lib/leading-indicators.ts";
import type { TrainingRegime } from "./lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "public", "data");
const BACKTEST_STATE = path.join(__dirname, "backtest-state.json");

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function loadSignalHistory(): import("../src/lib/leading-indicators.ts").DailySignalRecord[] {
  try {
    const historyDir = path.join(DATA_DIR, "history");
    if (!fs.existsSync(historyDir)) return [];
    const files = fs
      .readdirSync(historyDir)
      .filter((f) => f.startsWith("signals-") && f.endsWith(".json"))
      .sort()
      .slice(-20);
    return files.map((f) => {
      const content = fs.readFileSync(path.join(historyDir, f), "utf-8");
      return JSON.parse(content);
    });
  } catch {
    return [];
  }
}

async function main() {
  // Read backtest state
  if (!fs.existsSync(BACKTEST_STATE)) {
    console.error("FATAL: backtest-state.json not found. Run init-backtest.ts first.");
    process.exit(1);
  }

  const backtest = JSON.parse(fs.readFileSync(BACKTEST_STATE, "utf-8"));
  if (!backtest.initialized) {
    console.error("FATAL: Backtest not initialized. Run init-backtest.ts first.");
    process.exit(1);
  }

  if (backtest.pendingDates.length === 0) {
    log("All trading days complete!");
    process.exit(0);
  }

  // Pop the next date
  const date = backtest.pendingDates[0];
  const trialId = backtest.lastTrialId + 1;
  const tradingDate = new Date(date + "T12:00:00Z");
  const dateStr = tradingDate.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const completed = backtest.completedDays;
  const total = backtest.totalDays;
  const remaining = backtest.pendingDates.length;

  log(`=== Phase 1: ${date} (${dateStr}) | ${completed}/${total} done, ${remaining} remaining ===`);

  // Phase 1: Composite Signals
  const compositeResult = await fetchCompositeSignals(date);
  const signals: GlobalSignals = compositeResult.signals;
  log(`Fields populated: ${compositeResult.fieldsPopulated}`);
  for (const w of compositeResult.warnings) log(`  WARNING: ${w}`);

  // Phase 2: Regime Classification (local)
  const regimeResult: RegimeAssessment = classifyRegime(signals);
  const stressIndex = computeStressIndex(signals);
  const riskAppetiteIndex = computeRiskAppetiteIndex(signals);
  const regimePrompt = buildRegimePrompt(regimeResult);

  const regime: TrainingRegime = {
    regime: regimeResult.regime,
    confidence: regimeResult.confidence,
    directionalBias: String(regimeResult.directionalBias),
    volatilityRegime: regimeResult.volatilityRegime,
    stressIndex,
    riskAppetiteIndex,
    sectorTilts: Object.fromEntries(regimeResult.sectorTilts.map((t) => [t.sector, t.bias])),
  };

  log(`Regime: ${regime.regime} (${regime.confidence}%) | Bias: ${regime.directionalBias} | Stress: ${stressIndex} | Appetite: ${riskAppetiteIndex}`);

  // Phase 3: Leading Indicators
  const history = loadSignalHistory().filter((r) => r.date !== date);
  const indicators = computeLeadingIndicators(history, signals, date);
  const indicatorPrompt = buildLeadingIndicatorPrompt(indicators);
  log(`Leading indicators: ${indicators.patterns.length} patterns`);

  // Build prior date info
  const priorDate = new Date(tradingDate);
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  while (priorDate.getUTCDay() === 0 || priorDate.getUTCDay() === 6) {
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  }
  const priorDateStr = priorDate.toISOString().split("T")[0];
  const priorDateDisplay = priorDate.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Write output for Phase 2 (agent) and Phase 3 (scorer)
  const output = {
    date,
    dateStr,
    trialIndex: completed, // Use completed count as index
    trialId,
    priorDate: priorDateStr,
    priorDateDisplay,
    signals,
    regime,
    regimePrompt,
    indicatorPrompt,
    stressIndex,
    riskAppetiteIndex,
    sectorTilts: regimeResult.sectorTilts,
  };

  fs.writeFileSync("/tmp/trial-signals.json", JSON.stringify(output, null, 2));
  log(`Wrote /tmp/trial-signals.json`);
  log(`\nReady for Phase 2: Agent generates trades for ${dateStr}`);
  log(`Regime: ${regime.regime} | Bias: ${regime.directionalBias} | Stress: ${stressIndex}/100 | Appetite: ${riskAppetiteIndex}/100`);
}

main().catch(e => { console.error(e); process.exit(1); });
