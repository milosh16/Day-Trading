#!/usr/bin/env npx tsx
// ============================================================
// SIGNAL - Conviction Algorithm Training Engine
// ============================================================
// Runs real-world backtesting against historical trading days.
// For each day:
//   1. Generate trade recommendations (Claude + web search)
//   2. Look up real outcomes (Claude + web search)
//   3. Score predictions vs reality
//   4. Analyze which conviction dimensions predicted winners
//   5. Optimize weights
//
// Designed to run for hours. Progress is saved after each trial.
// Restart-safe: resumes from last completed trial.
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { callClaude, extractJson } from "./lib/api.ts";
import { scoreRecommendations, calculateScores, analyzeDimensions } from "./lib/scorer.ts";
import { optimizeWeights, optimizeThreshold, summarizeChanges, DEFAULT_WEIGHTS } from "./lib/optimizer.ts";
import { getRandomTradingDays } from "./lib/dates.ts";
import { verifyRecommendations } from "./lib/anti-leakage.ts";
import { writeDiaryHeader, appendTrialEntry, appendMilestoneSummary } from "./lib/diary.ts";
import type { TradeRecommendation, TrialResult, TrainingState, ConvictionWeights } from "./lib/types.ts";

// ---- Configuration ----
const TOTAL_TRIALS = parseInt(process.env.TOTAL_TRIALS || "500", 10);
const STATE_FILE = path.join(__dirname, "results", "training-state.json");
const LOG_FILE = path.join(__dirname, "results", "training-log.txt");
// Optimize weights every N trials
const OPTIMIZE_EVERY = 10;
// Date range for historical testing
const START_DATE = "2024-06-01";
const END_DATE = "2026-03-28"; // A few days before today

// ---- Helpers ----
function log(msg: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function loadState(): TrainingState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
  return {
    currentTrial: 0,
    totalTrials: TOTAL_TRIALS,
    weights: { ...DEFAULT_WEIGHTS },
    results: [],
    bestScore: 0,
    bestWeights: { ...DEFAULT_WEIGHTS },
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    totalTokensUsed: 0,
    weightHistory: [],
  };
}

