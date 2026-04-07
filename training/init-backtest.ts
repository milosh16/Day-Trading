#!/usr/bin/env npx tsx
// Initialize the full 3-year backtest calendar.
// Generates every trading day from Jun 2023 to Mar 2026,
// marks already-completed dates, and writes backtest-state.json.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getAllTradingDays } from "./lib/dates.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKTEST_STATE = path.join(__dirname, "backtest-state.json");
const TRAINING_STATE = path.join(__dirname, "results", "training-state.json");
const TRAINING_DATA_DIR = path.join(__dirname, "..", "public", "data", "training");

const START_DATE = "2023-06-01";
const END_DATE = "2026-03-28";

function main() {
  console.log("=== Initializing Full 3-Year Backtest ===");
  console.log(`Date range: ${START_DATE} to ${END_DATE}`);

  // Generate all trading days
  const allDays = getAllTradingDays(START_DATE, END_DATE);
  console.log(`Total trading days: ${allDays.length}`);

  // Find already-completed dates from multiple sources
  const completedSet = new Set<string>();

  // 1. From training-state.json
  if (fs.existsSync(TRAINING_STATE)) {
    const state = JSON.parse(fs.readFileSync(TRAINING_STATE, "utf-8"));
    for (const r of state.results || []) {
      if (r.date) completedSet.add(r.date);
    }
    for (const d of state.fullDepthCompletedDates || []) {
      completedSet.add(d);
    }
    for (const d of state.completedDates || []) {
      completedSet.add(d);
    }
  }

  // 2. From existing training data files
  if (fs.existsSync(TRAINING_DATA_DIR)) {
    const files = fs.readdirSync(TRAINING_DATA_DIR).filter(f => f.startsWith("day-") && f.endsWith(".json"));
    for (const f of files) {
      // day-10001-2025-03-18.json -> 2025-03-18
      const match = f.match(/day-\d+-(\d{4}-\d{2}-\d{2})\.json/);
      if (match) completedSet.add(match[1]);
    }
  }

  // Filter to only dates in our range
  const completedInRange = allDays.filter(d => completedSet.has(d));
  const pendingDays = allDays.filter(d => !completedSet.has(d));

  // Sort pending chronologically
  pendingDays.sort();

  // Find the max trial ID from existing data
  let maxTrialId = 10000;
  if (fs.existsSync(TRAINING_STATE)) {
    const state = JSON.parse(fs.readFileSync(TRAINING_STATE, "utf-8"));
    for (const r of state.results || []) {
      if (r.trialId && r.trialId > maxTrialId) maxTrialId = r.trialId;
    }
  }
  if (fs.existsSync(TRAINING_DATA_DIR)) {
    const files = fs.readdirSync(TRAINING_DATA_DIR).filter(f => f.startsWith("day-") && f.endsWith(".json"));
    for (const f of files) {
      const match = f.match(/day-(\d+)-/);
      if (match) {
        const id = parseInt(match[1]);
        if (id > maxTrialId) maxTrialId = id;
      }
    }
  }

  const backtestState = {
    startDate: START_DATE,
    endDate: END_DATE,
    totalDays: allDays.length,
    completedDays: completedInRange.length,
    remainingDays: pendingDays.length,
    lastTrialId: maxTrialId,
    completedDates: completedInRange,
    pendingDates: pendingDays,
    initialized: true,
    initializedAt: new Date().toISOString(),
  };

  fs.writeFileSync(BACKTEST_STATE, JSON.stringify(backtestState, null, 2));

  console.log(`\nCompleted: ${completedInRange.length} days`);
  console.log(`Remaining: ${pendingDays.length} days`);
  console.log(`Next trial ID: ${maxTrialId + 1}`);
  console.log(`\nNext 5 dates to process:`);
  for (const d of pendingDays.slice(0, 5)) {
    console.log(`  ${d}`);
  }
  console.log(`\nBacktest state written to ${BACKTEST_STATE}`);
}

main();
