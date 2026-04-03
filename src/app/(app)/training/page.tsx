"use client";

import { useState, useEffect } from "react";
import Card from "@/components/Card";

/* ---------- types ---------- */

interface TrialSummary {
  trialId: number;
  date: string;
  regime: string;
  score: number;
  winRate: number;
  profitFactor: number;
  numRecs: number;
  hasOpusReview: boolean;
}

interface TrainingIndex {
  totalTrials: number;
  lastUpdated: string;
  bestScore: number;
  currentWeights: Record<string, number>;
  trials: TrialSummary[];
}

interface Recommendation {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  thesis: string;
  catalyst: string;
  conviction: Record<string, { score: number; reasoning: string }>;
}

interface Outcome {
  symbol: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  hitTarget: boolean;
  hitStop: boolean;
  directionCorrect: boolean;
  actualReturnPercent: number;
  notes: string;
}

interface TrialDetail {
  trialId: number;
  date: string;
  dateDisplay: string;
  generatedAt: string;
  pipeline: {
    signals: Record<string, unknown>;
    regime: {
      regime: string;
      confidence: number;
      directionalBias: string;
      volatilityRegime: string;
      stressIndex: number;
      riskAppetiteIndex: number;
      sectorTilts: Record<string, string>;
    };
    briefing: {
      summary: string;
      marketCondition: "bullish" | "bearish" | "neutral" | "volatile";
      sections: { title: string; content: string; importance: string }[];
      scenarios: { event: string; scenarios: { condition: string; implication: string; trade: string }[] }[];
    };
  };
  recommendations: Recommendation[];
  outcomes: Outcome[];
  scores: {
    directionAccuracy: number;
    targetHitRate: number;
    stopHitRate: number;
    avgReturnPercent: number;
    profitFactor: number;
    winRate: number;
    totalScore: number;
  };
  dimensionAnalysis: Record<string, { avgScoreWinners: number; avgScoreLosers: number; predictivePower: number }>;
  weights: Record<string, number>;
  revisedRecommendations?: Recommendation[];
  opusReviewNotes?: string;
  opusReviewTrial?: number;
}

/* ---------- helpers ---------- */

function scoreColor(score: number): string {
  if (score >= 70) return "text-ios-green";
  if (score >= 50) return "text-ios-orange";
  return "text-ios-red";
}

function pctColor(value: number): string {
  if (value > 0) return "text-ios-green";
  if (value < 0) return "text-ios-red";
  return "text-ios-gray";
}

function regimeBadge(regime: string): string {
  switch (regime) {
    case "risk-on":
      return "bg-ios-green/20 text-ios-green";
    case "risk-off":
      return "bg-ios-red/20 text-ios-red";
    case "crisis":
      return "bg-ios-red/30 text-ios-red";
    case "event-driven":
      return "bg-ios-orange/20 text-ios-orange";
    default:
      return "bg-ios-gray/20 text-ios-gray";
  }
}

/* ---------- component ---------- */

