#!/usr/bin/env npx tsx
// Reconcile training state after parallel workers finish.
// Scans all training data files, rebuilds backtest-state.json,
// batch commits, and pushes.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const TRAINING_DATA_DIR = path.join(PROJECT_ROOT, "public", "data", "training");
const BACKTEST_STATE = path.join(__dirname, "backtest-state.json");
const { getAllTradingDays } = await import("./lib/dates.ts");

function main() {
  console.log("=== Reconciling training state ===");

  // Scan all completed training data files
  const completedSet = new Set<string>();
  if (fs.existsSync(TRAINING_DATA_DIR)) {
    const files = fs.readdirSync(TRAINING_DATA_DIR).filter(f => f.startsWith("day-") && f.endsWith(".json"));
    for (const f of files) {
      const match = f.match(/day-\d+-(\d{4}-\d{2}-\d{2})\.json/);
      if (match) completedSet.add(match[1]);
    }
  }

  // Rebuild backtest-state from scratch
  const START_DATE = "2023-06-01";
  const END_DATE = "2026-03-28";
  const allDays = getAllTradingDays(START_DATE, END_DATE);
  const completedInRange = allDays.filter(d => completedSet.has(d));
  const pendingDays = allDays.filter(d => !completedSet.has(d));
  pendingDays.sort();

  // Find max trial ID
  let maxTrialId = 10000;
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
  console.log(`Completed: ${completedInRange.length}/${allDays.length}`);
  console.log(`Remaining: ${pendingDays.length}`);

  // Clean up temp files
  let cleaned = 0;
  try {
    const tmpFiles = fs.readdirSync("/tmp").filter(f => f.startsWith("trial-signals-") || f.startsWith("trial-research-"));
    for (const f of tmpFiles) {
      fs.unlinkSync(path.join("/tmp", f));
      cleaned++;
    }
  } catch { /* ok */ }
  console.log(`Cleaned ${cleaned} temp files`);

  // Clean up lock files
  const lockFile = path.join(__dirname, "results", "training-state.json.lock");
  try { fs.unlinkSync(lockFile); } catch { /* ok */ }

  // Batch commit and push
  try {
    execSync(
      `git add training/results/ public/data/ training/backtest-state.json 2>/dev/null; ` +
      `git diff --staged --quiet || ` +
      `git commit -m "Reconcile: ${completedInRange.length}/${allDays.length} trading days complete"`,
      { stdio: "inherit", timeout: 120000, cwd: PROJECT_ROOT }
    );
    execSync(`git push origin main`, { stdio: "inherit", timeout: 120000, cwd: PROJECT_ROOT });
    console.log("Committed and pushed.");
  } catch (e) {
    console.error(`Git operations failed: ${e}`);
  }
}

main();
