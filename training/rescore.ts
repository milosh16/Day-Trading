#!/usr/bin/env npx tsx
import { rescoreAllTrials } from "./lib/scorer-v2.ts";

async function main() {
  console.log("Rescoring all trials with v2 composite scorer...");
  const state = await rescoreAllTrials();
  console.log(`Done. ${state.results.length} trials rescored.`);
  console.log(`New best score: ${state.bestScore}`);

  // Show distribution
  const buckets: Record<string, number> = {
    "0-30": 0,
    "30-50": 0,
    "50-60": 0,
    "60-70": 0,
    "70-80": 0,
    "80-90": 0,
    "90-100": 0,
  };
  for (const r of state.results) {
    const s = r.scores.totalScore;
    if (s < 30) buckets["0-30"]++;
    else if (s < 50) buckets["30-50"]++;
    else if (s < 60) buckets["50-60"]++;
    else if (s < 70) buckets["60-70"]++;
    else if (s < 80) buckets["70-80"]++;
    else if (s < 90) buckets["80-90"]++;
    else buckets["90-100"]++;
  }
  console.log("\nScore distribution:");
  for (const [range, count] of Object.entries(buckets)) {
    console.log(`  ${range}: ${count} trials ${"█".repeat(count)}`);
  }
}

main().catch(console.error);