function saveState(state: TrainingState): void {
  state.lastUpdatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Graceful shutdown: save state on SIGTERM/SIGINT (GitHub Actions sends SIGTERM on timeout)
let currentState: TrainingState | null = null;
function handleShutdown(signal: string): void {
  console.log(`\nReceived ${signal} — saving state and exiting gracefully...`);
  if (currentState) {
    saveState(currentState);
    console.log(`State saved at trial ${currentState.currentTrial}. Will resume on next run.`);
  }
  process.exit(0);
}
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

function weightsToPrompt(weights: ConvictionWeights): string {
  return Object.entries(weights)
    .map(([key, val]) => `- ${key}: ${(val * 100).toFixed(1)}%`)
    .join("\n");
}

// ---- Core Training Loop ----
async function generateRecommendations(
  date: string,
  weights: ConvictionWeights
): Promise<{ recs: TradeRecommendation[]; tokensUsed: number }> {
  const dateDisplay = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Calculate the day BEFORE the trading day — we only use pre-market information
  const tradingDate = new Date(date + "T12:00:00Z");
  const priorDate = new Date(tradingDate);
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  // Skip weekends for the "prior" date
  while (priorDate.getUTCDay() === 0 || priorDate.getUTCDay() === 6) {
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  }
  const priorDateStr = priorDate.toISOString().split("T")[0];
  const priorDateDisplay = priorDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const response = await callClaude({
    system: `You are SIGNAL, an AI trading intelligence system. You are generating a PRE-MARKET briefing for trading on ${dateDisplay}.

TEMPORAL CONSTRAINT — THIS IS CRITICAL:
You may ONLY use information available BEFORE the market opens on ${dateDisplay}.
This means: news, data, earnings, events from ${priorDateDisplay} and earlier.
You must NOT reference anything that happened DURING or AFTER the trading session on ${dateDisplay}.
Pretend it is 6:00 AM Eastern on ${dateDisplay}. The market has not opened yet.
Search for news and data from "${priorDateStr}" and the days leading up to "${date}".

Your job: based on pre-market information only, generate trade recommendations for ${dateDisplay}.

CONVICTION SCORING: Score each recommendation on 7 dimensions (0-100). Current dimension weights:
${weightsToPrompt(weights)}

CRITICAL RULES:
- Use web_search to find news, earnings, economic data from BEFORE ${dateDisplay}
- Search for: "${priorDateStr} stock market", "${priorDateStr} earnings reports", "economic calendar ${date}", "pre-market ${date}"
- Only recommend trades based on information available BEFORE market open
- Do NOT use hindsight — you do NOT know what happens on or after ${dateDisplay}
- If nothing compelling was happening, return an empty array
- Every trade needs specific entry price (use prior day close or pre-market levels), target, and stop-loss
- Minimum conviction threshold: 72/100 weighted score

Return a JSON array wrapped in <json> tags:
<json>[
  {
    "symbol": "TICKER",
    "direction": "long" | "short",
    "entryPrice": 123.45,
    "targetPrice": 135.00,
    "stopLoss": 118.00,
    "thesis": "1-2 sentence thesis",
    "catalyst": "Specific catalyst on this date",
    "conviction": {
      "catalystClarity": { "score": 85, "reasoning": "..." },
      "technicalSetup": { "score": 75, "reasoning": "..." },
      "riskReward": { "score": 80, "reasoning": "..." },
      "volumeLiquidity": { "score": 70, "reasoning": "..." },
      "marketAlignment": { "score": 78, "reasoning": "..." },
      "informationEdge": { "score": 72, "reasoning": "..." },
      "timingUrgency": { "score": 80, "reasoning": "..." }
    }
  }
]</json>

If no setups meet the threshold, return: <json>[]</json>`,
    messages: [
      {
        role: "user",
        content: `It is 6:00 AM Eastern on ${dateDisplay}. The market has not opened yet. Search for news, earnings reports, economic data, and market events from ${priorDateDisplay} and the preceding days. Based ONLY on pre-market information, generate your best trade recommendations for today with full conviction scoring. You do not know what will happen today — no hindsight allowed.`,
      },
    ],
    maxTokens: 4096,
    useWebSearch: true,
  });

  const recs = extractJson<TradeRecommendation[]>(response.text, true) || [];
  return {
    recs,
    tokensUsed: response.inputTokens + response.outputTokens,
  };
}

async function runTrial(
  trialNum: number,
  date: string,
  weights: ConvictionWeights
): Promise<TrialResult> {
  log(`--- Trial ${trialNum} | ${date} ---`);

  // Step 1: Generate recommendations
  log(`  Generating recommendations...`);
  const { recs, tokensUsed: genTokens } = await generateRecommendations(date, weights);
  log(`  Got ${recs.length} recommendations`);

  if (recs.length === 0) {
    log(`  No recommendations — scoring as neutral`);
    return {
      trialId: trialNum,
      date,
      generatedAt: new Date().toISOString(),
      recommendations: [],
      outcomes: [],
      scores: {
        directionAccuracy: 0,
        targetHitRate: 0,
        stopHitRate: 0,
        avgReturnPercent: 0,
        profitFactor: 0,
        winRate: 0,
        totalScore: 50, // neutral — no trades is acceptable
      },
      dimensionAnalysis: {},
      weights: { ...weights },
      totalTokensUsed: genTokens,
    };
  }

  // Step 2: Anti-leakage verification (price check + hindsight audit)
  log(`  Verifying against data leakage (${recs.length} recs)...`);
  const { cleanRecs, flaggedCount, tokensUsed: verifyTokens } = await verifyRecommendations(date, recs);
  if (flaggedCount > 0) {
    log(`  Filtered ${flaggedCount} trades for possible leakage → ${cleanRecs.length} clean`);
  }

  // Use only verified clean recommendations
  const verifiedRecs = cleanRecs.length > 0 ? cleanRecs : recs.slice(0, 0); // empty if all flagged

  if (verifiedRecs.length === 0) {
    log(`  All recommendations flagged — scoring as neutral`);
    return {
      trialId: trialNum,
      date,
      generatedAt: new Date().toISOString(),
      recommendations: recs, // keep original for analysis
      outcomes: [],
      scores: {
        directionAccuracy: 0, targetHitRate: 0, stopHitRate: 0,
        avgReturnPercent: 0, profitFactor: 0, winRate: 0, totalScore: 50,
      },
      dimensionAnalysis: {},
      weights: { ...weights },
      totalTokensUsed: genTokens + verifyTokens,
    };
  }

  // Step 3: Score against real outcomes
  log(`  Looking up real outcomes for ${verifiedRecs.length} verified trades...`);
  const { outcomes, tokensUsed: scoreTokens } = await scoreRecommendations(date, verifiedRecs);
  log(`  Got ${outcomes.length} outcomes`);

  // Step 4: Calculate scores
  const scores = calculateScores(verifiedRecs, outcomes);
  log(`  Score: ${scores.totalScore} | Win: ${scores.winRate}% | Dir: ${scores.directionAccuracy}% | PF: ${scores.profitFactor}`);

  // Step 5: Analyze dimensions
  const dimensionAnalysis = analyzeDimensions(verifiedRecs, outcomes);

  return {
    trialId: trialNum,
    date,
    generatedAt: new Date().toISOString(),
    recommendations: verifiedRecs,
    outcomes,
    scores,
    dimensionAnalysis,
    weights: { ...weights },
    totalTokensUsed: genTokens + verifyTokens + scoreTokens,
  };
}

async function main(): Promise<void> {
  log("=== SIGNAL Conviction Training Engine ===");
  log(`Target: ${TOTAL_TRIALS} trials`);

  // Load or initialize state
  const state = loadState();
  currentState = state; // expose to shutdown handler
  log(`Resuming from trial ${state.currentTrial}/${state.totalTrials}`);
  log(`Best score so far: ${state.bestScore}`);

  // Generate dates for remaining trials
  const remainingTrials = TOTAL_TRIALS - state.currentTrial;
  if (remainingTrials <= 0) {
    log("All trials complete!");
    printSummary(state);
    return;
  }

  // Get dates we haven't tested yet
  const testedDates = new Set(state.results.map((r) => r.date));
  let dates = getRandomTradingDays(remainingTrials * 2, START_DATE, END_DATE)
    .filter((d) => !testedDates.has(d));

  if (dates.length < remainingTrials) {
    // If we've exhausted unique dates, allow repeats
    const moreDates = getRandomTradingDays(remainingTrials, START_DATE, END_DATE);
    dates = [...dates, ...moreDates];
  }

  dates = dates.slice(0, remainingTrials);

  log(`Selected ${dates.length} dates for testing`);
  log(`Current weights:\n${weightsToPrompt(state.weights)}`);

  // Initialize diary if starting fresh
  if (state.currentTrial === 0) {
    writeDiaryHeader(state);
  }

  // Run trials
  for (let i = 0; i < dates.length; i++) {
    const trialNum = state.currentTrial + 1;
    const date = dates[i];

    try {
      const result = await runTrial(trialNum, date, state.weights);

      // Update state
      state.results.push(result);
      state.currentTrial = trialNum;
      state.totalTokensUsed += result.totalTokensUsed;

      // Write diary entry for this day
      appendTrialEntry(result, trialNum, TOTAL_TRIALS);

      if (result.scores.totalScore > state.bestScore) {
        state.bestScore = result.scores.totalScore;
        state.bestWeights = { ...state.weights };
        log(`  ★ New best score: ${state.bestScore}`);
      }

      // Optimize weights periodically
      if (trialNum % OPTIMIZE_EVERY === 0 && trialNum > 0) {
        log(`\n=== Optimizing weights (trial ${trialNum}) ===`);
        const oldWeights = { ...state.weights };
        state.weights = optimizeWeights(state.weights, state.results);
        log(summarizeChanges(oldWeights, state.weights));

        const newThreshold = optimizeThreshold(state.results);
        log(`  Recommended threshold: ${newThreshold}`);

        state.weightHistory.push({
          trial: trialNum,
          weights: { ...state.weights },
          score: result.scores.totalScore,
        });

        // Write milestone summary to diary
        appendMilestoneSummary(trialNum, state, oldWeights, state.weights);

        // Print rolling stats
        const last10 = state.results.slice(-10);
        const avg10 = last10.reduce((s, r) => s + r.scores.totalScore, 0) / last10.length;
        log(`  Rolling avg (last 10): ${avg10.toFixed(1)}`);
        log(`  Best overall: ${state.bestScore}`);
        log("");

        // Commit diary to repo every 10 trials (so progress is visible live)
        if (process.env.CI) {
          try {
            const { execSync } = await import("child_process");
            execSync('git add training/results/training-diary.md training/results/optimized-weights.json training/results/conviction-update.ts 2>/dev/null; git diff --staged --quiet || git commit -m "Training diary: ' + trialNum + '/' + TOTAL_TRIALS + ' trials complete" && git push origin claude/conviction-training', { stdio: "pipe" });
            log(`  Diary committed to repo (trial ${trialNum})`);
          } catch {
            log(`  (Could not push diary update — will retry next milestone)`);
          }
        }
      }

      // Save after every trial (restart-safe)
      saveState(state);

    } catch (error) {
      log(`  ERROR on trial ${trialNum}: ${error instanceof Error ? error.message : error}`);
      // Save state even on error so we can resume
      saveState(state);
      // Wait a bit before continuing (might be a transient API issue)
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  log("\n=== Training Complete ===");
  printSummary(state);
  exportOptimizedWeights(state);
}

function printSummary(state: TrainingState): void {
  log("\n--- FINAL SUMMARY ---");
  log(`Trials completed: ${state.currentTrial}`);
  log(`Total tokens used: ${state.totalTokensUsed.toLocaleString()}`);
  log(`Best score: ${state.bestScore}`);
  log(`Best weights:\n${weightsToPrompt(state.bestWeights)}`);

  // Calculate overall averages
  const withTrades = state.results.filter((r) => r.recommendations.length > 0);
  if (withTrades.length > 0) {
    const avgScore = withTrades.reduce((s, r) => s + r.scores.totalScore, 0) / withTrades.length;
    const avgWinRate = withTrades.reduce((s, r) => s + r.scores.winRate, 0) / withTrades.length;
    const avgPF = withTrades.reduce((s, r) => s + r.scores.profitFactor, 0) / withTrades.length;
    const avgDir = withTrades.reduce((s, r) => s + r.scores.directionAccuracy, 0) / withTrades.length;
    const noTradeDays = state.results.filter((r) => r.recommendations.length === 0).length;

    log(`\nOverall averages (${withTrades.length} days with trades):`);
    log(`  Composite score: ${avgScore.toFixed(1)}/100`);
    log(`  Win rate: ${avgWinRate.toFixed(1)}%`);
    log(`  Profit factor: ${avgPF.toFixed(2)}`);
    log(`  Direction accuracy: ${avgDir.toFixed(1)}%`);
    log(`  Days with no trades: ${noTradeDays} (${((noTradeDays / state.results.length) * 100).toFixed(1)}%)`);
  }

  // Weight evolution
  if (state.weightHistory.length > 0) {
    log("\nWeight evolution:");
    for (const entry of state.weightHistory) {
      log(`  Trial ${entry.trial}: score=${entry.score} | ${Object.entries(entry.weights).map(([k, v]) => `${k.slice(0, 4)}=${(v * 100).toFixed(0)}%`).join(" ")}`);
    }
  }
}

function exportOptimizedWeights(state: TrainingState): void {
  const exportPath = path.join(__dirname, "results", "optimized-weights.json");
  const data = {
    exportedAt: new Date().toISOString(),
    trialsCompleted: state.currentTrial,
    bestScore: state.bestScore,
    bestWeights: state.bestWeights,
    currentWeights: state.weights,
    recommendedThreshold: optimizeThreshold(state.results),
    weightHistory: state.weightHistory,
  };
  fs.writeFileSync(exportPath, JSON.stringify(data, null, 2));
  log(`\nOptimized weights exported to: ${exportPath}`);

  // Also generate the TypeScript code to update conviction.ts
  const tsPath = path.join(__dirname, "results", "conviction-update.ts");
  const tsCode = `// Auto-generated from training run (${state.currentTrial} trials)
// Best score: ${state.bestScore}/100
// Generated at: ${new Date().toISOString()}

export const CONVICTION_THRESHOLD = ${optimizeThreshold(state.results)};

export const DIMENSION_WEIGHTS = {
  catalystClarity: ${state.bestWeights.catalystClarity.toFixed(3)},
  technicalSetup: ${state.bestWeights.technicalSetup.toFixed(3)},
  riskReward: ${state.bestWeights.riskReward.toFixed(3)},
  volumeLiquidity: ${state.bestWeights.volumeLiquidity.toFixed(3)},
  marketAlignment: ${state.bestWeights.marketAlignment.toFixed(3)},
  informationEdge: ${state.bestWeights.informationEdge.toFixed(3)},
  timingUrgency: ${state.bestWeights.timingUrgency.toFixed(3)},
} as const;
`;
  fs.writeFileSync(tsPath, tsCode);
  log(`TypeScript update code exported to: ${tsPath}`);
}

// Run
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
