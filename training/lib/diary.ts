// ============================================================
// Training - Diary Logger
// ============================================================
// Generates a human-readable markdown log of every training day.
// Shows: recommendations, actual outcomes, accuracy, learnings.
// Updated after every trial, committed to repo periodically.
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { TrialResult, ConvictionWeights, TrainingState } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIARY_PATH = path.join(__dirname, "..", "results", "training-diary.md");

function pct(n: number): string {
  return n.toFixed(1) + "%";
}

function weightStr(w: ConvictionWeights): string {
  return Object.entries(w)
    .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
    .join(" | ");
}

export function writeDiaryHeader(state: TrainingState): void {
  const header = `# SIGNAL Conviction Training Diary

> Auto-generated training log. Each entry shows one historical trading day:
> what we recommended, what actually happened, how accurate we were, and what we learned.
>
> **Started:** ${state.startedAt}
> **Target:** ${state.totalTrials} trials
> **Initial Weights:** ${weightStr(state.weights)}

---

`;
  fs.writeFileSync(DIARY_PATH, header);
}

export function appendTrialEntry(result: TrialResult, trialNum: number, totalTrials: number): void {
  const dateDisplay = new Date(result.date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let entry = `## Day ${trialNum}/${totalTrials} — ${dateDisplay}\n\n`;

  // Recommendations
  if (result.recommendations.length === 0) {
    entry += `**Recommendations:** None — no setups met the conviction threshold.\n\n`;
    entry += `**Result:** Stayed flat. Sometimes the best trade is no trade.\n\n`;
  } else {
    entry += `### Recommendations (${result.recommendations.length})\n\n`;
    entry += `| Symbol | Direction | Entry | Target | Stop | Conviction | Thesis |\n`;
    entry += `|--------|-----------|-------|--------|------|------------|--------|\n`;

    for (const rec of result.recommendations) {
      const dims = rec.conviction;
      const scores = Object.values(dims).map((d) => d.score);
      const weights = [0.20, 0.15, 0.15, 0.10, 0.15, 0.15, 0.10];
      const weighted = scores.reduce((sum, s, i) => sum + s * weights[i], 0);
      entry += `| ${rec.symbol} | ${rec.direction} | $${rec.entryPrice} | $${rec.targetPrice} | $${rec.stopLoss} | ${weighted.toFixed(0)} | ${rec.thesis.slice(0, 60)}${rec.thesis.length > 60 ? "..." : ""} |\n`;
    }
    entry += "\n";

    // Outcomes
    if (result.outcomes.length > 0) {
      entry += `### Actual Outcomes\n\n`;
      entry += `| Symbol | Open | High | Low | Close | Direction | Target Hit | Stop Hit | Return |\n`;
      entry += `|--------|------|------|-----|-------|-----------|------------|----------|--------|\n`;

      for (const out of result.outcomes) {
        const dirIcon = out.directionCorrect ? "Correct" : "Wrong";
        const targetIcon = out.hitTarget ? "Yes" : "No";
        const stopIcon = out.hitStop ? "Yes" : "No";
        const retColor = out.actualReturnPercent >= 0 ? "+" : "";
        entry += `| ${out.symbol} | $${out.openPrice} | $${out.highPrice} | $${out.lowPrice} | $${out.closePrice} | ${dirIcon} | ${targetIcon} | ${stopIcon} | ${retColor}${out.actualReturnPercent}% |\n`;
      }
      entry += "\n";

      // Per-trade notes
      for (const out of result.outcomes) {
        if (out.notes && out.notes !== "data unavailable") {
          entry += `- **${out.symbol}:** ${out.notes}\n`;
        }
      }
      entry += "\n";
    }
  }

  // Accuracy
  entry += `### Accuracy\n\n`;
  entry += `| Metric | Value |\n`;
  entry += `|--------|-------|\n`;
  entry += `| Direction Accuracy | ${pct(result.scores.directionAccuracy)} |\n`;
  entry += `| Target Hit Rate | ${pct(result.scores.targetHitRate)} |\n`;
  entry += `| Stop Hit Rate | ${pct(result.scores.stopHitRate)} |\n`;
  entry += `| Win Rate | ${pct(result.scores.winRate)} |\n`;
  entry += `| Avg Return | ${result.scores.avgReturnPercent >= 0 ? "+" : ""}${result.scores.avgReturnPercent}% |\n`;
  entry += `| Profit Factor | ${result.scores.profitFactor} |\n`;
  entry += `| **Composite Score** | **${result.scores.totalScore}/100** |\n`;
  entry += "\n";

  // Dimension analysis (what predicted winners vs losers)
  if (Object.keys(result.dimensionAnalysis).length > 0) {
    entry += `### Dimension Analysis\n\n`;
    entry += `| Dimension | Avg (Winners) | Avg (Losers) | Predictive Power |\n`;
    entry += `|-----------|---------------|--------------|------------------|\n`;
    for (const [dim, analysis] of Object.entries(result.dimensionAnalysis)) {
      const pp = analysis.predictivePower;
      const indicator = pp > 60 ? " (strong)" : pp > 55 ? " (moderate)" : pp < 45 ? " (inverse!)" : "";
      entry += `| ${dim} | ${analysis.avgScoreWinners} | ${analysis.avgScoreLosers} | ${pp}${indicator} |\n`;
    }
    entry += "\n";
  }

  entry += `*Weights used: ${weightStr(result.weights)}*\n\n`;
  entry += `---\n\n`;

  fs.appendFileSync(DIARY_PATH, entry);
}

export function appendMilestoneSummary(
  trialNum: number,
  state: TrainingState,
  oldWeights: ConvictionWeights,
  newWeights: ConvictionWeights
): void {
  const last10 = state.results.slice(-10);
  const withTrades = last10.filter((r) => r.recommendations.length > 0);

  let summary = `# ========== MILESTONE: ${trialNum} TRIALS COMPLETE ==========\n\n`;

  // Rolling performance
  if (withTrades.length > 0) {
    const avgScore = withTrades.reduce((s, r) => s + r.scores.totalScore, 0) / withTrades.length;
    const avgWin = withTrades.reduce((s, r) => s + r.scores.winRate, 0) / withTrades.length;
    const avgPF = withTrades.reduce((s, r) => s + r.scores.profitFactor, 0) / withTrades.length;
    const avgDir = withTrades.reduce((s, r) => s + r.scores.directionAccuracy, 0) / withTrades.length;
    const avgRet = withTrades.reduce((s, r) => s + r.scores.avgReturnPercent, 0) / withTrades.length;
    const noTradeDays = last10.filter((r) => r.recommendations.length === 0).length;

    summary += `### Last 10 Trials Performance\n\n`;
    summary += `| Metric | Value |\n`;
    summary += `|--------|-------|\n`;
    summary += `| Avg Composite Score | ${avgScore.toFixed(1)}/100 |\n`;
    summary += `| Avg Win Rate | ${pct(avgWin)} |\n`;
    summary += `| Avg Direction Accuracy | ${pct(avgDir)} |\n`;
    summary += `| Avg Profit Factor | ${avgPF.toFixed(2)} |\n`;
    summary += `| Avg Return per Trade | ${avgRet >= 0 ? "+" : ""}${avgRet.toFixed(2)}% |\n`;
    summary += `| No-Trade Days | ${noTradeDays}/10 |\n`;
    summary += `| Best Score (all time) | ${state.bestScore}/100 |\n\n`;
  }

  // Overall stats
  const allWithTrades = state.results.filter((r) => r.recommendations.length > 0);
  if (allWithTrades.length > 0) {
    const overallAvg = allWithTrades.reduce((s, r) => s + r.scores.totalScore, 0) / allWithTrades.length;
    summary += `### Overall (${state.currentTrial} trials, ${allWithTrades.length} with trades)\n\n`;
    summary += `- Overall avg composite: ${overallAvg.toFixed(1)}/100\n`;
    summary += `- Total tokens used: ${state.totalTokensUsed.toLocaleString()}\n\n`;
  }

  // Weight changes
  summary += `### Learnings & Weight Changes\n\n`;
  const dims = Object.keys(oldWeights) as (keyof ConvictionWeights)[];
  let hasChanges = false;
  for (const dim of dims) {
    const diff = newWeights[dim] - oldWeights[dim];
    if (Math.abs(diff) > 0.005) {
      hasChanges = true;
      const arrow = diff > 0 ? "INCREASED" : "DECREASED";
      const reason = getWeightChangeReason(dim, state.results.slice(-10));
      summary += `- **${dim}**: ${(oldWeights[dim] * 100).toFixed(1)}% → ${(newWeights[dim] * 100).toFixed(1)}% (${arrow})\n`;
      summary += `  - *${reason}*\n`;
    }
  }
  if (!hasChanges) {
    summary += `- No significant weight changes this round.\n`;
  }

  summary += `\n**New weights:** ${weightStr(newWeights)}\n\n`;
  summary += `---\n\n`;

  fs.appendFileSync(DIARY_PATH, summary);
}

function getWeightChangeReason(dim: string, recentResults: TrialResult[]): string {
  const analyses = recentResults
    .filter((r) => r.dimensionAnalysis[dim])
    .map((r) => r.dimensionAnalysis[dim]);

  if (analyses.length === 0) return "Insufficient data";

  const avgPP = analyses.reduce((s, a) => s + a.predictivePower, 0) / analyses.length;
  const avgWinScore = analyses.reduce((s, a) => s + a.avgScoreWinners, 0) / analyses.length;
  const avgLoseScore = analyses.reduce((s, a) => s + a.avgScoreLosers, 0) / analyses.length;
  const spread = avgWinScore - avgLoseScore;

  if (avgPP > 60) {
    return `Strong predictor: winners scored ${avgWinScore.toFixed(0)} vs losers ${avgLoseScore.toFixed(0)} (spread: +${spread.toFixed(0)})`;
  } else if (avgPP > 50) {
    return `Moderate predictor: winners scored ${avgWinScore.toFixed(0)} vs losers ${avgLoseScore.toFixed(0)}`;
  } else if (avgPP < 40) {
    return `Inverse signal: losers actually scored higher (${avgLoseScore.toFixed(0)}) than winners (${avgWinScore.toFixed(0)}) — reducing weight`;
  } else {
    return `Weak/neutral signal: minimal spread between winners and losers`;
  }
}
