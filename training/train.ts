#!/usr/bin/env npx tsx
// ============================================================
// SIGNAL - Conviction Algorithm Training Engine (v2)
// ============================================================
// Full production pipeline per trial:
//   Phase 1: Signal Gathering (100+ fields via Claude + web search)
//   Phase 2: Regime Classification (local computation)
//   Phase 3: Daily Briefing (Claude + web search)
//   Phase 4: Trade Recommendations with regime context
//   Phase 5: Anti-Leakage Verification (Yahoo Finance + audit)
//   Phase 6: Outcome Scoring (Yahoo Finance, deterministic)
//   Phase 7: Store to App (public/data/training/)
//
// Every 10 trials: Opus reviews full pipeline + revises recs
// Designed to run for hours. Restart-safe.
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const APP_DATA_DIR = path.join(PROJECT_ROOT, "public", "data", "training");

import { callClaude, extractJson } from "./lib/api.ts";
import { scoreRecommendations, calculateScores, analyzeDimensions } from "./lib/scorer.ts";
import { optimizeWeights, optimizeThreshold, summarizeChanges, DEFAULT_WEIGHTS } from "./lib/optimizer.ts";
import { getRandomTradingDays } from "./lib/dates.ts";
import { verifyRecommendations } from "./lib/anti-leakage.ts";
import { writeDiaryHeader, appendTrialEntry, appendMilestoneSummary } from "./lib/diary.ts";
import { classifyRegime, buildRegimePrompt } from "../src/lib/market-regime.ts";
import type { GlobalSignals, RegimeAssessment } from "../src/lib/market-regime.ts";
import { computeStressIndex, computeRiskAppetiteIndex } from "../src/lib/leading-indicators.ts";
import type {
  TradeRecommendation, TrialResult, TrainingState, ConvictionWeights,
  TrainingBriefing, TrainingRegime, TrainingDayRecord,
} from "./lib/types.ts";

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

