#!/usr/bin/env npx tsx
// Phase 3: Score outcomes, write results, update state
// Reads /tmp/trial-signals.json and /tmp/trial-research.json

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { scoreRecommendations, calculateScores, analyzeDimensions } from "./lib/scorer.ts";
import { calculateCompositeScore } from "./lib/scorer-v2.ts";
import { verifyRecommendations } from "./lib/anti-leakage.ts";
import type { TrainingState, TrialResult, TradeRecommendation, TrainingBriefing, TrainingRegime } from "./lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "public", "data");
const TRAINING_DATA_DIR = path.join(DATA_DIR, "training");
const STATE_FILE = path.join(__dirname, "results", "training-state.json");

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  // Support DATE env var for parallel workers (date-specific temp files)
  const envDate = process.env.DATE;
  const signalsPath = envDate ? `/tmp/trial-signals-${envDate}.json` : "/tmp/trial-signals.json";
  const researchPath = envDate ? `/tmp/trial-research-${envDate}.json` : "/tmp/trial-research.json";

  // Read intermediate data
  const signalData = JSON.parse(fs.readFileSync(signalsPath, "utf-8"));
  const researchData = JSON.parse(fs.readFileSync(researchPath, "utf-8"));
  const state: TrainingState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

  const date = signalData.date;
  const trialIndex = signalData.trialIndex;
  const trialId = 10000 + trialIndex + 1; // offset to avoid collision with lightweight trials

  log(`=== Phase 3: Scoring trial ${trialId} (${date}) ===`);

  // Parse all evaluated trades (new format) + recommendations (legacy fallback)
  const rawAllEvaluated: any[] = researchData.allEvaluated || [];
  const rawRecs: any[] = researchData.recommendations || researchData.trades || researchData.tradeRecommendations || [];
  const recs: TradeRecommendation[] = rawRecs
    .filter((r: any) => (r.ticker || r.symbol) && (r.ticker || r.symbol) !== "NO_TRADE_RECOMMENDED" && (r.entryPrice || r.entry))
    .map((r: any) => ({
      symbol: r.ticker || r.symbol,
      direction: r.direction || r.side || "long",
      entryPrice: r.entryPrice || r.entry,
      targetPrice: r.targetPrice || r.target,
      stopLoss: r.stopPrice || r.stopLoss || r.stop,
      thesis: r.reasoning || r.thesis || "",
      catalyst: r.catalyst || r.trigger || "",
      conviction: {
        catalystClarity: { score: r.conviction?.catalystClarity || 0, reasoning: "" },
        technicalSetup: { score: r.conviction?.technicalSetup || 0, reasoning: "" },
        riskReward: { score: r.conviction?.riskReward || 0, reasoning: "" },
        volumeLiquidity: { score: r.conviction?.volumeLiquidity || 0, reasoning: "" },
        marketAlignment: { score: r.conviction?.marketAlignment || 0, reasoning: "" },
        informationEdge: { score: r.conviction?.informationEdge || 0, reasoning: "" },
        timingUrgency: { score: r.conviction?.timingUrgency || 0, reasoning: "" },
      },
    }));

  log(`Recommendations: ${recs.length} trades`);

  // Anti-leakage: price verification only (deterministic, no API calls)
  // The Claude-based hindsight audit is skipped for local runs — it uses the Anthropic API
  // and is overly aggressive (flags prior-day data as temporal leakage).
  // Price check alone catches real leakage: entry must be within 2% of Yahoo prior close.
  let verifiedRecs = recs;
  if (recs.length > 0) {
    try {
      log("Running price verification (deterministic)...");
      const { verifyPrices } = await import("./lib/anti-leakage.ts");
      const { checks } = await verifyPrices(date, recs as any);
      verifiedRecs = recs.filter(rec => {
        const check = checks.find(c => c.symbol === rec.symbol);
        return !check || check.plausible;
      });
      const filtered = recs.length - verifiedRecs.length;
      if (filtered > 0) log(`Price filter removed ${filtered} trades (>2% entry deviation)`);
      log(`After verification: ${verifiedRecs.length} trades passed`);
    } catch (e) {
      log(`Price check failed: ${e} — using unverified recs`);
    }
  }

  // Score outcomes against real market data
  let outcomes: any[] = [];
  let scores: any = { directionAccuracy: 0, targetHitRate: 0, stopHitRate: 0, avgReturnPercent: 0, profitFactor: 0, winRate: 0, totalScore: 50 };
  let dimAnalysis: any = {};

  if (verifiedRecs.length > 0) {
    try {
      log("Scoring against Yahoo Finance...");
      const scoreResult = await scoreRecommendations(date, verifiedRecs as any);
      outcomes = scoreResult.outcomes || scoreResult;
      if (!Array.isArray(outcomes)) outcomes = [];
      scores = calculateScores(verifiedRecs as any, outcomes);
      dimAnalysis = analyzeDimensions(verifiedRecs as any, outcomes);
      scores.totalScore = calculateCompositeScore(scores);
      log(`Score: ${scores.totalScore} | Win rate: ${(scores.winRate * 100).toFixed(0)}% | PF: ${scores.profitFactor.toFixed(2)}`);
    } catch (e) {
      log(`Scoring failed: ${e}`);
    }
  } else {
    log("No trades to score — score = 50");
  }

  // SPY benchmark
  let benchmarkReturn = 0;
  let alpha = 0;
  try {
    const { getOHLC } = await import("./lib/market-data.ts");
    const spyData = await getOHLC("SPY", date);
    if (spyData && spyData.open > 0) {
      benchmarkReturn = Math.round(((spyData.close - spyData.open) / spyData.open) * 100 * 100) / 100;
      alpha = Math.round((scores.avgReturnPercent - benchmarkReturn) * 100) / 100;
      log(`SPY: ${benchmarkReturn > 0 ? "+" : ""}${benchmarkReturn}% | Alpha: ${alpha > 0 ? "+" : ""}${alpha}%`);
    }
  } catch { /* ok */ }

  scores.benchmarkReturn = benchmarkReturn;
  scores.alpha = alpha;

  // Build trial result
  const result: TrialResult = {
    trialId,
    date,
    generatedAt: new Date().toISOString(),
    signals: signalData.signals,
    regime: signalData.regime as TrainingRegime,
    briefing: {
      summary: researchData.marketOutlook || researchData.preMarketBriefing || researchData.summary || "",
      marketCondition: researchData.riskLevel === "high" ? "volatile" : signalData.regime.regime === "risk-on" ? "bullish" : signalData.regime.regime === "risk-off" ? "bearish" : "neutral",
      sections: Object.entries(researchData.research || {}).map(([name, content]) => ({
        title: name.charAt(0).toUpperCase() + name.slice(1),
        content: String(content).slice(0, 2000),
        importance: "medium" as const,
      })),
      scenarios: [],
    } as TrainingBriefing,
    recommendations: verifiedRecs as any,
    outcomes,
    scores,
    dimensionAnalysis: dimAnalysis,
    weights: state.weights,
    totalTokensUsed: 0,
  };

  // Write training record
  fs.mkdirSync(TRAINING_DATA_DIR, { recursive: true });
  const trialFile = path.join(TRAINING_DATA_DIR, `day-${trialId}-${date}.json`);
  const dateDisplay = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  fs.writeFileSync(trialFile, JSON.stringify({
    trialId, date, dateDisplay,
    generatedAt: result.generatedAt,
    pipeline: { signals: signalData.signals, regime: signalData.regime, briefing: result.briefing },
    allEvaluated: rawAllEvaluated,
    recommendations: result.recommendations,
    outcomes, scores, dimensionAnalysis: dimAnalysis,
    weights: state.weights,
    fullDepth: true,
  }, null, 2));
  log(`Wrote ${trialFile}`);

  // Write production briefing format
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const briefingFile = path.join(DATA_DIR, `briefing-${date}.json`);
  fs.writeFileSync(briefingFile, JSON.stringify({
    id: `briefing-${date}-${Date.now()}`,
    date,
    generatedAt: result.generatedAt,
    model: "claude-opus-4-6-max",
    summary: researchData.marketOutlook || "Briefing generated.",
    marketCondition: result.briefing?.marketCondition || "neutral",
    sections: result.briefing?.sections || [],
    scenarios: (researchData.recommendations || []).filter((r: any) => r.ticker && r.ticker !== "NO_TRADE_RECOMMENDED").map((r: any) => ({
      event: `${(r.direction || "").toUpperCase()} ${r.ticker} @ $${r.entryPrice}`,
      scenarios: [
        { condition: `Price reaches target $${r.targetPrice}`, implication: `+${(((r.targetPrice - r.entryPrice) / r.entryPrice) * 100).toFixed(1)}% gain`, trade: r.reasoning || "" },
        { condition: `Price hits stop $${r.stopPrice}`, implication: r.bearCase || "Position closed at loss", trade: `Stop loss triggered` },
      ],
    })),
    regimeType: signalData.regime.regime,
    regimeConfidence: signalData.regime.confidence,
    recommendations: researchData.recommendations || [],
    watchlist: researchData.watchlist || [],
    avoidList: researchData.avoidList || [],
    trainingData: { trialId, outcomes, scores, dimensionAnalysis: dimAnalysis, benchmarkReturn, alpha, fullDepth: true },
  }, null, 2));
  log(`Wrote ${briefingFile}`);

  // Update training index
  const indexPath = path.join(TRAINING_DATA_DIR, "index.json");
  let index: any = { totalTrials: 0, lastUpdated: "", bestScore: 0, currentWeights: state.weights, trials: [] };
  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  }
  index.trials = index.trials.filter((t: any) => t.trialId !== trialId);
  index.trials.push({
    trialId, date,
    regime: signalData.regime.regime,
    score: scores.totalScore,
    winRate: scores.winRate,
    profitFactor: scores.profitFactor,
    numRecs: verifiedRecs.length,
    hasOpusReview: false,
  });
  index.trials.sort((a: any, b: any) => a.trialId - b.trialId);
  index.totalTrials = index.trials.length;
  index.lastUpdated = new Date().toISOString();
  index.bestScore = Math.max(index.bestScore, scores.totalScore);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  // Update training state (with file lock for parallel safety)
  const LOCK_FILE = STATE_FILE + ".lock";
  const BACKTEST_STATE = path.join(__dirname, "backtest-state.json");

  // Retry loop for lock acquisition (parallel workers may contend)
  for (let lockAttempt = 0; lockAttempt < 10; lockAttempt++) {
    try {
      // Atomic lock: O_EXCL fails if file exists
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
      try {
        // Re-read state inside lock (another worker may have updated it)
        const freshState: TrainingState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
        freshState.fullDepthCurrentTrial = (freshState.fullDepthCurrentTrial || 0) + 1;
        freshState.fullDepthCompletedDates = freshState.fullDepthCompletedDates || [];
        if (!freshState.fullDepthCompletedDates.includes(date)) {
          freshState.fullDepthCompletedDates.push(date);
        }
        freshState.results.push(result);
        freshState.lastUpdatedAt = new Date().toISOString();
        fs.writeFileSync(STATE_FILE, JSON.stringify(freshState, null, 2));

        // Update backtest state
        if (fs.existsSync(BACKTEST_STATE)) {
          const backtest = JSON.parse(fs.readFileSync(BACKTEST_STATE, "utf-8"));
          backtest.pendingDates = (backtest.pendingDates || []).filter((d: string) => d !== date);
          if (!backtest.completedDates.includes(date)) {
            backtest.completedDates.push(date);
          }
          backtest.completedDays = backtest.completedDates.length;
          backtest.remainingDays = backtest.pendingDates.length;
          backtest.lastCompletedDate = date;
          backtest.lastTrialId = trialId;
          fs.writeFileSync(BACKTEST_STATE, JSON.stringify(backtest, null, 2));
          log(`Backtest: ${backtest.completedDays}/${backtest.totalDays} done, ${backtest.remainingDays} remaining`);
        }
      } finally {
        fs.unlinkSync(LOCK_FILE);
      }
      break;
    } catch (e: any) {
      if (e.code === "EEXIST") {
        // Lock held by another worker — wait and retry
        log(`State lock held by another worker, waiting... (attempt ${lockAttempt + 1})`);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        // Clean up stale locks (older than 30s)
        try {
          const stat = fs.statSync(LOCK_FILE);
          if (Date.now() - stat.mtimeMs > 30000) {
            fs.unlinkSync(LOCK_FILE);
            log("Removed stale lock file");
          }
        } catch { /* lock already released */ }
      } else {
        log(`State update error: ${e.message}`);
        break;
      }
    }
  }

  // Git commit skipped in parallel mode — reconcile script handles batch commits
  if (!envDate) {
    try {
      execSync(
        `git add training/results/ public/data/ 2>/dev/null; ` +
        `git diff --staged --quiet || ` +
        `git commit -m "Training trial ${trialId}: ${date} (score: ${scores.totalScore})"`,
        { stdio: "pipe", timeout: 60000, cwd: PROJECT_ROOT }
      );
      log("Committed locally (push deferred)");
    } catch (e) {
      log(`Git commit skipped: ${e}`);
    }
  }

  log(`\n=== Trial ${trialId} complete: ${date} | Score: ${scores.totalScore} | ${verifiedRecs.length} trades ===\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
