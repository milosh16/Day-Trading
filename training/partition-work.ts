#!/usr/bin/env npx tsx
// Partition pending backtest dates into N worker queues.
// Usage: npx tsx training/partition-work.ts [NUM_WORKERS]
// Output: training/workers/queue-01.json through queue-NN.json

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKTEST_STATE = path.join(__dirname, "backtest-state.json");
const WORKERS_DIR = path.join(__dirname, "workers");
const TRAINING_DATA_DIR = path.join(__dirname, "..", "public", "data", "training");

const NUM_WORKERS = parseInt(process.argv[2] || "20", 10);

function main() {
  console.log(`=== Partitioning work into ${NUM_WORKERS} queues ===`);

  if (!fs.existsSync(BACKTEST_STATE)) {
    console.error("FATAL: backtest-state.json not found. Run init-backtest.ts first.");
    process.exit(1);
  }

  const backtest = JSON.parse(fs.readFileSync(BACKTEST_STATE, "utf-8"));

  // Also check for completed training data files (more reliable than backtest-state)
  const completedFromFiles = new Set<string>();
  if (fs.existsSync(TRAINING_DATA_DIR)) {
    const files = fs.readdirSync(TRAINING_DATA_DIR).filter(f => f.startsWith("day-") && f.endsWith(".json"));
    for (const f of files) {
      const match = f.match(/day-\d+-(\d{4}-\d{2}-\d{2})\.json/);
      if (match) completedFromFiles.add(match[1]);
    }
  }

  // Merge completed sets
  const completedSet = new Set([
    ...(backtest.completedDates || []),
    ...completedFromFiles,
  ]);

  // Filter pending dates (exclude any already completed)
  const pending = (backtest.pendingDates || []).filter((d: string) => !completedSet.has(d));
  pending.sort();

  console.log(`Total in backtest: ${backtest.totalDays}`);
  console.log(`Already completed: ${completedSet.size}`);
  console.log(`Pending dates: ${pending.length}`);

  if (pending.length === 0) {
    console.log("Nothing to partition — all dates complete!");
    process.exit(0);
  }

  // Round-robin partition into N queues
  fs.mkdirSync(WORKERS_DIR, { recursive: true });
  const queues: string[][] = Array.from({ length: NUM_WORKERS }, () => []);
  for (let i = 0; i < pending.length; i++) {
    queues[i % NUM_WORKERS].push(pending[i]);
  }

  for (let i = 0; i < NUM_WORKERS; i++) {
    const queueFile = path.join(WORKERS_DIR, `queue-${String(i + 1).padStart(2, "0")}.json`);
    fs.writeFileSync(queueFile, JSON.stringify({
      workerId: i + 1,
      totalDates: queues[i].length,
      dates: queues[i],
    }, null, 2));
    console.log(`  Worker ${String(i + 1).padStart(2, "0")}: ${queues[i].length} dates (${queues[i][0] || "empty"} → ${queues[i][queues[i].length - 1] || "empty"})`);
  }

  console.log(`\nQueues written to ${WORKERS_DIR}/`);
  console.log(`\nPaste prompt into each Claude Code session with the worker number.`);
}

main();
