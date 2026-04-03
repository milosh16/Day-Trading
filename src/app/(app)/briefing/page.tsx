"use client";

import { useState, useEffect } from "react";
import Card, { StatusBadge } from "@/components/Card";
import type { MarketBriefing, BriefingSection, ScenarioAnalysis } from "@/lib/types";

interface StoredBriefing {
  id: string;
  date: string;
  generatedAt: string;
  model: string;
  summary: string;
  marketCondition: "bullish" | "bearish" | "neutral" | "volatile";
  sections: BriefingSection[];
  scenarios: ScenarioAnalysis[];
  accuracy?: {
    scoredAt: string;
    marketConditionCorrect: boolean;
    scenarioOutcomes: {
      event: string;
      predictedCondition: string;
      actualOutcome: string;
      accurate: boolean;
    }[];
    overallScore: number;
    notes: string;
  };
}

export default function BriefingPage() {
  const [briefing, setBriefing] = useState<MarketBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [historyBriefing, setHistoryBriefing] = useState<StoredBriefing | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Regime state
  const [regime, setRegime] = useState<{
    regime: string;
    volatilityRegime: string;
    confidence: number;
    directionalBias: number;
    keyFactors: string[];
    sectorTilts: { sector: string; bias: string; reason: string }[];
    convictionModifiers: {
      longPenalty: number;
      shortPenalty: number;
      targetMultiplier: number;
      minConvictionOverride?: number;
    };
    leadingIndicators?: {
      stressIndex: number;
      stressIndexTrend: string;
      stressDaysRising: number;
      riskAppetiteIndex: number;
      riskAppetiteTrend: string;
      daysOfHistory: number;
      patterns: { name: string; severity: string; description: string; actionableInsight: string }[];
    };
  } | null>(null);

  // Load on mount
  useEffect(() => {
    loadLatestBriefing();
    loadRegime();
  }, []);

  const loadRegime = async () => {
    try {
      const res = await fetch("/api/regime");
      if (res.ok) {
        const data = await res.json();
        if (data.available !== false && data.regime) {
          setRegime(data);
        }
      }
    } catch { /* regime not available */ }
  };

  const loadLatestBriefing = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/briefing");
      const data = await res.json();

      if (data.id) {
        setBriefing({
          id: data.id,
          timestamp: data.generatedAt,
          summary: data.summary,
          marketCondition: data.marketCondition,
          sections: data.sections || [],
          scenarios: data.scenarios || [],
        });
        setHistoryBriefing(data as StoredBriefing);
      } else if (data.error) {
        // No briefing available — show empty state
        setError(null);
      }
    } catch {
      setError("Failed to load briefing. Pull to refresh.");
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/briefing?history=true");
      if (res.ok) {
        const data = await res.json();
        setHistoryDates(data.dates || []);
      }
    } catch { /* ok */ } finally {
      setLoadingHistory(false);
    }
  };

  const loadDateBriefing = async (date: string) => {
    setSelectedDate(date);
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/briefing?date=${date}`);
      if (res.ok) {
        const data: StoredBriefing = await res.json();
        setHistoryBriefing(data);
        setBriefing({
          id: data.id,
          timestamp: data.generatedAt,
          summary: data.summary,
          marketCondition: data.marketCondition,
          sections: data.sections || [],
          scenarios: data.scenarios || [],
        });
      }
    } catch {
      setError("Failed to load briefing for that date");
    } finally {
      setLoadingHistory(false);
    }
  };

  const toggleSection = (i: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const accuracyColor = (score: number) => {
    if (score >= 70) return "text-ios-green";
    if (score >= 50) return "text-ios-orange";
    return "text-ios-red";
  };

  return (
    <div className="px-4 pt-14 pb-28">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Morning Briefing</h1>
          <p className="text-sm text-ios-gray mt-1">
            {selectedDate
              ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory && historyDates.length === 0) loadHistory();
            }}
            className="text-ios-blue text-sm font-medium"
          >
            {showHistory ? "Close" : "History"}
          </button>
          <button
            onClick={loadLatestBriefing}
            disabled={loading}
            className="text-ios-blue text-sm font-medium disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* History Panel */}
      {showHistory && (
        <Card className="mb-4">
          <h3 className="text-sm font-semibold mb-3">Previous Briefings</h3>
          {loadingHistory && historyDates.length === 0 && (
            <p className="text-xs text-ios-gray">Loading...</p>
          )}
          {historyDates.length === 0 && !loadingHistory && (
            <p className="text-xs text-ios-gray">
              No history yet. Briefings are auto-generated at 6:15 AM ET on weekdays.
            </p>
          )}
          <div className="space-y-1">
            {historyDates.map((date) => (
              <button
                key={date}
                onClick={() => loadDateBriefing(date)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedDate === date
                    ? "bg-ios-blue/20 text-ios-blue"
                    : "bg-ios-elevated text-white/80 active:bg-ios-gray-3"
                }`}
              >
                {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card className="mb-4">
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-2 border-ios-blue/30 border-t-ios-blue rounded-full animate-spin" />
            <span className="ml-3 text-sm text-ios-gray">Loading briefing...</span>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="mb-4 border border-ios-red/30">
          <p className="text-ios-red text-sm">{error}</p>
        </Card>
      )}

      {/* Accuracy Card (for stored briefings) */}
      {historyBriefing?.accuracy && (
        <Card className="mb-4 border border-ios-gray/20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Accuracy Score</h3>
            <span className={`text-2xl font-bold ${accuracyColor(historyBriefing.accuracy.overallScore)}`}>
              {historyBriefing.accuracy.overallScore}
            </span>
          </div>
          <div className="w-full bg-ios-gray-3 rounded-full h-2 mb-3">
            <div
              className={`h-2 rounded-full transition-all ${
                historyBriefing.accuracy.overallScore >= 70
                  ? "bg-ios-green"
                  : historyBriefing.accuracy.overallScore >= 50
                  ? "bg-ios-orange"
                  : "bg-ios-red"
              }`}
              style={{ width: `${historyBriefing.accuracy.overallScore}%` }}
            />
          </div>
          <p className="text-sm text-white/80 mb-3">{historyBriefing.accuracy.notes}</p>

          {/* Market Condition */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-ios-gray">Market Direction:</span>
            {historyBriefing.accuracy.marketConditionCorrect ? (
              <span className="text-xs text-ios-green font-medium">Correct</span>
            ) : (
              <span className="text-xs text-ios-red font-medium">Incorrect</span>
            )}
          </div>

          {/* Scenario Outcomes */}
          {historyBriefing.accuracy.scenarioOutcomes.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-ios-gray uppercase tracking-wider">Scenario Outcomes</p>
              {historyBriefing.accuracy.scenarioOutcomes.map((outcome, i) => (
                <div key={i} className="bg-ios-elevated rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    {outcome.accurate ? (
                      <svg className="w-3.5 h-3.5 text-ios-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-ios-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    <span className="text-xs font-medium">{outcome.event}</span>
                  </div>
                  <p className="text-[11px] text-white/60 ml-5.5">
                    Predicted: {outcome.predictedCondition}
                  </p>
                  <p className="text-[11px] text-white/80 ml-5.5">
                    Actual: {outcome.actualOutcome}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Briefing Content */}
      {briefing && !loading && (
        <div className="space-y-3">
          {/* Summary Card */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <StatusBadge status={briefing.marketCondition} size="md" />
              <span className="text-xs text-ios-gray">
                {new Date(briefing.timestamp).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              {historyBriefing?.model && (
                <span className="text-[10px] text-ios-gray/60 ml-auto">
                  {historyBriefing.model.includes("opus") ? "Opus" : "Sonnet"}
                </span>
              )}
            </div>
            <p className="text-[15px] leading-relaxed text-white/90">
              {briefing.summary}
            </p>
          </Card>

          {/* Regime Card */}
          {regime && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    regime.regime === "risk-on" ? "bg-ios-green/20 text-ios-green" :
                    regime.regime === "risk-off" ? "bg-ios-red/20 text-ios-red" :
                    regime.regime === "crisis" ? "bg-ios-red/30 text-ios-red" :
                    regime.regime === "event-driven" ? "bg-ios-orange/20 text-ios-orange" :
                    "bg-ios-gray/20 text-ios-gray"
                  }`}>
                    {regime.regime.toUpperCase()}
                  </span>
                  <span className="text-xs text-ios-gray">
                    {regime.volatilityRegime} vol
                  </span>
                </div>
                <span className="text-sm font-semibold">
                  {regime.confidence}% conf
                </span>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
                  <p className="text-[10px] text-ios-gray mb-0.5">Bias</p>
                  <p className={`text-sm font-bold ${regime.directionalBias > 0 ? "text-ios-green" : regime.directionalBias < 0 ? "text-ios-red" : "text-ios-gray"}`}>
                    {regime.directionalBias > 0 ? "+" : ""}{regime.directionalBias}
                  </p>
                </div>
                <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
                  <p className="text-[10px] text-ios-gray mb-0.5">Long Pen.</p>
                  <p className="text-sm font-bold text-ios-red">-{regime.convictionModifiers.longPenalty}</p>
                </div>
                <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
                  <p className="text-[10px] text-ios-gray mb-0.5">Short Pen.</p>
                  <p className="text-sm font-bold text-ios-red">-{regime.convictionModifiers.shortPenalty}</p>
                </div>
                <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
                  <p className="text-[10px] text-ios-gray mb-0.5">Target</p>
                  <p className="text-sm font-bold">{regime.convictionModifiers.targetMultiplier.toFixed(1)}x</p>
                </div>
              </div>
              {regime.keyFactors.length > 0 && (
                <div className="space-y-1">
                  {regime.keyFactors.map((f, i) => (
                    <p key={i} className="text-xs text-white/70">- {f}</p>
                  ))}
                </div>
              )}
              {regime.sectorTilts.length > 0 && (
                <div className="mt-2 pt-2 border-t border-ios-gray/10 flex flex-wrap gap-1.5">
                  {regime.sectorTilts.map((t, i) => (
                    <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${
                      t.bias === "overweight" ? "bg-ios-green/15 text-ios-green" :
                      t.bias === "underweight" ? "bg-ios-red/15 text-ios-red" :
                      "bg-ios-gray/15 text-ios-gray"
                    }`}>
                      {t.sector} {t.bias === "overweight" ? "OW" : t.bias === "underweight" ? "UW" : "N"}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Leading Indicators Card */}
          {regime?.leadingIndicators && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[15px] font-semibold">Leading Indicators</h3>
                <span className="text-xs text-ios-gray">
                  {regime.leadingIndicators.daysOfHistory}d history
                </span>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
                  <p className="text-[10px] text-ios-gray mb-0.5">Stress</p>
                  <p className={`text-sm font-bold ${
                    regime.leadingIndicators.stressIndex > 60 ? "text-ios-red" :
                    regime.leadingIndicators.stressIndex > 35 ? "text-ios-orange" :
                    "text-ios-green"
                  }`}>
                    {regime.leadingIndicators.stressIndex}
                  </p>
                  <p className={`text-[10px] ${
                    regime.leadingIndicators.stressIndexTrend === "building" ? "text-ios-red" :
                    regime.leadingIndicators.stressIndexTrend === "easing" ? "text-ios-green" :
                    "text-ios-gray"
                  }`}>
                    {regime.leadingIndicators.stressIndexTrend}
                    {regime.leadingIndicators.stressDaysRising > 0 && ` (${regime.leadingIndicators.stressDaysRising}d)`}
                  </p>
                </div>
                <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
                  <p className="text-[10px] text-ios-gray mb-0.5">Risk Appetite</p>
                  <p className={`text-sm font-bold ${
                    regime.leadingIndicators.riskAppetiteIndex > 60 ? "text-ios-green" :
                    regime.leadingIndicators.riskAppetiteIndex < 40 ? "text-ios-red" :
                    "text-ios-gray"
                  }`}>
                    {regime.leadingIndicators.riskAppetiteIndex}
                  </p>
                  <p className={`text-[10px] ${
                    regime.leadingIndicators.riskAppetiteTrend === "improving" ? "text-ios-green" :
                    regime.leadingIndicators.riskAppetiteTrend === "deteriorating" ? "text-ios-red" :
                    "text-ios-gray"
                  }`}>
                    {regime.leadingIndicators.riskAppetiteTrend}
                  </p>
                </div>
              </div>
              {regime.leadingIndicators.patterns.length > 0 && (
                <div className="space-y-2">
                  {regime.leadingIndicators.patterns.map((p, i) => (
                    <div key={i} className={`rounded-lg p-2 ${
                      p.severity === "critical" ? "bg-ios-red/15 border border-ios-red/30" :
                      p.severity === "high" ? "bg-ios-orange/15 border border-ios-orange/30" :
                      p.severity === "medium" ? "bg-ios-blue/10 border border-ios-blue/20" :
                      "bg-ios-elevated"
                    }`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          p.severity === "critical" ? "bg-ios-red/30 text-ios-red" :
                          p.severity === "high" ? "bg-ios-orange/30 text-ios-orange" :
                          p.severity === "medium" ? "bg-ios-blue/20 text-ios-blue" :
                          "bg-ios-gray/20 text-ios-gray"
                        }`}>
                          {p.severity.toUpperCase()}
                        </span>
                        <span className="text-xs font-semibold">{p.name}</span>
                      </div>
                      <p className="text-[11px] text-white/70 mb-1">{p.description}</p>
                      <p className="text-[11px] text-ios-blue">{p.actionableInsight}</p>
                    </div>
                  ))}
                </div>
              )}
              {regime.leadingIndicators.patterns.length === 0 && (
                <p className="text-xs text-ios-gray text-center">No significant multi-day patterns detected</p>
              )}
            </Card>
          )}

          {/* Sections */}
          {briefing.sections.map((section: BriefingSection, i: number) => (
            <Card key={i} onClick={() => toggleSection(i)} className="cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={section.importance} />
                  <h3 className="text-[15px] font-semibold">{section.title}</h3>
                </div>
                <svg
                  className={`w-4 h-4 text-ios-gray transition-transform ${
                    expandedSections.has(i) ? "rotate-180" : ""
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              {expandedSections.has(i) && (
                <p className="mt-3 text-sm text-white/80 leading-relaxed whitespace-pre-line">
                  {section.content}
                </p>
              )}
            </Card>
          ))}

          {/* Scenario Analysis */}
          {briefing.scenarios.length > 0 && (
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
                Scenario Analysis
              </h2>
              {briefing.scenarios.map((scenario: ScenarioAnalysis, i: number) => (
                <Card key={i} className="mb-3">
                  <h3 className="text-[15px] font-semibold mb-3">{scenario.event}</h3>
                  <div className="space-y-3">
                    {scenario.scenarios.map((s, j) => (
                      <div
                        key={j}
                        className="bg-ios-elevated rounded-lg p-3"
                      >
                        <p className="text-sm font-medium text-ios-blue mb-1">
                          {s.condition}
                        </p>
                        <p className="text-sm text-white/80 mb-1">{s.implication}</p>
                        <p className="text-sm text-ios-green">{s.trade}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!briefing && !loading && !error && (
        <div className="flex flex-col items-center justify-center pt-20 text-center">
          <div className="w-16 h-16 rounded-full bg-ios-card flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ios-gray">
              <path d="M4 6h16M4 10h16M4 14h10M4 18h8" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-1">No Briefing Yet</h3>
          <p className="text-sm text-ios-gray max-w-[260px]">
            Briefings are auto-generated at 6:15 AM ET on weekdays. Check History for previous days.
          </p>
        </div>
      )}
    </div>
  );
}