export default function TrainingPage() {
  const [index, setIndex] = useState<TrainingIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedTrial, setExpandedTrial] = useState<number | null>(null);
  const [trialDetail, setTrialDetail] = useState<TrialDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    loadIndex();
  }, []);

  const loadIndex = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/training");
      const data = await res.json();
      if (data.error) {
        setError(null); // empty state
      } else {
        setIndex(data as TrainingIndex);
      }
    } catch {
      setError("Failed to load training data.");
    } finally {
      setLoading(false);
    }
  };

  const loadTrialDetail = async (trialId: number) => {
    if (expandedTrial === trialId) {
      setExpandedTrial(null);
      setTrialDetail(null);
      return;
    }
    setExpandedTrial(trialId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/training?id=${trialId}`);
      const data = await res.json();
      if (data.error) {
        setError(`Failed to load trial ${trialId}`);
      } else {
        setTrialDetail(data as TrialDetail);
      }
    } catch {
      setError(`Failed to load trial ${trialId}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const avgScore =
    index && index.trials.length > 0
      ? index.trials.reduce((s, t) => s + t.score, 0) / index.trials.length
      : 0;

  return (
    <div className="px-4 pt-14 pb-28">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Training History</h1>
          <p className="text-sm text-ios-gray mt-1">
            Model training trials &amp; weight evolution
          </p>
        </div>
        <button
          onClick={loadIndex}
          disabled={loading}
          className="text-ios-blue text-sm font-medium disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <Card className="mb-4">
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-2 border-ios-blue/30 border-t-ios-blue rounded-full animate-spin" />
            <span className="ml-3 text-sm text-ios-gray">Loading training data...</span>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="mb-4 border border-ios-red/30">
          <p className="text-ios-red text-sm">{error}</p>
        </Card>
      )}

      {/* Summary Dashboard */}
      {index && !loading && (
        <>
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">
              Dashboard
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-ios-elevated rounded-lg p-3 text-center">
                <p className="text-[10px] text-ios-gray mb-0.5">Trials</p>
                <p className="text-xl font-bold">{index.totalTrials}</p>
              </div>
              <div className="bg-ios-elevated rounded-lg p-3 text-center">
                <p className="text-[10px] text-ios-gray mb-0.5">Avg Score</p>
                <p className={`text-xl font-bold ${scoreColor(avgScore)}`}>
                  {avgScore.toFixed(1)}
                </p>
              </div>
              <div className="bg-ios-elevated rounded-lg p-3 text-center">
                <p className="text-[10px] text-ios-gray mb-0.5">Best Score</p>
                <p className={`text-xl font-bold ${scoreColor(index.bestScore)}`}>
                  {index.bestScore.toFixed(1)}
                </p>
              </div>
            </div>

            {/* Current Weights */}
            {index.currentWeights && Object.keys(index.currentWeights).length > 0 && (
              <div>
                <p className="text-[11px] text-ios-gray uppercase tracking-wider mb-2">
                  Current Weights
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(index.currentWeights)
                    .sort(([, a], [, b]) => b - a)
                    .map(([dim, weight]) => (
                      <span
                        key={dim}
                        className="text-[10px] px-2 py-1 rounded bg-ios-elevated text-white/80"
                      >
                        {dim}: <span className="font-semibold">{(weight * 100).toFixed(0)}%</span>
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Weight Evolution (text-based chart) */}
            {index.trials.length > 1 && (
              <div className="mt-4">
                <p className="text-[11px] text-ios-gray uppercase tracking-wider mb-2">
                  Score Evolution
                </p>
                <div className="flex items-end gap-1 h-16">
                  {index.trials
                    .slice()
                    .sort((a, b) => a.trialId - b.trialId)
                    .map((t) => {
                      const height = Math.max(4, (t.score / 100) * 64);
                      return (
                        <div
                          key={t.trialId}
                          className="flex-1 min-w-[4px] max-w-[20px] rounded-t"
                          style={{ height: `${height}px` }}
                          title={`Trial ${t.trialId}: ${t.score.toFixed(1)}`}
                        >
                          <div
                            className={`w-full h-full rounded-t ${
                              t.score >= 70
                                ? "bg-ios-green"
                                : t.score >= 50
                                ? "bg-ios-orange"
                                : "bg-ios-red"
                            }`}
                          />
                        </div>
                      );
                    })}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-ios-gray">
                    Trial {index.trials[index.trials.length - 1]?.trialId ?? ""}
                  </span>
                  <span className="text-[9px] text-ios-gray">
                    Trial {index.trials[0]?.trialId ?? ""}
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Trial List */}
          <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
            All Trials
          </h2>
          <div className="space-y-3">
            {index.trials.map((trial) => (
              <div key={trial.trialId}>
                <Card
                  onClick={() => loadTrialDetail(trial.trialId)}
                  className="cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        Trial {trial.trialId}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${regimeBadge(
                          trial.regime
                        )}`}
                      >
                        {trial.regime.toUpperCase()}
                      </span>
                      {trial.hasOpusReview && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ios-blue/20 text-ios-blue">
                          OPUS
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-lg font-bold ${scoreColor(trial.score)}`}>
                        {trial.score.toFixed(1)}
                      </span>
                      <svg
                        className={`w-4 h-4 text-ios-gray transition-transform ${
                          expandedTrial === trial.trialId ? "rotate-180" : ""
                        }`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-white/60">
                    <span>{trial.date}</span>
                    <span>{trial.numRecs} recs</span>
                    <span>WR {(trial.winRate * 100).toFixed(0)}%</span>
                    <span>PF {trial.profitFactor.toFixed(2)}</span>
                  </div>
                </Card>

                {/* Expanded Detail */}
                {expandedTrial === trial.trialId && (
                  <div className="mt-2 space-y-3">
                    {loadingDetail && (
                      <Card>
                        <div className="flex items-center justify-center py-4">
                          <div className="w-6 h-6 border-2 border-ios-blue/30 border-t-ios-blue rounded-full animate-spin" />
                          <span className="ml-2 text-sm text-ios-gray">Loading trial...</span>
                        </div>
                      </Card>
                    )}

                    {trialDetail && trialDetail.trialId === trial.trialId && (
                      <>
                        {/* Scores */}
                        <Card>
                          <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">
                            Scores
                          </h3>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-ios-elevated rounded-lg p-2 text-center">
                              <p className="text-[10px] text-ios-gray mb-0.5">Direction</p>
                              <p className={`text-sm font-bold ${scoreColor(trialDetail.scores.directionAccuracy * 100)}`}>
                                {(trialDetail.scores.directionAccuracy * 100).toFixed(0)}%
                              </p>
                            </div>
                            <div className="bg-ios-elevated rounded-lg p-2 text-center">
                              <p className="text-[10px] text-ios-gray mb-0.5">Target Hit</p>
                              <p className={`text-sm font-bold ${scoreColor(trialDetail.scores.targetHitRate * 100)}`}>
                                {(trialDetail.scores.targetHitRate * 100).toFixed(0)}%
                              </p>
                            </div>
                            <div className="bg-ios-elevated rounded-lg p-2 text-center">
                              <p className="text-[10px] text-ios-gray mb-0.5">Stop Hit</p>
                              <p className="text-sm font-bold text-ios-red">
                                {(trialDetail.scores.stopHitRate * 100).toFixed(0)}%
                              </p>
                            </div>
                            <div className="bg-ios-elevated rounded-lg p-2 text-center">
                              <p className="text-[10px] text-ios-gray mb-0.5">Avg Return</p>
                              <p className={`text-sm font-bold ${pctColor(trialDetail.scores.avgReturnPercent)}`}>
                                {trialDetail.scores.avgReturnPercent > 0 ? "+" : ""}
                                {trialDetail.scores.avgReturnPercent.toFixed(2)}%
                              </p>
                            </div>
                            <div className="bg-ios-elevated rounded-lg p-2 text-center">
                              <p className="text-[10px] text-ios-gray mb-0.5">Win Rate</p>
                              <p className={`text-sm font-bold ${scoreColor(trialDetail.scores.winRate * 100)}`}>
                                {(trialDetail.scores.winRate * 100).toFixed(0)}%
                              </p>
                            </div>
                            <div className="bg-ios-elevated rounded-lg p-2 text-center">
                              <p className="text-[10px] text-ios-gray mb-0.5">Profit Factor</p>
                              <p className={`text-sm font-bold ${trialDetail.scores.profitFactor >= 1 ? "text-ios-green" : "text-ios-red"}`}>
                                {trialDetail.scores.profitFactor.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </Card>

                        {/* Briefing Summary */}
                        {trialDetail.pipeline?.briefing && (
                          <Card>
                            <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-2">
                              Briefing Summary
                            </h3>
                            <p className="text-[15px] leading-relaxed text-white/90">
                              {trialDetail.pipeline.briefing.summary}
                            </p>
                          </Card>
                        )}

                        {/* Recommendations Table */}
                        {trialDetail.recommendations.length > 0 && (
                          <Card>
                            <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">
                              Recommendations
                            </h3>
                            <div className="space-y-2">
                              {trialDetail.recommendations.map((rec, i) => (
                                <div key={i} className="bg-ios-elevated rounded-lg p-3">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-bold">{rec.symbol}</span>
                                      <span
                                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                          rec.direction === "long"
                                            ? "bg-ios-green/20 text-ios-green"
                                            : "bg-ios-red/20 text-ios-red"
                                        }`}
                                      >
                                        {rec.direction.toUpperCase()}
                                      </span>
                                    </div>
                                    <span className="text-xs text-ios-gray">
                                      ${rec.entryPrice.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex gap-4 text-[11px] text-white/60 mb-1">
                                    <span>Target: ${rec.targetPrice.toFixed(2)}</span>
                                    <span>Stop: ${rec.stopLoss.toFixed(2)}</span>
                                  </div>
                                  <p className="text-[11px] text-white/70">{rec.thesis}</p>
                                  {rec.catalyst && (
                                    <p className="text-[11px] text-ios-blue mt-1">
                                      Catalyst: {rec.catalyst}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </Card>
                        )}

                        {/* Outcomes Table */}
                        {trialDetail.outcomes.length > 0 && (
                          <Card>
                            <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">
                              Outcomes
                            </h3>
                            <div className="space-y-2">
                              {trialDetail.outcomes.map((out, i) => (
                                <div key={i} className="bg-ios-elevated rounded-lg p-3">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-bold">{out.symbol}</span>
                                      {out.hitTarget && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ios-green/20 text-ios-green">
                                          TARGET
                                        </span>
                                      )}
                                      {out.hitStop && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ios-red/20 text-ios-red">
                                          STOPPED
                                        </span>
                                      )}
                                      {out.directionCorrect && (
                                        <svg className="w-3.5 h-3.5 text-ios-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      )}
                                    </div>
                                    <span className={`text-sm font-bold ${pctColor(out.actualReturnPercent)}`}>
                                      {out.actualReturnPercent > 0 ? "+" : ""}
                                      {out.actualReturnPercent.toFixed(2)}%
                                    </span>
                                  </div>
                                  <div className="flex gap-3 text-[11px] text-white/60">
                                    <span>O: ${out.openPrice.toFixed(2)}</span>
                                    <span>H: ${out.highPrice.toFixed(2)}</span>
                                    <span>L: ${out.lowPrice.toFixed(2)}</span>
                                    <span>C: ${out.closePrice.toFixed(2)}</span>
                                  </div>
                                  {out.notes && (
                                    <p className="text-[11px] text-white/50 mt-1">{out.notes}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </Card>
                        )}

                        {/* Dimension Analysis */}
                        {trialDetail.dimensionAnalysis &&
                          Object.keys(trialDetail.dimensionAnalysis).length > 0 && (
                            <Card>
                              <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">
                                Dimension Analysis
                              </h3>
                              <div className="space-y-2">
                                {Object.entries(trialDetail.dimensionAnalysis)
                                  .sort(([, a], [, b]) => b.predictivePower - a.predictivePower)
                                  .map(([dim, analysis]) => (
                                    <div
                                      key={dim}
                                      className="bg-ios-elevated rounded-lg p-2.5 flex items-center justify-between"
                                    >
                                      <div>
                                        <span className="text-xs font-medium">{dim}</span>
                                        <div className="flex gap-3 text-[10px] text-white/50 mt-0.5">
                                          <span>Win avg: {analysis.avgScoreWinners.toFixed(1)}</span>
                                          <span>Loss avg: {analysis.avgScoreLosers.toFixed(1)}</span>
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-[10px] text-ios-gray">Predictive</p>
                                        <p
                                          className={`text-sm font-bold ${
                                            analysis.predictivePower >= 0.5
                                              ? "text-ios-green"
                                              : analysis.predictivePower >= 0.3
                                              ? "text-ios-orange"
                                              : "text-ios-gray"
                                          }`}
                                        >
                                          {(analysis.predictivePower * 100).toFixed(0)}%
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </Card>
                          )}

                        {/* Revised Recommendations (Opus Review) */}
                        {trialDetail.revisedRecommendations &&
                          trialDetail.revisedRecommendations.length > 0 && (
                            <Card className="border border-ios-blue/30">
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ios-blue/20 text-ios-blue">
                                  OPUS REVISED
                                </span>
                                <h3 className="text-sm font-semibold">
                                  Revised Recommendations
                                </h3>
                              </div>
                              <div className="space-y-2">
                                {trialDetail.revisedRecommendations.map((rec, i) => (
                                  <div key={i} className="bg-ios-elevated rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold">{rec.symbol}</span>
                                        <span
                                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                            rec.direction === "long"
                                              ? "bg-ios-green/20 text-ios-green"
                                              : "bg-ios-red/20 text-ios-red"
                                          }`}
                                        >
                                          {rec.direction.toUpperCase()}
                                        </span>
                                      </div>
                                      <span className="text-xs text-ios-gray">
                                        ${rec.entryPrice.toFixed(2)}
                                      </span>
                                    </div>
                                    <div className="flex gap-4 text-[11px] text-white/60 mb-1">
                                      <span>Target: ${rec.targetPrice.toFixed(2)}</span>
                                      <span>Stop: ${rec.stopLoss.toFixed(2)}</span>
                                    </div>
                                    <p className="text-[11px] text-white/70">{rec.thesis}</p>
                                  </div>
                                ))}
                              </div>
                            </Card>
                          )}

                        {/* Opus Review Notes */}
                        {trialDetail.opusReviewNotes && (
                          <Card className="border border-ios-blue/30">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ios-blue/20 text-ios-blue">
                                OPUS REVIEW
                              </span>
                              {trialDetail.opusReviewTrial && (
                                <span className="text-[10px] text-ios-gray">
                                  Trial {trialDetail.opusReviewTrial}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-white/80 leading-relaxed whitespace-pre-line">
                              {trialDetail.opusReviewNotes}
                            </p>
                          </Card>
                        )}

                        {/* Weights for this trial */}
                        {trialDetail.weights &&
                          Object.keys(trialDetail.weights).length > 0 && (
                            <Card>
                              <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-2">
                                Weights (Trial {trialDetail.trialId})
                              </h3>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(trialDetail.weights)
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([dim, weight]) => (
                                    <span
                                      key={dim}
                                      className="text-[10px] px-2 py-1 rounded bg-ios-elevated text-white/80"
                                    >
                                      {dim}:{" "}
                                      <span className="font-semibold">
                                        {(weight * 100).toFixed(0)}%
                                      </span>
                                    </span>
                                  ))}
                              </div>
                            </Card>
                          )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty State */}
      {!index && !loading && !error && (
        <div className="flex flex-col items-center justify-center pt-20 text-center">
          <div className="w-16 h-16 rounded-full bg-ios-card flex items-center justify-center mb-4">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-ios-gray"
            >
              <path d="M4 20V10M10 20V4M16 20V14M22 20V8" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-1">No Training Data</h3>
          <p className="text-sm text-ios-gray max-w-[260px]">
            Training trials are generated by the training engine. Check back after a training run completes.
          </p>
        </div>
      )}
    </div>
  );
}
