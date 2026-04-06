#!/usr/bin/env npx tsx
// ============================================================
// SIGNAL - Post-Market Accuracy Scoring Pipeline
// ============================================================
// Runs after market close (5:00 PM ET) to score the morning's
// recommendations against actual price data from Yahoo Finance.
//
// Closes the feedback loop:
//   Morning briefing (predictions) → Market close → Score accuracy
//
// Usage: npx tsx scripts/score-accuracy.ts [YYYY-MM-DD]
// ============================================================

import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import { classifyRegime, type GlobalSignals } from "../src/lib/market-regime";
import { fetchHistoricalSignals } from "../training/lib/yahoo-signals";
import { calculateCompositeScore } from "../training/lib/scorer-v2";
import { loadHistory, saveHistory, addRecommendations, scoreRecommendations } from "./lib/recommendation-tracker";

const DATA_DIR = join(process.cwd(), "public", "data");

// --- TypeScript Interfaces ---

interface TradeOutcome {
  symbol: string;
  direction: "long" | "short";
  predictedEntry: number;
  predictedTarget: number;
  predictedStop: number;
  convictionScore: number;
  actualOpen: number;
  actualHigh: number;
  actualLow: number;
  actualClose: number;
  entryAchievable: boolean;
  hitTarget: boolean;
  hitStop: boolean;
  directionCorrect: boolean;
  returnPercent: number;
}

interface DailyAccuracy {
  date: string;
  scoredAt: string;
  regime: {
    predicted: string;
    actual: string;
    correct: boolean;
    predictedBias: number;
    actualBias: number;
    biasError: number;
  };
  recommendations: TradeOutcome[];
  summary: {
    totalRecs: number;
    directionCorrect: number;
    targetsHit: number;
    stopsHit: number;
    avgReturn: number;
    bestTrade: { symbol: string; return: number } | null;
    worstTrade: { symbol: string; return: number } | null;
  };
  compositeScore: number;
  spyReturn: number;
  alpha: number;
}

interface RollingStats {
  days: number;
  avgCompositeScore: number;
  avgDirectionAccuracy: number;
  avgTargetHitRate: number;
  avgReturn: number;
  avgAlpha: number;
  regimeAccuracy: number;
  bestDay: { date: string; score: number } | null;
  worstDay: { date: string; score: number } | null;
}

interface AccuracySummary {
  lastUpdated: string;
  totalDaysScored: number;
  rolling5: RollingStats;
  rolling20: RollingStats;
  allTime: RollingStats;
}

// --- Yahoo Finance Setup ---

let yfModule: any = null;

async function getYF(): Promise<any> {
  if (yfModule) return yfModule;
  const mod = await import("yahoo-finance2");
  const YF = mod.default;
  yfModule = typeof YF === "function" ? new YF() : YF;
  return yfModule;
}

interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