// ---- Phase 1: Signal Gathering ----
async function generateSignals(
  date: string
): Promise<{ signals: GlobalSignals; tokensUsed: number }> {
  const tradingDate = new Date(date + "T12:00:00Z");
  const priorDate = new Date(tradingDate);
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  while (priorDate.getUTCDay() === 0 || priorDate.getUTCDay() === 6) {
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  }
  const priorDateStr = priorDate.toISOString().split("T")[0];
  const dateDisplay = tradingDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const response = await callClaude({
    system: `You are SIGNAL's market regime scanner. Gather comprehensive global market data for the close of ${priorDateStr} (the day before trading on ${dateDisplay}).

TEMPORAL CONSTRAINT: Only data available BEFORE market open on ${dateDisplay}. Search for "${priorDateStr} market data", "${priorDateStr} stock market close", "${priorDateStr} VIX close", etc.

Return a JSON object in <json> tags with ALL these fields (use 0 for unknown numbers, "" for unknown strings, false for unknown booleans):

<json>{
  "spFuturesChange": 0, "nasdaqFuturesChange": 0, "dowFuturesChange": 0, "russellFuturesChange": 0, "vixFuturesChange": 0,
  "vix": 0, "vixChange": 0, "vixTermStructure": "contango", "vix9d": 0, "vix3m": 0, "skewIndex": 0, "putCallRatio": 0, "spxGammaExposure": "neutral",
  "tenYearYield": 0, "tenYearYieldChange": 0, "twoYearYield": 0, "twoYearYieldChange": 0, "thirtyYearYield": 0, "threeMonthYield": 0, "twoTenSpread": 0, "threeMoTenYrSpread": 0, "realYield10Y": 0, "fedFundsRate": 0, "fedFundsExpected": 0,
  "dollarIndex": 0, "dollarIndexChange": 0, "eurUsd": 0, "eurUsdChange": 0, "usdJpy": 0, "usdJpyChange": 0, "usdCny": 0, "usdCnyChange": 0,
  "oilWTI": 0, "oilChange": 0, "brentOil": 0, "brentOilChange": 0, "natGasChange": 0, "goldPrice": 0, "goldChange": 0, "silverChange": 0, "copperChange": 0, "ironOreChange": 0, "wheatChange": 0, "uraniumChange": 0, "balticDryIndex": 0, "balticDryChange": 0,
  "nikkeiChange": 0, "daxChange": 0, "ftseChange": 0, "shanghaiChange": 0, "hangSengChange": 0, "kospiChange": 0, "emChange": 0, "euroStoxx50Change": 0,
  "highYieldSpread": 0, "spreadChange": 0, "igSpread": 0, "igSpreadChange": 0, "cdsIndex": 0, "tedSpread": 0, "mbs30YrSpread": 0,
  "advanceDeclineRatio": 0, "newHighsNewLows": 0, "percentAbove200DMA": 0, "percentAbove50DMA": 0, "mcclellanOscillator": 0,
  "xlkChange": 0, "xlfChange": 0, "xleChange": 0, "xlvChange": 0, "xlpChange": 0, "xluChange": 0, "xlreChange": 0, "xliChange": 0, "xlbChange": 0, "xlcChange": 0, "xlyChange": 0, "smhChange": 0,
  "aaiiBullBear": 0, "cnnFearGreed": 0, "naaim": 0, "marginDebt": "flat", "etfFlows": "flat",
  "bitcoinChange": 0, "ethereumChange": 0, "btcDominance": 0, "cryptoTotalMarketCapChange": 0,
  "sofr": 0, "repoRate": 0, "fedBalanceSheet": "flat", "tgaBalance": "flat",
  "hasMajorEconData": false, "econDataType": "", "hasEarningsOfNote": false, "earningsNames": "", "isOpexWeek": false, "isOpexDay": false, "isMonthEnd": false, "isQuarterEnd": false, "daysToFOMC": 0, "daysToNextCPI": 0, "daysToNextNFP": 0, "isExDividendHeavy": false,
  "geopoliticalRisk": "low", "geopoliticalEvents": "",
  "spConsecutiveUpDays": 0, "spConsecutiveDownDays": 0, "sp5DayReturn": 0, "sp20DayReturn": 0, "nasdaqVsRussell5d": 0, "sp52WeekRange": 0, "spDistanceFrom200DMA": 0, "spDistanceFrom50DMA": 0
}</json>

Search MULTIPLE times. Cover: futures, VIX, yields, dollar, commodities, international markets, credit, breadth, sectors, sentiment, crypto, liquidity, calendar events, and multi-day context. Accuracy matters — do NOT guess.`,
    messages: [{
      role: "user",
      content: `Gather all global market signals as of the close on ${priorDateStr} (pre-market for ${dateDisplay}). Search thoroughly for each category.`,
    }],
    maxTokens: 6144,
    useWebSearch: true,
  });

  const DEFAULT_SIGNALS: GlobalSignals = {
    spFuturesChange: 0, nasdaqFuturesChange: 0, dowFuturesChange: 0, russellFuturesChange: 0, vixFuturesChange: 0,
    vix: 16, vixChange: 0, vixTermStructure: "contango", vix9d: 0, vix3m: 0, skewIndex: 120, putCallRatio: 0.8, spxGammaExposure: "neutral",
    tenYearYield: 4.0, tenYearYieldChange: 0, twoYearYield: 4.5, twoYearYieldChange: 0, thirtyYearYield: 4.2, threeMonthYield: 5.0, twoTenSpread: -0.5, threeMoTenYrSpread: -1.0, realYield10Y: 1.8, fedFundsRate: 5.25, fedFundsExpected: 5.25,
    dollarIndex: 104, dollarIndexChange: 0, eurUsd: 1.08, eurUsdChange: 0, usdJpy: 150, usdJpyChange: 0, usdCny: 7.2, usdCnyChange: 0,
    oilWTI: 75, oilChange: 0, brentOil: 78, brentOilChange: 0, natGasChange: 0, goldPrice: 2000, goldChange: 0, silverChange: 0, copperChange: 0, ironOreChange: 0, wheatChange: 0, uraniumChange: 0, balticDryIndex: 1500, balticDryChange: 0,
    nikkeiChange: 0, daxChange: 0, ftseChange: 0, shanghaiChange: 0, hangSengChange: 0, kospiChange: 0, emChange: 0, euroStoxx50Change: 0,
    highYieldSpread: 350, spreadChange: 0, igSpread: 100, igSpreadChange: 0, cdsIndex: 60, tedSpread: 0.2, mbs30YrSpread: 150,
    advanceDeclineRatio: 1.0, newHighsNewLows: 0, percentAbove200DMA: 50, percentAbove50DMA: 50, mcclellanOscillator: 0,
    xlkChange: 0, xlfChange: 0, xleChange: 0, xlvChange: 0, xlpChange: 0, xluChange: 0, xlreChange: 0, xliChange: 0, xlbChange: 0, xlcChange: 0, xlyChange: 0, smhChange: 0,
    aaiiBullBear: 0, cnnFearGreed: 50, naaim: 60, marginDebt: "flat", etfFlows: "flat",
    bitcoinChange: 0, ethereumChange: 0, btcDominance: 50, cryptoTotalMarketCapChange: 0,
    sofr: 5.3, repoRate: 5.3, fedBalanceSheet: "flat", tgaBalance: "flat",
    hasMajorEconData: false, econDataType: "", hasEarningsOfNote: false, earningsNames: "", isOpexWeek: false, isOpexDay: false, isMonthEnd: false, isQuarterEnd: false, daysToFOMC: 15, daysToNextCPI: 15, daysToNextNFP: 15, isExDividendHeavy: false,
    geopoliticalRisk: "low", geopoliticalEvents: "",
    spConsecutiveUpDays: 0, spConsecutiveDownDays: 0, sp5DayReturn: 0, sp20DayReturn: 0, nasdaqVsRussell5d: 0, sp52WeekRange: 50, spDistanceFrom200DMA: 0, spDistanceFrom50DMA: 0,
  };

  const parsed = extractJson<Partial<GlobalSignals>>(response.text);
  const signals: GlobalSignals = { ...DEFAULT_SIGNALS, ...(parsed || {}) };

  return {
    signals,
    tokensUsed: response.inputTokens + response.outputTokens,
  };
}

