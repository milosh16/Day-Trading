#!/usr/bin/env npx tsx
// Phase 1: Composite Signals + Regime Classification
// No API calls — uses Yahoo Finance, FRED, and local computation only.
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
import { getAllTradingDays, getRandomTradingDays } from "./lib/dates.ts";
import type { TrainingState, TrainingRegime } from "./lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "public", "data");
const STATE_FILE = path.join(__dirname, "results", "training-state.json");
const TOTAL_TRIALS = 100;
const START_DATE = "2024-06-01";
const END_DATE = "2026-03-28";
const FULL_DEPTH_SEED = 100;

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function loadSignalHistory(): DailySignalRecord[] {
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
      return JSON.parse(content) as DailySignalRecord;
    });
  } catch {
    return [];
  }
}

async function main() {
  const state: TrainingState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

  // Initialize date sequence if needed
  if (!state.fullDepthDateSequence || state.fullDepthDateSequence.length === 0) {
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 45);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const todayStr = today.toISOString().split("T")[0];
    const recentDays = getAllTradingDays(cutoffStr, END_DATE < todayStr ? END_DATE : todayStr);
    const recentSet = new Set(recentDays);
    const remainingSlots = Math.max(0, TOTAL_TRIALS - recentDays.length);
    const randomPool = getRandomTradingDays(remainingSlots + 50, START_DATE, END_DATE, FULL_DEPTH_SEED)
      .filter(d => !recentSet.has(d))
      .slice(0, remainingSlots);
    state.fullDepthDateSequence = [...recentDays, ...randomPool];
    state.fullDepthCompletedDates = state.fullDepthCompletedDates || [];
    state.fullDepthTotalTrials = TOTAL_TRIALS;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    log(`Generated date sequence: ${recentDays.length} recent + ${randomPool.length} random = ${state.fullDepthDateSequence.length}`);
  }

  const trialIndex = state.fullDepthCurrentTrial || 0;
  if (trialIndex >= (state.fullDepthTotalTrials || TOTAL_TRIALS)) {
    log("All trials complete!");
    process.exit(0);
  }

  const date = state.fullDepthDateSequence[trialIndex];
  const trialId = 10000 + trialIndex + 1;
  const tradingDate = new Date(date + "T12:00:00Z");
  const dateStr = tradingDate.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  log(`=== Phase 1: Composite Signals for ${date} (trial ${trialIndex + 1}/${state.fullDepthTotalTrials || TOTAL_TRIALS}) ===`);

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

  // Fetch price movers for context
  let priceMovers = "";
  try {
    const { fetchHistoricalSignals } = await import("./lib/yahoo-signals.ts");
    // Get key market data points for the agent
    const sp500 = signals.sp500Close || 0;
    const vix = signals.vixClose || 0;
    const futures = signals.sp500FuturesChange || 0;

    priceMovers = [
      `S&P 500: ${sp500.toFixed(0)} (futures ${futures > 0 ? "+" : ""}${futures.toFixed(2)}%)`,
      `VIX: ${vix.toFixed(1)}`,
      `Russell vs S&P: ${((signals.russellClose || 0) / (signals.sp500Close || 1) * 100 - 100).toFixed(2)}% relative`,
      `Sector leaders: ${regimeResult.sectorTilts.filter(t => t.bias > 0).slice(0, 3).map(t => `${t.sector} (+${t.bias})`).join(", ")}`,
      `Sector laggards: ${regimeResult.sectorTilts.filter(t => t.bias < 0).slice(0, 3).map(t => `${t.sector} (${t.bias})`).join(", ")}`,
    ].join("\n");
  } catch { /* ok */ }

  // Build prior date info for temporal constraints
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
    trialIndex,
    trialId,
    priorDate: priorDateStr,
    priorDateDisplay,
    signals,
    regime,
    regimePrompt,
    indicatorPrompt,
    stressIndex,
    riskAppetiteIndex,
    priceMovers,
    sectorTilts: regimeResult.sectorTilts,
  };

  fs.writeFileSync("/tmp/trial-signals.json", JSON.stringify(output, null, 2));
  log(`Wrote /tmp/trial-signals.json`);
  log(`\nReady for Phase 2: Agent generates trades for ${dateStr}`);
  log(`Regime: ${regime.regime} | Bias: ${regime.directionalBias} | Stress: ${stressIndex}/100 | Appetite: ${riskAppetiteIndex}/100`);
  if (priceMovers) log(`\n${priceMovers}`);
}

main().catch(e => { console.error(e); process.exit(1); });