async function fetchOHLC(symbol: string, date: string): Promise<OHLC | null> {
  try {
    const yf = await getYF();
    const target = new Date(date + "T12:00:00Z");
    const start = new Date(target);
    start.setUTCDate(start.getUTCDate() - 3);
    const end = new Date(target);
    end.setUTCDate(end.getUTCDate() + 3);

    const result = await yf.chart(symbol, {
      period1: start.toISOString().split("T")[0],
      period2: end.toISOString().split("T")[0],
      interval: "1d",
    });

    if (!result.quotes || result.quotes.length === 0) return null;

    // Find the quote closest to the target date
    const targetTime = target.getTime();
    let best = result.quotes[0];
    let bestDiff = Infinity;

    for (const q of result.quotes) {
      const diff = Math.abs(new Date(q.date).getTime() - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = q;
      }
    }

    if (bestDiff > 2 * 24 * 60 * 60 * 1000) return null;
    if (best.open == null || best.close == null) return null;

    return {
      open: round2(best.open),
      high: round2(best.high),
      low: round2(best.low),
      close: round2(best.close),
    };
  } catch (err) {
    console.error(`  Failed to fetch OHLC for ${symbol}: ${err}`);
    return null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Helpers ---

function writeData(filename: string, data: unknown): void {
  const filepath = join(DATA_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`  Wrote ${filepath}`);
}

function loadExistingAccuracyDays(): DailyAccuracy[] {
  try {
    const files = readdirSync(DATA_DIR)
      .filter(f => f.startsWith("accuracy-") && f !== "accuracy-summary.json" && f.endsWith(".json"))
      .sort();

    return files.map(f => {
      const content = readFileSync(join(DATA_DIR, f), "utf-8");
      return JSON.parse(content) as DailyAccuracy;
    });
  } catch {
    return [];
  }
}

function computeRollingStats(days: DailyAccuracy[]): RollingStats {
  if (days.length === 0) {
    return {
      days: 0,
      avgCompositeScore: 50,
      avgDirectionAccuracy: 0,
      avgTargetHitRate: 0,
      avgReturn: 0,
      avgAlpha: 0,
      regimeAccuracy: 0,
      bestDay: null,
      worstDay: null,
    };
  }

  const n = days.length;
  const avgComposite = days.reduce((s, d) => s + d.compositeScore, 0) / n;

  // Direction accuracy: across all days, total correct / total recs
  const totalRecs = days.reduce((s, d) => s + d.summary.totalRecs, 0);
  const totalDirCorrect = days.reduce((s, d) => s + d.summary.directionCorrect, 0);
  const totalTargetsHit = days.reduce((s, d) => s + d.summary.targetsHit, 0);
  const avgDirAccuracy = totalRecs > 0 ? (totalDirCorrect / totalRecs) * 100 : 0;
  const avgTargetHitRate = totalRecs > 0 ? (totalTargetsHit / totalRecs) * 100 : 0;

  const avgReturn = days.reduce((s, d) => s + d.summary.avgReturn, 0) / n;
  const avgAlpha = days.reduce((s, d) => s + d.alpha, 0) / n;
  const regimeCorrect = days.filter(d => d.regime.correct).length;
  const regimeAccuracy = (regimeCorrect / n) * 100;

  let bestDay: { date: string; score: number } | null = null;
  let worstDay: { date: string; score: number } | null = null;

  for (const d of days) {
    if (!bestDay || d.compositeScore > bestDay.score) {
      bestDay = { date: d.date, score: d.compositeScore };
    }
    if (!worstDay || d.compositeScore < worstDay.score) {
      worstDay = { date: d.date, score: d.compositeScore };
    }
  }

  return {
    days: n,
    avgCompositeScore: round2(avgComposite),
    avgDirectionAccuracy: round2(avgDirAccuracy),
    avgTargetHitRate: round2(avgTargetHitRate),
    avgReturn: round2(avgReturn),
    avgAlpha: round2(avgAlpha),
    regimeAccuracy: round2(regimeAccuracy),
    bestDay,
    worstDay,
  };
}

// --- Main ---

async function main() {
  const dateArg = process.argv[2];
  const dateKey = dateArg || new Date().toISOString().split("T")[0];

  mkdirSync(DATA_DIR, { recursive: true });

  console.log(`\n========================================`);
  console.log(`  SIGNAL Post-Market Accuracy Scoring`);
  console.log(`========================================`);
  console.log(`Date: ${dateKey}`);
  console.log(`Output: ${DATA_DIR}\n`);

  // Step 1: Read today's briefing
  const briefingPath = join(DATA_DIR, `briefing-${dateKey}.json`);
  if (!existsSync(briefingPath)) {
    console.log(`No briefing found for ${dateKey} — nothing to score. Exiting.`);
    process.exit(0);
  }

  const briefing = JSON.parse(readFileSync(briefingPath, "utf-8"));
  const recs: any[] = briefing.recommendations || [];

  if (recs.length === 0) {
    console.log(`Briefing for ${dateKey} has 0 recommendations — scoring as neutral.`);
  } else {
    console.log(`Found ${recs.length} recommendations to score.`);
  }

  // Step 2: Read today's regime assessment
  const regimePath = join(DATA_DIR, `regime-${dateKey}.json`);
  let predictedRegime = "unknown";
  let predictedBias = 0;
  if (existsSync(regimePath)) {
    const regimeData = JSON.parse(readFileSync(regimePath, "utf-8"));
    predictedRegime = regimeData.regime || "unknown";
    predictedBias = regimeData.directionalBias || 0;
    console.log(`Predicted regime: ${predictedRegime} (bias: ${predictedBias})`);
  }

  // Step 3: Score each recommendation against actual prices
  console.log(`\n--- Scoring Recommendations ---`);
  const outcomes: TradeOutcome[] = [];

  for (const rec of recs) {
    const symbol = rec.ticker;
    const direction: "long" | "short" = rec.direction === "short" ? "short" : "long";
    const entryPrice = rec.entryPrice || 0;
    const targetPrice = rec.targetPrice || 0;
    const stopPrice = rec.stopPrice || 0;
    const convictionScore = rec.compositeScore || 0;

    console.log(`  ${symbol} (${direction}): entry=$${entryPrice} target=$${targetPrice} stop=$${stopPrice}`);

    const ohlc = await fetchOHLC(symbol, dateKey);
    if (!ohlc) {
      console.log(`    No price data — skipping`);
      outcomes.push({
        symbol,
        direction,
        predictedEntry: entryPrice,
        predictedTarget: targetPrice,
        predictedStop: stopPrice,
        convictionScore,
        actualOpen: 0,
        actualHigh: 0,
        actualLow: 0,
        actualClose: 0,
        entryAchievable: false,
        hitTarget: false,
        hitStop: false,
        directionCorrect: false,
        returnPercent: 0,
      });
      continue;
    }

    // Entry achievable: open within 2% of predicted entry
    const entryDiff = Math.abs(ohlc.open - entryPrice) / entryPrice;
    const entryAchievable = entryDiff <= 0.02;

    // Target hit: high >= target for longs, low <= target for shorts
    const hitTarget = direction === "long"
      ? ohlc.high >= targetPrice
      : ohlc.low <= targetPrice;

    // Stop hit: low <= stop for longs, high >= stop for shorts
    const hitStop = direction === "long"
      ? ohlc.low <= stopPrice
      : ohlc.high >= stopPrice;

    // Direction correct: close vs open
    const directionCorrect = direction === "long"
      ? ohlc.close > ohlc.open
      : ohlc.close < ohlc.open;

    // Actual return: (close - open) / open * 100, adjusted for direction
    const dirSign = direction === "long" ? 1 : -1;
    const returnPercent = round2(((ohlc.close - ohlc.open) / ohlc.open) * 100 * dirSign);

    console.log(`    O=${ohlc.open} H=${ohlc.high} L=${ohlc.low} C=${ohlc.close} | entry=${entryAchievable} target=${hitTarget} stop=${hitStop} dir=${directionCorrect} ret=${returnPercent}%`);

    outcomes.push({
      symbol,
      direction,
      predictedEntry: entryPrice,
      predictedTarget: targetPrice,
      predictedStop: stopPrice,
      convictionScore,
      actualOpen: ohlc.open,
      actualHigh: ohlc.high,
      actualLow: ohlc.low,
      actualClose: ohlc.close,
      entryAchievable,
      hitTarget,
      hitStop,
      directionCorrect,
      returnPercent,
    });
  }

  // Step 4: Score regime prediction
  console.log(`\n--- Scoring Regime ---`);
  let actualRegime = "unknown";
  let actualBias = 0;

  try {
    const { signals } = await fetchHistoricalSignals(dateKey);
    const regimeResult = classifyRegime(signals);
    actualRegime = regimeResult.regime;
    actualBias = regimeResult.directionalBias;
    console.log(`  Actual regime: ${actualRegime} (bias: ${actualBias})`);
  } catch (err) {
    console.error(`  Failed to fetch EOD signals for regime scoring: ${err}`);
  }

  const regimeCorrect = predictedRegime === actualRegime;
  const biasError = round2(Math.abs(predictedBias - actualBias));
  console.log(`  Regime match: ${regimeCorrect ? "CORRECT" : "WRONG"} (predicted: ${predictedRegime}, actual: ${actualRegime})`);
  console.log(`  Bias error: ${biasError} (predicted: ${predictedBias}, actual: ${actualBias})`);

  // Step 5: Fetch SPY return as benchmark
  console.log(`\n--- Benchmark ---`);
  let spyReturn = 0;
  const spyOhlc = await fetchOHLC("SPY", dateKey);
  if (spyOhlc) {
    spyReturn = round2(((spyOhlc.close - spyOhlc.open) / spyOhlc.open) * 100);
    console.log(`  SPY return: ${spyReturn}%`);
  } else {
    console.log(`  Could not fetch SPY data`);
  }

  // Step 6: Compute summary stats
  const validOutcomes = outcomes.filter(o => o.actualOpen > 0);
  const totalRecs = outcomes.length;
  const directionCorrectCount = validOutcomes.filter(o => o.directionCorrect).length;
  const targetsHit = validOutcomes.filter(o => o.hitTarget).length;
  const stopsHit = validOutcomes.filter(o => o.hitStop).length;
  const avgReturn = validOutcomes.length > 0
    ? round2(validOutcomes.reduce((s, o) => s + o.returnPercent, 0) / validOutcomes.length)
    : 0;

  let bestTrade: { symbol: string; return: number } | null = null;
  let worstTrade: { symbol: string; return: number } | null = null;
  for (const o of validOutcomes) {
    if (!bestTrade || o.returnPercent > bestTrade.return) {
      bestTrade = { symbol: o.symbol, return: o.returnPercent };
    }
    if (!worstTrade || o.returnPercent < worstTrade.return) {
      worstTrade = { symbol: o.symbol, return: o.returnPercent };
    }
  }

  // Step 7: Compute composite score using v2 scorer
  let compositeScore = 50; // Default for zero-rec days
  if (validOutcomes.length > 0) {
    const n = validOutcomes.length;
    const dirAccuracy = (directionCorrectCount / n) * 100;
    const targetHitRate = (targetsHit / n) * 100;
    const stopHitRate = (stopsHit / n) * 100;
    const wins = validOutcomes.filter(o => o.returnPercent > 0).length;
    const winRate = (wins / n) * 100;
    const grossProfit = validOutcomes.filter(o => o.returnPercent > 0).reduce((s, o) => s + o.returnPercent, 0);
    const grossLoss = Math.abs(validOutcomes.filter(o => o.returnPercent < 0).reduce((s, o) => s + o.returnPercent, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 0;

    compositeScore = calculateCompositeScore({
      directionAccuracy: dirAccuracy,
      targetHitRate,
      stopHitRate,
      avgReturnPercent: avgReturn,
      profitFactor,
      winRate,
    });
  }

  const alpha = round2(avgReturn - spyReturn);

  // Step 8: Build and write daily accuracy
  const dailyAccuracy: DailyAccuracy = {
    date: dateKey,
    scoredAt: new Date().toISOString(),
    regime: {
      predicted: predictedRegime,
      actual: actualRegime,
      correct: regimeCorrect,
      predictedBias,
      actualBias,
      biasError,
    },
    recommendations: outcomes,
    summary: {
      totalRecs,
      directionCorrect: directionCorrectCount,
      targetsHit,
      stopsHit,
      avgReturn,
      bestTrade,
      worstTrade,
    },
    compositeScore,
    spyReturn,
    alpha,
  };

  writeData(`accuracy-${dateKey}.json`, dailyAccuracy);

  // Update recommendation history
  let recHistory = loadHistory();
  // Score the recommendations in the history (they may have been added by the morning pipeline)
  if (outcomes.length > 0) {
    recHistory = scoreRecommendations(recHistory, dateKey, outcomes.map(o => ({
      symbol: o.symbol,
      actualOpen: o.actualOpen,
      actualClose: o.actualClose,
      actualReturn: o.returnPercent,
      hitTarget: o.hitTarget,
      hitStop: o.hitStop,
      directionCorrect: o.directionCorrect,
    })));
    saveHistory(recHistory);
    console.log(`  Updated recommendation history: ${recHistory.totalRecords} total records`);
  }

  // Step 9: Update rolling summary
  console.log(`\n--- Rolling Summary ---`);
  const allDays = loadExistingAccuracyDays();
  // Ensure today's data is included (replace if already present)
  const filteredDays = allDays.filter(d => d.date !== dateKey);
  filteredDays.push(dailyAccuracy);
  filteredDays.sort((a, b) => a.date.localeCompare(b.date));

  const last5 = filteredDays.slice(-5);
  const last20 = filteredDays.slice(-20);

  const summary: AccuracySummary = {
    lastUpdated: new Date().toISOString(),
    totalDaysScored: filteredDays.length,
    rolling5: computeRollingStats(last5),
    rolling20: computeRollingStats(last20),
    allTime: computeRollingStats(filteredDays),
  };

  writeData("accuracy-summary.json", summary);

  // Final report
  console.log(`\n========================================`);
  console.log(`  SCORING COMPLETE`);
  console.log(`========================================`);
  console.log(`  Date: ${dateKey}`);
  console.log(`  Recommendations scored: ${totalRecs} (${validOutcomes.length} with price data)`);
  console.log(`  Direction correct: ${directionCorrectCount}/${validOutcomes.length}`);
  console.log(`  Targets hit: ${targetsHit}/${validOutcomes.length}`);
  console.log(`  Stops hit: ${stopsHit}/${validOutcomes.length}`);
  console.log(`  Avg return: ${avgReturn}%`);
  console.log(`  SPY return: ${spyReturn}%`);
  console.log(`  Alpha: ${alpha}%`);
  console.log(`  Composite score: ${compositeScore}/100`);
  console.log(`  Regime: ${regimeCorrect ? "CORRECT" : "WRONG"} (${predictedRegime} → ${actualRegime})`);
  console.log(`  Total days scored: ${filteredDays.length}`);
  if (bestTrade) console.log(`  Best trade: ${bestTrade.symbol} (+${bestTrade.return}%)`);
  if (worstTrade) console.log(`  Worst trade: ${worstTrade.symbol} (${worstTrade.return}%)`);
  console.log();
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message || err}`);
  process.exit(1);
});