// ---- Phase 3: Daily Briefing ----
async function generateBriefing(
  date: string,
  regimePrompt: string,
  stressIndex: number,
  riskAppetite: number,
): Promise<{ briefing: TrainingBriefing; tokensUsed: number }> {
  const dateDisplay = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const priorDate = new Date(date + "T12:00:00Z");
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  while (priorDate.getUTCDay() === 0 || priorDate.getUTCDay() === 6) priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  const priorDateDisplay = priorDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const response = await callClaude({
    system: `You are SIGNAL, an AI trading intelligence system. Today is ${dateDisplay}. Generate a pre-market morning briefing using ONLY information available before market open.

--- REGIME ASSESSMENT ---
${regimePrompt}
--- END REGIME ---
Stress Index: ${stressIndex}/100 | Risk Appetite: ${riskAppetite}/100

TEMPORAL CONSTRAINT: Only use data from ${priorDateDisplay} and earlier. Do NOT reference anything that happened during or after ${dateDisplay}.

Return JSON in <json> tags:
<json>{
  "summary": "2-3 sentence market overview",
  "marketCondition": "bullish" | "bearish" | "neutral" | "volatile",
  "sections": [
    { "title": "Section Title", "content": "Detailed content", "importance": "high" | "medium" | "low" }
  ],
  "scenarios": [
    { "event": "Event", "scenarios": [{ "condition": "If X", "implication": "Then Y", "trade": "Consider Z" }] }
  ]
}</json>`,
    messages: [{
      role: "user",
      content: `Generate the morning market briefing for ${dateDisplay}. Search for overnight news, futures, economic calendar, earnings, and key developments from ${priorDateDisplay}. Incorporate the regime assessment.`,
    }],
    maxTokens: 4096,
    useWebSearch: true,
  });

  const parsed = extractJson<TrainingBriefing>(response.text);
  const briefing: TrainingBriefing = parsed || {
    summary: "Briefing generation failed — insufficient data.",
    marketCondition: "neutral",
    sections: [],
    scenarios: [],
  };

  return {
    briefing,
    tokensUsed: response.inputTokens + response.outputTokens,
  };
}

// ---- Phase 7: Write App Data ----
function writeAppData(result: TrialResult): void {
  fs.mkdirSync(APP_DATA_DIR, { recursive: true });

  const dateDisplay = new Date(result.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const record: TrainingDayRecord = {
    trialId: result.trialId,
    date: result.date,
    dateDisplay,
    generatedAt: result.generatedAt,
    pipeline: {
      signals: result.signals || {},
      regime: result.regime || { regime: "unknown", confidence: 0, directionalBias: "neutral", volatilityRegime: "normal", stressIndex: 0, riskAppetiteIndex: 0, sectorTilts: {} },
      briefing: result.briefing || { summary: "", marketCondition: "neutral", sections: [], scenarios: [] },
    },
    recommendations: result.recommendations,
    outcomes: result.outcomes,
    scores: result.scores,
    dimensionAnalysis: result.dimensionAnalysis,
    weights: result.weights,
    revisedRecommendations: result.revisedRecommendations,
    opusReviewNotes: result.opusReviewNotes,
  };

  // Write individual trial file
  const trialFile = path.join(APP_DATA_DIR, `day-${result.trialId}-${result.date}.json`);
  fs.writeFileSync(trialFile, JSON.stringify(record, null, 2));

  // Update index
  updateAppIndex(result);
}

function updateAppIndex(result: TrialResult): void {
  const indexPath = path.join(APP_DATA_DIR, "index.json");
  let index: { totalTrials: number; lastUpdated: string; bestScore: number; currentWeights: ConvictionWeights; trials: { trialId: number; date: string; regime: string; score: number; winRate: number; profitFactor: number; numRecs: number; hasOpusReview: boolean }[] };

  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } else {
    index = { totalTrials: 0, lastUpdated: "", bestScore: 0, currentWeights: result.weights, trials: [] };
  }

  // Remove existing entry for this trial (idempotent)
  index.trials = index.trials.filter(t => t.trialId !== result.trialId);
  index.trials.push({
    trialId: result.trialId,
    date: result.date,
    regime: result.regime?.regime || "unknown",
    score: result.scores.totalScore,
    winRate: result.scores.winRate,
    profitFactor: result.scores.profitFactor,
    numRecs: result.recommendations.length,
    hasOpusReview: !!result.opusReviewNotes,
  });
  index.trials.sort((a, b) => a.trialId - b.trialId);
  index.totalTrials = index.trials.length;
  index.lastUpdated = new Date().toISOString();
  index.bestScore = Math.max(index.bestScore, result.scores.totalScore);
  index.currentWeights = result.weights;

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// ---- Opus Algorithm Review ----
// Every 50 trials, Opus reviews all results and suggests improvements
// to the algorithm, weights, threshold, and trading strategy.
async function opusAlgorithmReview(
  state: TrainingState
): Promise<{ insights: string; weightAdjustments?: Record<string, number> }> {
  const withTrades = state.results.filter((r) => r.recommendations.length > 0);
  const noTrades = state.results.filter((r) => r.recommendations.length === 0);
  const avgScore = withTrades.length > 0
    ? withTrades.reduce((s, r) => s + r.scores.totalScore, 0) / withTrades.length : 0;
  const avgWinRate = withTrades.length > 0
    ? withTrades.reduce((s, r) => s + r.scores.winRate, 0) / withTrades.length : 0;
  const avgPF = withTrades.length > 0
    ? withTrades.reduce((s, r) => s + r.scores.profitFactor, 0) / withTrades.length : 0;

  // Build dimension analysis summary
  const dimSummary: Record<string, { avgPredictivePower: number; count: number }> = {};
  for (const r of state.results) {
    for (const [dim, analysis] of Object.entries(r.dimensionAnalysis)) {
      if (!dimSummary[dim]) dimSummary[dim] = { avgPredictivePower: 0, count: 0 };
      dimSummary[dim].avgPredictivePower += analysis.predictivePower;
      dimSummary[dim].count++;
    }
  }
  const dimReport = Object.entries(dimSummary)
    .map(([dim, d]) => `  ${dim}: avg predictive power ${(d.avgPredictivePower / d.count).toFixed(1)}/100 (${d.count} samples)`)
    .join("\n");

  // Best and worst trials
  const sorted = [...withTrades].sort((a, b) => b.scores.totalScore - a.scores.totalScore);
  const best5 = sorted.slice(0, 5).map(r =>
    `  Trial ${r.trialId} (${r.date}): score=${r.scores.totalScore}, win=${r.scores.winRate}%, PF=${r.scores.profitFactor}, trades=${r.recommendations.length} [${r.recommendations.map(rec => `${rec.symbol} ${rec.direction}`).join(", ")}]`
  ).join("\n");
  const worst5 = sorted.slice(-5).map(r =>
    `  Trial ${r.trialId} (${r.date}): score=${r.scores.totalScore}, win=${r.scores.winRate}%, PF=${r.scores.profitFactor}, trades=${r.recommendations.length} [${r.recommendations.map(rec => `${rec.symbol} ${rec.direction}`).join(", ")}]`
  ).join("\n");

  // Common failure patterns
  const stopHits = withTrades.flatMap(r => r.outcomes.filter(o => o.hitStop));
  const avgStopReturn = stopHits.length > 0
    ? stopHits.reduce((s, o) => s + o.actualReturnPercent, 0) / stopHits.length : 0;

  // Build per-trial pipeline summaries for the last 10 trials
  const last10 = state.results.slice(-10);
  const trialSummaries = last10.map(r => {
    const regimeStr = r.regime ? `${r.regime.regime} (${r.regime.confidence}% conf, stress=${r.regime.stressIndex}, appetite=${r.regime.riskAppetiteIndex})` : "N/A";
    const briefStr = r.briefing ? `${r.briefing.marketCondition} — ${r.briefing.summary?.slice(0, 100)}` : "N/A";
    const recsStr = r.recommendations.map(rec => `${rec.symbol} ${rec.direction}`).join(", ") || "No trades";
    const outStr = r.outcomes.map(o => `${o.symbol}: ${o.directionCorrect ? "correct" : "WRONG"} ${o.actualReturnPercent > 0 ? "+" : ""}${o.actualReturnPercent}%`).join(", ") || "N/A";
    return `  Trial ${r.trialId} (${r.date}): regime=${regimeStr} | briefing=${briefStr} | recs=[${recsStr}] | outcomes=[${outStr}] | score=${r.scores.totalScore}`;
  }).join("\n");

  const response = await callClaude({
    system: `You are an elite quantitative trading algorithm reviewer. You are Claude Opus — the most capable model — tasked with reviewing and IMPROVING a conviction-based day trading algorithm after ${state.currentTrial} trials of backtesting.

Your job is NOT to summarize. Your job is to find SPECIFIC, ACTIONABLE improvements to the FULL PIPELINE: signal gathering → regime classification → daily briefing → trade recommendations → outcome scoring.

For each of the last 10 trials, you can see the complete pipeline output. Analyze:
- Did the regime classification match reality? (e.g., classified as "risk-on" but everything sold off)
- Did the briefing identify the right themes that actually moved markets?
- Were trade recommendations aligned with the regime? (e.g., shorting in risk-on)
- Which conviction dimensions actually predicted winners vs losers?

You MUST also provide REVISED trade recommendations for the last 10 trials — what SHOULD have been recommended given the regime context and what we now know about how the algorithm performs.

Return JSON in <json> tags:
<json>{
  "insights": "3-5 paragraphs. Be specific. Name trials, patterns, failure modes.",
  "weightAdjustments": { "catalystClarity": 0.XX, "technicalSetup": 0.XX, "riskReward": 0.XX, "volumeLiquidity": 0.XX, "marketAlignment": 0.XX, "informationEdge": 0.XX, "timingUrgency": 0.XX },
  "thresholdRecommendation": 72,
  "strategyChanges": ["Change 1", "Change 2"],
  "blindSpots": ["Pattern being missed"],
  "pipelineIssues": ["Issue with signals/regime/briefing"],
  "revisedRecommendations": {
    "trialId_here": [{ "symbol": "TICK", "direction": "long", "reasoning": "Why this was better" }]
  }
}</json>`,
    messages: [{
      role: "user",
      content: `FULL PIPELINE REVIEW — ${state.currentTrial} TRIALS COMPLETE

CURRENT WEIGHTS:
${weightsToPrompt(state.weights)}

PERFORMANCE SUMMARY:
- Trials with trades: ${withTrades.length}
- No-trade days: ${noTrades.length} (${((noTrades.length / state.results.length) * 100).toFixed(1)}%)
- Average composite score: ${avgScore.toFixed(1)}/100
- Average win rate: ${avgWinRate.toFixed(1)}%
- Average profit factor: ${avgPF.toFixed(2)}
- Best score: ${state.bestScore}
- Stop-loss hits: ${stopHits.length} total, avg return: ${avgStopReturn.toFixed(2)}%

DIMENSION PREDICTIVE POWER:
${dimReport}

WEIGHT EVOLUTION:
${state.weightHistory.map(w => `  Trial ${w.trial}: score=${w.score} | ${Object.entries(w.weights).map(([k, v]) => `${k.slice(0, 6)}=${(v * 100).toFixed(1)}%`).join(" ")}`).join("\n")}

BEST 5 TRIALS:
${best5}

WORST 5 TRIALS:
${worst5}

LAST 10 TRIALS — FULL PIPELINE OUTPUT:
${trialSummaries}

Review the FULL pipeline. For each of the last 10 trials:
1. Was the regime classification accurate?
2. Did the briefing capture the right market narrative?
3. Were trade recommendations aligned with the regime?
4. What SHOULD have been recommended instead?

Then globally:
5. Which dimensions are predictive vs noise?
6. What blind spots does the algorithm have?
7. What specific pipeline changes would improve the next 10 trials?

Be brutally honest. This algorithm manages real money.`,
    }],
    maxTokens: 6144,
    useWebSearch: false,
    useOpus: true,
  });

  const parsed = extractJson<{
    insights: string;
    weightAdjustments?: Record<string, number>;
    thresholdRecommendation?: number;
    strategyChanges?: string[];
    blindSpots?: string[];
    pipelineIssues?: string[];
    revisedRecommendations?: Record<string, { symbol: string; direction: string; reasoning: string }[]>;
  }>(response.text);

  // Save the full review
  const reviewPath = path.join(__dirname, "results", `opus-review-trial-${state.currentTrial}.json`);
  fs.writeFileSync(reviewPath, JSON.stringify({
    trial: state.currentTrial,
    reviewedAt: new Date().toISOString(),
    tokensUsed: response.inputTokens + response.outputTokens,
    ...parsed,
    rawResponse: response.text,
  }, null, 2));

  log(`  Opus review saved to: ${reviewPath}`);
  if (parsed?.pipelineIssues) {
    log(`  Pipeline issues:`);
    for (const issue of parsed.pipelineIssues) log(`    - ${issue}`);
  }
  if (parsed?.strategyChanges) {
    log(`  Strategy changes recommended:`);
    for (const change of parsed.strategyChanges) log(`    - ${change}`);
  }
  if (parsed?.blindSpots) {
    log(`  Blind spots identified:`);
    for (const spot of parsed.blindSpots) log(`    - ${spot}`);
  }

  // Store Opus review notes on the last 10 trials and update app data
  const insightsText = parsed?.insights || response.text;
  for (const result of last10) {
    result.opusReviewNotes = insightsText;
    // Update the app-visible JSON with review notes
    writeAppData(result);
  }

  return {
    insights: insightsText,
    weightAdjustments: parsed?.weightAdjustments,
  };
}

// ---- Core Training Loop ----
async function generateRecommendations(
  date: string,
  weights: ConvictionWeights,
  regimeContext?: string,
  briefingSummary?: string,
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
${regimeContext ? `
--- REGIME ASSESSMENT (auto-generated) ---
${regimeContext}
--- END REGIME ---
` : ""}${briefingSummary ? `
--- MORNING BRIEFING CONTEXT ---
${briefingSummary}
--- END BRIEFING ---

Use the regime assessment and briefing to inform your trade selection. Recommendations should ALIGN with regime type and directional bias.
` : ""}
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
  log(`\n=== Trial ${trialNum} | ${date} ===`);
  let totalTokens = 0;

  // Phase 1: Signal Gathering
  log(`  Phase 1: Gathering 100+ global signals...`);
  const { signals, tokensUsed: sigTokens } = await generateSignals(date);
  totalTokens += sigTokens;
  const signalCount = Object.values(signals).filter(v => v !== 0 && v !== "" && v !== false && v !== "flat" && v !== "neutral" && v !== "contango" && v !== "low").length;
  log(`  Signals: ${signalCount} non-default fields populated`);

  // Phase 2: Regime Classification (local computation — zero tokens)
  log(`  Phase 2: Classifying regime...`);
  const regimeResult: RegimeAssessment = classifyRegime(signals);
  const stressIndex = computeStressIndex(signals);
  const riskAppetite = computeRiskAppetiteIndex(signals);
  const regimePromptStr = buildRegimePrompt(regimeResult);
  const regime: TrainingRegime = {
    regime: regimeResult.regime,
    confidence: regimeResult.confidence,
    directionalBias: String(regimeResult.directionalBias),
    volatilityRegime: regimeResult.volatilityRegime,
    stressIndex,
    riskAppetiteIndex: riskAppetite,
    sectorTilts: Object.fromEntries(regimeResult.sectorTilts.map(t => [t.sector, t.bias])),
  };
  log(`  Regime: ${regime.regime} (${regime.confidence}%) | Bias: ${regime.directionalBias} | Stress: ${stressIndex} | Risk Appetite: ${riskAppetite}`);

  // Phase 3: Daily Briefing
  log(`  Phase 3: Generating daily briefing...`);
  const { briefing, tokensUsed: briefTokens } = await generateBriefing(date, regimePromptStr, stressIndex, riskAppetite);
  totalTokens += briefTokens;
  log(`  Briefing: ${briefing.marketCondition} | ${briefing.sections.length} sections | ${briefing.scenarios.length} scenarios`);

  // Phase 4: Trade Recommendations (with regime + briefing context)
  log(`  Phase 4: Generating trade recommendations...`);
  const briefingContext = `${briefing.summary}\nMarket condition: ${briefing.marketCondition}\nKey themes: ${briefing.sections.filter(s => s.importance === "high").map(s => s.title).join(", ")}`;
  const { recs, tokensUsed: genTokens } = await generateRecommendations(date, weights, regimePromptStr, briefingContext);
  totalTokens += genTokens;
  log(`  Recommendations: ${recs.length} trades`);

  // Build empty result for no-rec days
  const emptyResult = (extraTokens: number): TrialResult => ({
    trialId: trialNum, date, generatedAt: new Date().toISOString(),
    signals: signals as unknown as Record<string, unknown>,
    regime, briefing, recommendations: [], outcomes: [],
    scores: { directionAccuracy: 0, targetHitRate: 0, stopHitRate: 0, avgReturnPercent: 0, profitFactor: 0, winRate: 0, totalScore: 50 },
    dimensionAnalysis: {}, weights: { ...weights }, totalTokensUsed: totalTokens + extraTokens,
  });

  if (recs.length === 0) {
    log(`  No recommendations — scoring as neutral`);
    const result = emptyResult(0);
    writeAppData(result);
    return result;
  }

  // Phase 5: Anti-Leakage Verification
  log(`  Phase 5: Verifying against data leakage (${recs.length} recs)...`);
  const { cleanRecs, flaggedCount, tokensUsed: verifyTokens } = await verifyRecommendations(date, recs);
  totalTokens += verifyTokens;
  if (flaggedCount > 0) log(`  Filtered ${flaggedCount} trades for leakage → ${cleanRecs.length} clean`);

  const verifiedRecs = cleanRecs.length > 0 ? cleanRecs : [];
  if (verifiedRecs.length === 0) {
    log(`  All recommendations flagged — scoring as neutral`);
    const result = emptyResult(0);
    result.recommendations = recs; // keep originals for analysis
    writeAppData(result);
    return result;
  }

  // Phase 6: Outcome Scoring (Yahoo Finance — deterministic, zero tokens)
  log(`  Phase 6: Scoring against real outcomes (${verifiedRecs.length} trades)...`);
  const { outcomes, tokensUsed: scoreTokens } = await scoreRecommendations(date, verifiedRecs);
  totalTokens += scoreTokens;
  const scores = calculateScores(verifiedRecs, outcomes);
  const dimensionAnalysis = analyzeDimensions(verifiedRecs, outcomes);
  log(`  Score: ${scores.totalScore} | Win: ${scores.winRate}% | Dir: ${scores.directionAccuracy}% | PF: ${scores.profitFactor}`);

  const result: TrialResult = {
    trialId: trialNum, date, generatedAt: new Date().toISOString(),
    signals: signals as unknown as Record<string, unknown>,
    regime, briefing, recommendations: verifiedRecs, outcomes,
    scores, dimensionAnalysis, weights: { ...weights }, totalTokensUsed: totalTokens,
  };

  // Phase 7: Store to App
  log(`  Phase 7: Writing to app data...`);
  writeAppData(result);

  return result;
}

async function main(): Promise<void> {
  // Ensure results directory exists
  const resultsDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  log("=== SIGNAL Conviction Training Engine v2 (full pipeline) ===");
  log(`Target: ${TOTAL_TRIALS} trials`);
  log(`API mode: ${process.env.ANTHROPIC_API_KEY ? "direct" : "proxy"}`);
  log(`Training model: ${process.env.TRAINING_MODEL || "claude-sonnet-4-6"}`);
  log(`Review model: ${process.env.REVIEW_MODEL || "claude-opus-4-6"}`);
  log(`Node: ${process.version}`);

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

        // Opus algorithm review every 10 trials (same cadence as weight optimization)
        {
          log(`\n=== Opus Algorithm Review (trial ${trialNum}) ===`);
          try {
            const reviewResult = await opusAlgorithmReview(state);
            log(`  Review complete. Insights saved.`);
            if (reviewResult.weightAdjustments) {
              log(`  Opus recommended weight adjustments — applying...`);
              for (const [dim, adj] of Object.entries(reviewResult.weightAdjustments)) {
                if (dim in state.weights && typeof adj === "number") {
                  (state.weights as Record<string, number>)[dim] = Math.max(0.05, Math.min(0.35, adj));
                }
              }
              // Re-normalize
              const total = Object.values(state.weights).reduce((s, v) => s + v, 0);
              for (const dim of Object.keys(state.weights)) {
                (state.weights as Record<string, number>)[dim] /= total;
              }
              log(`  Adjusted weights:\n${weightsToPrompt(state.weights)}`);
            }
          } catch (e) {
            log(`  Opus review failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // (Diary commit handled below in the unified commit block)
      }

      // Save after every trial (restart-safe)
      saveState(state);

      // Commit to repo: first trial (to verify it works), then every 10 trials
      const shouldCommit = trialNum === 1 || trialNum % OPTIMIZE_EVERY === 0;
      if (shouldCommit && process.env.CI) {
        try {
          const { execSync } = await import("child_process");
          // Detect current branch dynamically
          const branch = process.env.GITHUB_REF_NAME ||
            execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim() ||
            'main';
          log(`  Committing checkpoint to ${branch}...`);
          execSync(
            `git add training/results/ public/data/training/ 2>/dev/null; ` +
            `git diff --staged --quiet || ` +
            `(git commit -m "Training checkpoint: ${trialNum}/${TOTAL_TRIALS} trials — best: ${state.bestScore}" && ` +
            `git pull origin ${branch} --rebase 2>/dev/null; ` +
            `git push origin HEAD:${branch})`,
            { stdio: "pipe", timeout: 120000 }
          );
          log(`  Checkpoint committed and pushed (trial ${trialNum})`);
        } catch (e) {
          log(`  Checkpoint push failed: ${e instanceof Error ? e.message : String(e)}`);
          log(`  (Will retry next milestone)`);
        }
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`  ERROR on trial ${trialNum}: ${msg}`);
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
