"use client";

import { useState, useEffect, useCallback } from "react";
import Card, { StatusBadge } from "@/components/Card";
import { useSettingsStore } from "@/lib/store";
import type { BriefingSection, ScenarioAnalysis } from "@/lib/types";

/* ================================================================
   TYPES
   ================================================================ */

interface BriefingRecommendation {
  ticker: string;
  direction: string;
  entryPrice: number | null;
  targetPrice: number | null;
  stopPrice: number | null;
  riskRewardRatio: number | null;
  positionSize: string;
  catalyst: string;
  reasoning: string;
  bearCase: string;
  conviction: Record<string, number>;
  compositeScore: number;
  NOTE?: string;
}

interface WatchlistItem {
  ticker: string;
  trigger: string;
  reasoning: string;
}

interface AvoidItem {
  ticker: string;
  reasoning: string;
}

interface StoredBriefing {
  id: string;
  date: string;
  generatedAt: string;
  model: string;
  summary: string;
  marketCondition: "bullish" | "bearish" | "neutral" | "volatile";
  sections: BriefingSection[];
  scenarios: ScenarioAnalysis[];
  recommendations?: BriefingRecommendation[];
  watchlist?: WatchlistItem[];
  avoidList?: AvoidItem[];
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

interface RegimeData {
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
}

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

interface HistoryEntry {
  id: string;
  date: string;
  source: "live" | "training";
  regime: string;
  regimeConfidence?: number;
  marketCondition: string;
  summary: string;
  score?: number;
  numRecs: number;
  winRate?: number;
  hasOpusReview?: boolean;
  trialId?: number;
}

type HistoryFilter = "all" | "live" | "training";
type ViewState = "today" | "history" | "detail";

/* ================================================================
   HELPERS
   ================================================================ */

function scoreColor(score: number): string {
  if (score >= 70) return "text-ios-green";
  if (score >= 50) return "text-ios-orange";
  return "text-ios-red";
}

function scoreBgColor(score: number): string {
  if (score >= 70) return "bg-ios-green";
  if (score >= 50) return "bg-ios-orange";
  return "bg-ios-red";
}

function pctColor(value: number): string {
  if (value > 0) return "text-ios-green";
  if (value < 0) return "text-ios-red";
  return "text-ios-gray";
}

function regimeBadgeClass(regime: string): string {
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

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateLong(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/* ================================================================
   COMPONENT
   ================================================================ */

export default function BriefingPage() {
  // --- Data state ---
  const [todayBriefing, setTodayBriefing] = useState<StoredBriefing | null>(null);
  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- History state ---
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");

  // --- View state ---
  const [viewState, setViewState] = useState<ViewState>("today");
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [selectedBriefing, setSelectedBriefing] = useState<StoredBriefing | null>(null);
  const [selectedTrialDetail, setSelectedTrialDetail] = useState<TrialDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // --- Expandable sections ---
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [expandedCandidates, setExpandedCandidates] = useState<Set<string>>(new Set());
  const [expandedWatchlist, setExpandedWatchlist] = useState<Set<string>>(new Set());

  // --- Trade execution ---
  const { settings } = useSettingsStore();
  const [executingTrade, setExecutingTrade] = useState<string | null>(null);
  const [tradeConfirm, setTradeConfirm] = useState<Recommendation | null>(null);
  const [tradeResult, setTradeResult] = useState<{ symbol: string; success: boolean; message: string } | null>(null);

  const alpacaBaseUrl = settings.alpacaKeys?.paperTrading !== false
    ? "https://app.alpaca.markets/paper/trade"
    : "https://app.alpaca.markets/trade";

  const openInAlpaca = (rec: Recommendation) => {
    window.open(`${alpacaBaseUrl}/${rec.symbol}`, "_blank");
  };

  const executeTradeViaApi = async (rec: Recommendation) => {
    if (!settings.alpacaKeys) {
      setTradeResult({ symbol: rec.symbol, success: false, message: "Set Alpaca API keys in Settings first" });
      return;
    }
    setExecutingTrade(rec.symbol);
    setTradeConfirm(null);
    try {
      const side = rec.direction === "long" ? "buy" : "sell";
      const res = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-alpaca-key": settings.alpacaKeys.apiKey,
          "x-alpaca-secret": settings.alpacaKeys.secretKey,
          "x-alpaca-paper": String(settings.alpacaKeys.paperTrading),
        },
        body: JSON.stringify({
          symbol: rec.symbol,
          side,
          type: "limit",
          time_in_force: "day",
          limit_price: rec.entryPrice.toFixed(2),
          qty: "1",
          order_class: "bracket",
          take_profit: { limit_price: rec.targetPrice.toFixed(2) },
          stop_loss: { stop_price: rec.stopLoss.toFixed(2) },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTradeResult({ symbol: rec.symbol, success: true, message: `Order submitted: ${side.toUpperCase()} ${rec.symbol} @ $${rec.entryPrice.toFixed(2)} (ID: ${data.id?.slice(0, 8)})` });
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        setTradeResult({ symbol: rec.symbol, success: false, message: err.error || "Order failed" });
      }
    } catch (e) {
      setTradeResult({ symbol: rec.symbol, success: false, message: String(e) });
    } finally {
      setExecutingTrade(null);
    }
  };

  // --- Load on mount ---
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [briefingRes, regimeRes] = await Promise.allSettled([
        fetch("/api/briefing"),
        fetch("/api/regime"),
      ]);

      if (briefingRes.status === "fulfilled" && briefingRes.value.ok) {
        const data = await briefingRes.value.json();
        if (data.id) {
          setTodayBriefing(data as StoredBriefing);
        }
      }

      if (regimeRes.status === "fulfilled" && regimeRes.value.ok) {
        const data = await regimeRes.value.json();
        if (data.available !== false && data.regime) {
          setRegime(data);
        }
      }
    } catch {
      setError("Failed to load briefing. Pull to refresh.");
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = useCallback(async () => {
    if (historyLoaded) return;
    try {
      const [briefingHistRes, trainingRes] = await Promise.allSettled([
        fetch("/api/briefing?history=true"),
        fetch("/api/training"),
      ]);

      const entries: HistoryEntry[] = [];

      // Live briefing dates
      if (briefingHistRes.status === "fulfilled" && briefingHistRes.value.ok) {
        const data = await briefingHistRes.value.json();
        const dates: string[] = data.dates || [];
        for (const date of dates) {
          // Fetch each date's briefing for summary info
          try {
            const res = await fetch(`/api/briefing?date=${date}`);
            if (res.ok) {
              const b = await res.json();
              entries.push({
                id: `live-${date}`,
                date,
                source: "live",
                regime: "",
                marketCondition: b.marketCondition || "neutral",
                summary: b.summary || "",
                score: b.accuracy?.overallScore,
                numRecs: 0,
                winRate: undefined,
              });
            }
          } catch {
            // Still add the date with minimal info
            entries.push({
              id: `live-${date}`,
              date,
              source: "live",
              regime: "",
              marketCondition: "neutral",
              summary: "",
              numRecs: 0,
            });
          }
        }
      }

      // Training trials
      if (trainingRes.status === "fulfilled" && trainingRes.value.ok) {
        const data = await trainingRes.value.json();
        if (!data.error && data.trials) {
          const idx = data as TrainingIndex;
          for (const trial of idx.trials) {
            entries.push({
              id: `training-${trial.trialId}`,
              date: trial.date,
              source: "training",
              regime: trial.regime,
              marketCondition: "",
              summary: "",
              score: trial.score,
              numRecs: trial.numRecs,
              winRate: trial.winRate,
              hasOpusReview: trial.hasOpusReview,
              trialId: trial.trialId,
            });
          }
        }
      }

      // Sort by date descending
      entries.sort((a, b) => b.date.localeCompare(a.date));
      setHistoryEntries(entries);
      setHistoryLoaded(true);
    } catch {
      // silently fail history load
    }
  }, [historyLoaded]);

  const openHistory = () => {
    setViewState("history");
    setExpandedSections(new Set());
    loadHistory();
  };

  const backToToday = () => {
    setViewState("today");
    setSelectedEntry(null);
    setSelectedBriefing(null);
    setSelectedTrialDetail(null);
    setExpandedSections(new Set());
  };

  const selectHistoryEntry = async (entry: HistoryEntry) => {
    setSelectedEntry(entry);
    setViewState("detail");
    setLoadingDetail(true);
    setExpandedSections(new Set());
    setSelectedBriefing(null);
    setSelectedTrialDetail(null);

    try {
      if (entry.source === "live") {
        const res = await fetch(`/api/briefing?date=${entry.date}`);
        if (res.ok) {
          const data = await res.json();
          setSelectedBriefing(data as StoredBriefing);
        }
      } else if (entry.source === "training" && entry.trialId != null) {
        const res = await fetch(`/api/training?id=${entry.trialId}`);
        if (res.ok) {
          const data = await res.json();
          if (!data.error) {
            setSelectedTrialDetail(data as TrialDetail);
          }
        }
      }
    } catch {
      setError("Failed to load detail");
    } finally {
      setLoadingDetail(false);
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

  const filteredHistory = historyEntries.filter((e) => {
    if (historyFilter === "all") return true;
    return e.source === historyFilter;
  });

  /* ================================================================
     RENDER HELPERS
     ================================================================ */

  const renderRegimeCard = (regimeData: RegimeData) => (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${regimeBadgeClass(regimeData.regime)}`}>
            {regimeData.regime.toUpperCase()}
          </span>
          <span className="text-xs text-ios-gray">
            {regimeData.volatilityRegime} vol
          </span>
        </div>
        <span className="text-sm font-semibold">
          {regimeData.confidence}% conf
        </span>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Bias</p>
          <p className={`text-sm font-bold ${regimeData.directionalBias > 0 ? "text-ios-green" : regimeData.directionalBias < 0 ? "text-ios-red" : "text-ios-gray"}`}>
            {regimeData.directionalBias > 0 ? "+" : ""}{regimeData.directionalBias}
          </p>
        </div>
        <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Long Pen.</p>
          <p className="text-sm font-bold text-ios-red">-{regimeData.convictionModifiers.longPenalty}</p>
        </div>
        <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Short Pen.</p>
          <p className="text-sm font-bold text-ios-red">-{regimeData.convictionModifiers.shortPenalty}</p>
        </div>
        <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Target</p>
          <p className="text-sm font-bold">{regimeData.convictionModifiers.targetMultiplier.toFixed(1)}x</p>
        </div>
      </div>
      {regimeData.keyFactors.length > 0 && (
        <div className="space-y-1">
          {regimeData.keyFactors.map((f, i) => (
            <p key={i} className="text-xs text-white/70">- {f}</p>
          ))}
        </div>
      )}
      {regimeData.sectorTilts.length > 0 && (
        <div className="mt-2 pt-2 border-t border-ios-gray/10 flex flex-wrap gap-1.5">
          {regimeData.sectorTilts.map((t, i) => (
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
  );

  const renderLeadingIndicators = (indicators: NonNullable<RegimeData["leadingIndicators"]>) => (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold">Leading Indicators</h3>
        <span className="text-xs text-ios-gray">{indicators.daysOfHistory}d history</span>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Stress</p>
          <p className={`text-sm font-bold ${
            indicators.stressIndex > 60 ? "text-ios-red" :
            indicators.stressIndex > 35 ? "text-ios-orange" : "text-ios-green"
          }`}>
            {indicators.stressIndex}
          </p>
          <p className={`text-[10px] ${
            indicators.stressIndexTrend === "building" ? "text-ios-red" :
            indicators.stressIndexTrend === "easing" ? "text-ios-green" : "text-ios-gray"
          }`}>
            {indicators.stressIndexTrend}
            {indicators.stressDaysRising > 0 && ` (${indicators.stressDaysRising}d)`}
          </p>
        </div>
        <div className="flex-1 bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Risk Appetite</p>
          <p className={`text-sm font-bold ${
            indicators.riskAppetiteIndex > 60 ? "text-ios-green" :
            indicators.riskAppetiteIndex < 40 ? "text-ios-red" : "text-ios-gray"
          }`}>
            {indicators.riskAppetiteIndex}
          </p>
          <p className={`text-[10px] ${
            indicators.riskAppetiteTrend === "improving" ? "text-ios-green" :
            indicators.riskAppetiteTrend === "deteriorating" ? "text-ios-red" : "text-ios-gray"
          }`}>
            {indicators.riskAppetiteTrend}
          </p>
        </div>
      </div>
      {indicators.patterns.length > 0 && (
        <div className="space-y-2">
          {indicators.patterns.map((p, i) => (
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
      {indicators.patterns.length === 0 && (
        <p className="text-xs text-ios-gray text-center">No significant multi-day patterns detected</p>
      )}
    </Card>
  );

  const renderSections = (sections: BriefingSection[]) => (
    <>
      {sections.map((section, i) => (
        <Card key={i} onClick={() => toggleSection(i)} className="cursor-pointer">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusBadge status={section.importance} />
              <h3 className="text-[15px] font-semibold">{section.title}</h3>
            </div>
            <svg
              className={`w-4 h-4 text-ios-gray transition-transform ${expandedSections.has(i) ? "rotate-180" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
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
    </>
  );

  /* --- TradingView mini chart embed --- */
  const MiniChart = ({ symbol }: { symbol: string }) => (
    <div className="rounded-lg overflow-hidden mb-2 bg-ios-elevated" style={{ height: 140 }}>
      <iframe
        src={`https://s.tradingview.com/embed-widget/mini-symbol-overview/?symbol=${encodeURIComponent(symbol)}&dateRange=1M&colorTheme=dark&isTransparent=true&autosize=true&largeChartUrl=`}
        width="100%"
        height="140"
        frameBorder="0"
        style={{ pointerEvents: "none" }}
        loading="lazy"
      />
    </div>
  );

  /* --- Conviction bar --- */
  const ConvictionBar = ({ score, threshold }: { score: number; threshold: number }) => {
    const pct = Math.min(100, score);
    const threshPct = Math.min(100, threshold);
    const passed = score >= threshold;
    return (
      <div className="relative h-2 bg-ios-gray-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${passed ? "bg-ios-green" : "bg-ios-orange"}`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-white/40"
          style={{ left: `${threshPct}%` }}
        />
      </div>
    );
  };

  /* --- Trade ticket state (editable order form) --- */
  const [tradeTicket, setTradeTicket] = useState<{
    symbol: string;
    side: "buy" | "sell";
    orderType: "market" | "limit" | "bracket";
    qty: string;
    limitPrice: string;
    takeProfitPrice: string;
    stopLossPrice: string;
    timeInForce: "day" | "gtc";
    catalyst: string;
  } | null>(null);

  const openTradeTicket = (ticker: string, direction?: string, entry?: number | null, target?: number | null, stop?: number | null, catalyst?: string) => {
    const hasPrices = entry != null && entry > 0 && target != null && target > 0 && stop != null && stop > 0;
    setTradeTicket({
      symbol: ticker,
      side: direction === "short" ? "sell" : "buy",
      orderType: hasPrices ? "bracket" : "market",
      qty: "1",
      limitPrice: entry && entry > 0 ? entry.toFixed(2) : "",
      takeProfitPrice: target && target > 0 ? target.toFixed(2) : "",
      stopLossPrice: stop && stop > 0 ? stop.toFixed(2) : "",
      timeInForce: "day",
      catalyst: catalyst || "",
    });
  };

  const submitTradeTicket = async () => {
    if (!tradeTicket || !settings.alpacaKeys) return;
    setExecutingTrade(tradeTicket.symbol);
    try {
      const orderBody: Record<string, unknown> = {
        symbol: tradeTicket.symbol,
        side: tradeTicket.side,
        qty: tradeTicket.qty,
        time_in_force: tradeTicket.timeInForce,
      };

      if (tradeTicket.orderType === "bracket" && tradeTicket.limitPrice && tradeTicket.takeProfitPrice && tradeTicket.stopLossPrice) {
        orderBody.type = "limit";
        orderBody.limit_price = tradeTicket.limitPrice;
        orderBody.order_class = "bracket";
        orderBody.take_profit = { limit_price: tradeTicket.takeProfitPrice };
        orderBody.stop_loss = { stop_price: tradeTicket.stopLossPrice };
      } else if (tradeTicket.orderType === "limit" && tradeTicket.limitPrice) {
        orderBody.type = "limit";
        orderBody.limit_price = tradeTicket.limitPrice;
      } else {
        orderBody.type = "market";
      }

      const res = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-alpaca-key": settings.alpacaKeys.apiKey,
          "x-alpaca-secret": settings.alpacaKeys.secretKey,
          "x-alpaca-paper": String(settings.alpacaKeys.paperTrading),
        },
        body: JSON.stringify(orderBody),
      });

      if (res.ok) {
        const data = await res.json();
        setTradeResult({ symbol: tradeTicket.symbol, success: true, message: `${tradeTicket.side.toUpperCase()} ${tradeTicket.qty} ${tradeTicket.symbol} submitted (ID: ${data.id?.slice(0, 8)})` });
        setTradeTicket(null);
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        setTradeResult({ symbol: tradeTicket.symbol, success: false, message: err.error || "Order failed" });
      }
    } catch (e) {
      setTradeResult({ symbol: tradeTicket.symbol, success: false, message: String(e) });
    } finally {
      setExecutingTrade(null);
    }
  };

  /* --- Trade buttons component (reused across all card types) --- */
  const TradeButtons = ({ ticker, direction, entryPrice, targetPrice, stopPrice, catalyst }: {
    ticker: string;
    direction?: string;
    entryPrice?: number | null;
    targetPrice?: number | null;
    stopPrice?: number | null;
    catalyst?: string;
  }) => {
    const side = direction === "short" ? "sell" : "buy";
    return (
      <div className="flex gap-2 mt-2 pt-2 border-t border-ios-separator/30">
        <button
          onClick={(e) => { e.stopPropagation(); window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(ticker)}`, "_blank"); }}
          className="flex-1 text-[11px] font-semibold py-1.5 px-3 rounded-lg bg-ios-gray/15 text-white/70 active:bg-ios-gray/25 transition-colors"
        >
          TradingView
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); openTradeTicket(ticker, direction, entryPrice, targetPrice, stopPrice, catalyst); }}
          disabled={executingTrade === ticker}
          className={`flex-1 text-[11px] font-semibold py-1.5 px-3 rounded-lg transition-colors ${
            direction === "short"
              ? "bg-ios-red/15 text-ios-red active:bg-ios-red/25"
              : "bg-ios-green/15 text-ios-green active:bg-ios-green/25"
          } disabled:opacity-50`}
        >
          {executingTrade === ticker ? "Sending..." : `${side === "buy" ? "Buy" : "Sell"} on Alpaca`}
        </button>
      </div>
    );
  };

  const toggleCandidate = (ticker: string) => {
    setExpandedCandidates((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const toggleWatchlistItem = (ticker: string) => {
    setExpandedWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const CONVICTION_THRESHOLD = 78;
  const CONVICTION_LABELS: Record<string, string> = {
    catalystClarity: "Catalyst",
    technicalSetup: "Technical",
    riskReward: "Risk/Reward",
    volumeLiquidity: "Volume",
    marketAlignment: "Mkt Align",
    informationEdge: "Info Edge",
    timingUrgency: "Timing",
  };

  /* --- Trade Candidates Section --- */
  const renderTradeCandidates = (recs: BriefingRecommendation[]) => {
    const realCandidates = recs.filter((r) => r.ticker !== "NO_TRADE_RECOMMENDED");
    const noTrade = recs.find((r) => r.ticker === "NO_TRADE_RECOMMENDED");

    if (realCandidates.length === 0 && !noTrade) return null;

    return (
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
          Trade Candidates
        </h2>

        {/* No-Trade Rationale */}
        {noTrade && (
          <Card className="mb-3 border border-ios-orange/20">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">&#128176;</span>
              <h3 className="text-[15px] font-semibold">Cash is the Position</h3>
            </div>
            <p className="text-sm text-white/80 leading-relaxed mb-3">{noTrade.reasoning}</p>
            {realCandidates.length > 0 && (
              <div className="bg-ios-elevated rounded-lg p-2.5">
                <p className="text-xs text-ios-gray">
                  Best candidate: <span className="text-white font-medium">{realCandidates[0].ticker} {realCandidates[0].direction}</span>{" "}
                  ({realCandidates[0].compositeScore}/{CONVICTION_THRESHOLD})
                </p>
                {realCandidates[0].NOTE && (
                  <p className="text-[11px] text-ios-orange mt-1">{realCandidates[0].NOTE.split(".")[0]}</p>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Real trade candidates */}
        {realCandidates.map((rec) => {
          const passed = rec.compositeScore >= CONVICTION_THRESHOLD;
          const isExpanded = expandedCandidates.has(rec.ticker);
          const gainPct = rec.entryPrice && rec.targetPrice
            ? Math.abs(((rec.targetPrice - rec.entryPrice) / rec.entryPrice) * 100)
            : null;
          const riskPct = rec.entryPrice && rec.stopPrice
            ? Math.abs(((rec.stopPrice - rec.entryPrice) / rec.entryPrice) * 100)
            : null;

          return (
            <Card key={rec.ticker} className={`mb-3 ${!passed ? "border border-ios-orange/20" : "border border-ios-green/20"}`}>
              {/* Header: ticker, direction, score, pass/fail */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{rec.ticker}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    rec.direction === "long" ? "bg-ios-green/20 text-ios-green" :
                    rec.direction === "short" ? "bg-ios-red/20 text-ios-red" :
                    "bg-ios-gray/20 text-ios-gray"
                  }`}>
                    {rec.direction.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-bold ${passed ? "text-ios-green" : "text-ios-orange"}`}>
                    {rec.compositeScore}
                  </span>
                  <span className="text-xs text-ios-gray">/100</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    passed ? "bg-ios-green/20 text-ios-green" : "bg-ios-orange/20 text-ios-orange"
                  }`}>
                    {passed ? "PASS" : "BELOW"}
                  </span>
                </div>
              </div>

              {/* Conviction bar */}
              <div className="mb-3">
                <ConvictionBar score={rec.compositeScore} threshold={CONVICTION_THRESHOLD} />
                <p className="text-[10px] text-ios-gray text-right mt-0.5">{CONVICTION_THRESHOLD} min</p>
              </div>

              {/* Prices */}
              {rec.entryPrice != null && (
                <div className="bg-ios-elevated rounded-lg p-2.5 mb-2">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-white/70">
                      Entry <span className="font-semibold text-white">${rec.entryPrice.toFixed(2)}</span>
                      {rec.targetPrice != null && (
                        <> &rarr; Target <span className="text-ios-green font-semibold">${rec.targetPrice.toFixed(2)}</span></>
                      )}
                      {gainPct != null && (
                        <span className="text-ios-green ml-1">({gainPct.toFixed(1)}%)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-white/60">
                    {rec.stopPrice != null && (
                      <span>Stop <span className="text-ios-red">${rec.stopPrice.toFixed(2)}</span>{riskPct != null && ` (${riskPct.toFixed(1)}% risk)`}</span>
                    )}
                    {rec.riskRewardRatio != null && (
                      <span>R:R <span className="font-semibold text-white/80">{rec.riskRewardRatio.toFixed(2)}</span></span>
                    )}
                  </div>
                  {rec.positionSize && rec.positionSize !== "0%" && (
                    <p className="text-[11px] text-ios-gray mt-1">Size: {rec.positionSize}</p>
                  )}
                </div>
              )}

              {/* Chart */}
              <MiniChart symbol={rec.ticker} />

              {/* Conviction dimensions — always visible */}
              <div className="bg-ios-elevated rounded-lg p-2.5 mb-2">
                <div className="space-y-1.5">
                  {Object.entries(rec.conviction)
                    .sort(([, a], [, b]) => b - a)
                    .map(([dim, val]) => (
                      <div key={dim} className="flex items-center gap-2">
                        <span className="text-[10px] text-white/60 w-16 shrink-0">{CONVICTION_LABELS[dim] || dim}</span>
                        <div className="flex-1 h-1.5 bg-ios-gray-3 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${val >= 80 ? "bg-ios-green" : val >= 60 ? "bg-ios-blue" : val >= 40 ? "bg-ios-orange" : "bg-ios-red"}`}
                            style={{ width: `${Math.min(100, val)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-semibold text-white/80 w-6 text-right">{val}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Catalyst */}
              {rec.catalyst && (
                <p className="text-[11px] text-ios-blue mb-2">{rec.catalyst}</p>
              )}

              {/* Below threshold warning */}
              {!passed && (
                <div className="bg-ios-orange/10 border border-ios-orange/20 rounded-lg p-2.5 mb-2">
                  <p className="text-[11px] text-ios-orange font-medium">
                    Below regime minimum ({rec.compositeScore} &lt; {CONVICTION_THRESHOLD})
                  </p>
                  {rec.NOTE && <p className="text-[11px] text-white/70 mt-1">{rec.NOTE}</p>}
                </div>
              )}

              {/* Expandable deep analysis */}
              <button
                onClick={() => toggleCandidate(rec.ticker)}
                className="flex items-center gap-1 text-[11px] text-ios-blue mt-1 mb-1"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                >
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {isExpanded ? "Hide Analysis" : "Full Analysis"}
              </button>

              {isExpanded && (
                <div className="mt-2 space-y-3">
                  <div>
                    <p className="text-[10px] text-ios-gray uppercase tracking-wider mb-1">Reasoning</p>
                    <p className="text-[11px] text-white/70 leading-relaxed">{rec.reasoning}</p>
                  </div>
                  {rec.bearCase && (
                    <div>
                      <p className="text-[10px] text-ios-gray uppercase tracking-wider mb-1">Bear Case</p>
                      <p className="text-[11px] text-white/70 leading-relaxed">{rec.bearCase}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Trade buttons — ALL candidates, not just above threshold */}
              <TradeButtons
                ticker={rec.ticker}
                direction={rec.direction}
                entryPrice={rec.entryPrice}
                targetPrice={rec.targetPrice}
                stopPrice={rec.stopPrice}
                catalyst={rec.catalyst}
              />
            </Card>
          );
        })}
      </div>
    );
  };

  /* --- Watchlist Section --- */
  const renderWatchlist = (items: WatchlistItem[]) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
          Watchlist ({items.length})
        </h2>
        {items.map((item) => {
          const isExpanded = expandedWatchlist.has(item.ticker);
          const priceMatch = item.trigger.match(/\$[\d,.]+(?:\s*-\s*\$?[\d,.]+)?/);
          // Infer direction from trigger text
          const isBuy = /buy|long|call/i.test(item.trigger);
          const direction = isBuy ? "long" : /short|sell|put/i.test(item.trigger) ? "short" : "long";
          // Extract target price for potential order
          const allPrices = [...(item.trigger.matchAll(/\$([\d,.]+)/g))].map(m => parseFloat(m[1].replace(",", "")));
          const triggerPrice = allPrices.length > 0 ? allPrices[0] : null;

          return (
            <Card key={item.ticker} className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{item.ticker}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    isBuy ? "bg-ios-green/20 text-ios-green" : "bg-ios-red/20 text-ios-red"
                  }`}>
                    {isBuy ? "WATCH BUY" : "WATCH SELL"}
                  </span>
                </div>
                {priceMatch && (
                  <span className="text-sm font-semibold text-ios-blue">{priceMatch[0]}</span>
                )}
              </div>

              {/* Chart */}
              <MiniChart symbol={item.ticker} />

              {/* Trigger condition */}
              <div className="bg-ios-elevated rounded-lg p-2.5 mb-2">
                <p className="text-[10px] text-ios-gray uppercase tracking-wider mb-1">Trigger</p>
                <p className="text-[11px] text-white/80 leading-relaxed">{item.trigger}</p>
              </div>

              {/* Reasoning — always visible for watchlist */}
              <p className="text-[11px] text-white/60 leading-relaxed mb-1">{item.reasoning}</p>

              {/* Trade buttons */}
              <TradeButtons
                ticker={item.ticker}
                direction={direction}
                entryPrice={triggerPrice}
                targetPrice={null}
                stopPrice={null}
              />
            </Card>
          );
        })}
      </div>
    );
  };

  /* --- Avoid List Section --- */
  const renderAvoidList = (items: AvoidItem[]) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
          Avoid ({items.length})
        </h2>
        {items.map((item) => (
          <Card key={item.ticker} className="mb-3 border border-ios-red/15">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ios-red">&#10007;</span>
                <span className="text-sm font-bold">{item.ticker}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ios-red/20 text-ios-red">
                  AVOID
                </span>
              </div>
            </div>

            {/* Chart */}
            <MiniChart symbol={item.ticker} />

            {/* Why to avoid */}
            <div className="bg-ios-red/5 rounded-lg p-2.5 mb-2">
              <p className="text-[11px] text-white/70 leading-relaxed">{item.reasoning}</p>
            </div>

            {/* Trade buttons — user might want to take the other side */}
            <TradeButtons ticker={item.ticker} />
          </Card>
        ))}
      </div>
    );
  };

  const renderScenarios = (scenarios: ScenarioAnalysis[]) => {
    // Filter out broken scenarios (NO_TRADE sentinel, null prices)
    const validScenarios = scenarios.filter((s) => {
      if (s.event.includes("NO_TRADE")) return false;
      if (s.event.includes("@ $null")) return false;
      return true;
    });
    if (validScenarios.length === 0) return null;
    return (
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
          Scenario Analysis
        </h2>
        {validScenarios.map((scenario, i) => (
          <Card key={i} className="mb-3">
            <h3 className="text-[15px] font-semibold mb-3">{scenario.event}</h3>
            <div className="space-y-3">
              {scenario.scenarios.map((s, j) => (
                <div key={j} className="bg-ios-elevated rounded-lg p-3">
                  <p className="text-sm font-medium text-ios-blue mb-1">{s.condition}</p>
                  <p className="text-sm text-white/80 mb-1">{s.implication}</p>
                  <p className="text-sm text-ios-green">{s.trade}</p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    );
  };

  const renderAccuracyCard = (accuracy: NonNullable<StoredBriefing["accuracy"]>) => (
    <Card className="mb-4 border border-ios-gray/20">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Accuracy Score</h3>
        <span className={`text-2xl font-bold ${scoreColor(accuracy.overallScore)}`}>
          {accuracy.overallScore}
        </span>
      </div>
      <div className="w-full bg-ios-gray-3 rounded-full h-2 mb-3">
        <div
          className={`h-2 rounded-full transition-all ${scoreBgColor(accuracy.overallScore)}`}
          style={{ width: `${accuracy.overallScore}%` }}
        />
      </div>
      <p className="text-sm text-white/80 mb-3">{accuracy.notes}</p>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-ios-gray">Market Direction:</span>
        {accuracy.marketConditionCorrect ? (
          <span className="text-xs text-ios-green font-medium">Correct</span>
        ) : (
          <span className="text-xs text-ios-red font-medium">Incorrect</span>
        )}
      </div>
      {accuracy.scenarioOutcomes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-ios-gray uppercase tracking-wider">Scenario Outcomes</p>
          {accuracy.scenarioOutcomes.map((outcome, i) => (
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
              <p className="text-[11px] text-white/60 ml-5.5">Predicted: {outcome.predictedCondition}</p>
              <p className="text-[11px] text-white/80 ml-5.5">Actual: {outcome.actualOutcome}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  /* --- Training detail sub-renders --- */

  const renderTrialScores = (scores: TrialDetail["scores"]) => (
    <Card>
      <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">Scores</h3>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Direction</p>
          <p className={`text-sm font-bold ${scoreColor(scores.directionAccuracy * 100)}`}>
            {(scores.directionAccuracy * 100).toFixed(0)}%
          </p>
        </div>
        <div className="bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Target Hit</p>
          <p className={`text-sm font-bold ${scoreColor(scores.targetHitRate * 100)}`}>
            {(scores.targetHitRate * 100).toFixed(0)}%
          </p>
        </div>
        <div className="bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Stop Hit</p>
          <p className="text-sm font-bold text-ios-red">
            {(scores.stopHitRate * 100).toFixed(0)}%
          </p>
        </div>
        <div className="bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Avg Return</p>
          <p className={`text-sm font-bold ${pctColor(scores.avgReturnPercent)}`}>
            {scores.avgReturnPercent > 0 ? "+" : ""}{scores.avgReturnPercent.toFixed(2)}%
          </p>
        </div>
        <div className="bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Win Rate</p>
          <p className={`text-sm font-bold ${scoreColor(scores.winRate * 100)}`}>
            {(scores.winRate * 100).toFixed(0)}%
          </p>
        </div>
        <div className="bg-ios-elevated rounded-lg p-2 text-center">
          <p className="text-[10px] text-ios-gray mb-0.5">Profit Factor</p>
          <p className={`text-sm font-bold ${scores.profitFactor >= 1 ? "text-ios-green" : "text-ios-red"}`}>
            {scores.profitFactor.toFixed(2)}
          </p>
        </div>
      </div>
    </Card>
  );

  const renderRecommendations = (recs: Recommendation[], label?: string) => {
    if (recs.length === 0) return null;
    const isRevised = label === "OPUS REVISED";
    return (
      <Card className={isRevised ? "border border-ios-blue/30" : ""}>
        {isRevised ? (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ios-blue/20 text-ios-blue">
              OPUS REVISED
            </span>
            <h3 className="text-sm font-semibold">Revised Recommendations</h3>
          </div>
        ) : (
          <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">
            Recommendations
          </h3>
        )}
        <div className="space-y-2">
          {recs.map((rec, i) => (
            <div key={i} className="bg-ios-elevated rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{rec.symbol}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    rec.direction === "long" ? "bg-ios-green/20 text-ios-green" : "bg-ios-red/20 text-ios-red"
                  }`}>
                    {rec.direction.toUpperCase()}
                  </span>
                </div>
                <span className="text-xs text-ios-gray">${rec.entryPrice.toFixed(2)}</span>
              </div>
              <div className="flex gap-4 text-[11px] text-white/60 mb-1">
                <span>Target: ${rec.targetPrice.toFixed(2)}</span>
                <span>Stop: ${rec.stopLoss.toFixed(2)}</span>
              </div>
              <p className="text-[11px] text-white/70">{rec.thesis}</p>
              {rec.catalyst && (
                <p className="text-[11px] text-ios-blue mt-1">Catalyst: {rec.catalyst}</p>
              )}

              {/* Trade action buttons */}
              {!isRevised && (
                <TradeButtons
                  ticker={rec.symbol}
                  direction={rec.direction}
                  entryPrice={rec.entryPrice}
                  targetPrice={rec.targetPrice}
                  stopPrice={rec.stopLoss}
                  catalyst={rec.catalyst}
                />
              )}
            </div>
          ))}
        </div>

        {/* Editable Trade Ticket Modal */}
        {tradeTicket && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTradeTicket(null)}>
            <div className="bg-ios-card rounded-t-2xl sm:rounded-2xl p-5 mx-0 sm:mx-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Trade {tradeTicket.symbol}</h3>
                <button onClick={() => setTradeTicket(null)} className="text-ios-gray text-xl leading-none">&times;</button>
              </div>

              {/* Catalyst context */}
              {tradeTicket.catalyst && (
                <div className="bg-ios-blue/10 rounded-lg p-2.5 mb-4">
                  <p className="text-[11px] text-ios-blue">{tradeTicket.catalyst}</p>
                </div>
              )}

              {/* Side toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setTradeTicket({ ...tradeTicket, side: "buy" })}
                  className={`flex-1 text-sm font-semibold py-2 rounded-xl transition-colors ${
                    tradeTicket.side === "buy" ? "bg-ios-green text-black" : "bg-ios-elevated text-white/50"
                  }`}
                >
                  Buy
                </button>
                <button
                  onClick={() => setTradeTicket({ ...tradeTicket, side: "sell" })}
                  className={`flex-1 text-sm font-semibold py-2 rounded-xl transition-colors ${
                    tradeTicket.side === "sell" ? "bg-ios-red text-white" : "bg-ios-elevated text-white/50"
                  }`}
                >
                  Sell / Short
                </button>
              </div>

              {/* Order type */}
              <div className="mb-4">
                <label className="text-[11px] text-ios-gray uppercase tracking-wider mb-1.5 block">Order Type</label>
                <div className="flex gap-1.5">
                  {(["market", "limit", "bracket"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTradeTicket({ ...tradeTicket, orderType: t })}
                      className={`flex-1 text-[11px] font-semibold py-1.5 rounded-lg transition-colors ${
                        tradeTicket.orderType === t ? "bg-ios-blue text-white" : "bg-ios-elevated text-white/50"
                      }`}
                    >
                      {t === "bracket" ? "Bracket" : t === "limit" ? "Limit" : "Market"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div className="mb-3">
                <label className="text-[11px] text-ios-gray uppercase tracking-wider mb-1 block">Quantity (shares)</label>
                <input
                  type="number"
                  min="1"
                  value={tradeTicket.qty}
                  onChange={e => setTradeTicket({ ...tradeTicket, qty: e.target.value })}
                  className="w-full bg-ios-elevated rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-ios-blue"
                />
              </div>

              {/* Limit price (for limit and bracket) */}
              {tradeTicket.orderType !== "market" && (
                <div className="mb-3">
                  <label className="text-[11px] text-ios-gray uppercase tracking-wider mb-1 block">
                    {tradeTicket.orderType === "bracket" ? "Entry Price (limit)" : "Limit Price"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={tradeTicket.limitPrice}
                    onChange={e => setTradeTicket({ ...tradeTicket, limitPrice: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-ios-elevated rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-ios-blue"
                  />
                </div>
              )}

              {/* Take profit + stop loss (bracket only) */}
              {tradeTicket.orderType === "bracket" && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[11px] text-ios-green uppercase tracking-wider mb-1 block">Take Profit</label>
                    <input
                      type="number"
                      step="0.01"
                      value={tradeTicket.takeProfitPrice}
                      onChange={e => setTradeTicket({ ...tradeTicket, takeProfitPrice: e.target.value })}
                      placeholder="0.00"
                      className="w-full bg-ios-elevated rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-ios-green"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-ios-red uppercase tracking-wider mb-1 block">Stop Loss</label>
                    <input
                      type="number"
                      step="0.01"
                      value={tradeTicket.stopLossPrice}
                      onChange={e => setTradeTicket({ ...tradeTicket, stopLossPrice: e.target.value })}
                      placeholder="0.00"
                      className="w-full bg-ios-elevated rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-ios-red"
                    />
                  </div>
                </div>
              )}

              {/* Time in force */}
              <div className="mb-4">
                <label className="text-[11px] text-ios-gray uppercase tracking-wider mb-1.5 block">Time in Force</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTradeTicket({ ...tradeTicket, timeInForce: "day" })}
                    className={`flex-1 text-[11px] font-semibold py-1.5 rounded-lg transition-colors ${
                      tradeTicket.timeInForce === "day" ? "bg-ios-blue text-white" : "bg-ios-elevated text-white/50"
                    }`}
                  >
                    Day
                  </button>
                  <button
                    onClick={() => setTradeTicket({ ...tradeTicket, timeInForce: "gtc" })}
                    className={`flex-1 text-[11px] font-semibold py-1.5 rounded-lg transition-colors ${
                      tradeTicket.timeInForce === "gtc" ? "bg-ios-blue text-white" : "bg-ios-elevated text-white/50"
                    }`}
                  >
                    Good til Cancel
                  </button>
                </div>
              </div>

              {/* Order summary */}
              <div className="bg-ios-elevated rounded-lg p-3 mb-4">
                <p className="text-[11px] text-ios-gray uppercase tracking-wider mb-2">Order Summary</p>
                <p className="text-sm text-white">
                  <span className={tradeTicket.side === "buy" ? "text-ios-green font-bold" : "text-ios-red font-bold"}>
                    {tradeTicket.side.toUpperCase()}
                  </span>
                  {" "}{tradeTicket.qty} {tradeTicket.symbol}
                  {tradeTicket.orderType === "market" ? " at market" : ` @ $${tradeTicket.limitPrice || "—"}`}
                  {tradeTicket.orderType === "bracket" && (
                    <span className="text-white/50"> | TP ${tradeTicket.takeProfitPrice || "—"} | SL ${tradeTicket.stopLossPrice || "—"}</span>
                  )}
                  {" "}({tradeTicket.timeInForce === "day" ? "day" : "GTC"})
                </p>
                <p className="text-[11px] text-ios-gray mt-1">
                  {settings.alpacaKeys?.paperTrading !== false ? "Paper trading" : "LIVE TRADING"}
                </p>
              </div>

              {/* Submit */}
              <div className="flex gap-3">
                <button
                  onClick={() => setTradeTicket(null)}
                  className="flex-1 text-sm font-semibold py-2.5 rounded-xl bg-ios-elevated text-white active:bg-ios-gray-3 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitTradeTicket}
                  disabled={!settings.alpacaKeys || executingTrade === tradeTicket.symbol}
                  className={`flex-1 text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50 ${
                    tradeTicket.side === "buy"
                      ? "bg-ios-green text-black active:bg-ios-green/80"
                      : "bg-ios-red text-white active:bg-ios-red/80"
                  }`}
                >
                  {executingTrade === tradeTicket.symbol ? "Submitting..." : `Submit ${tradeTicket.side === "buy" ? "Buy" : "Sell"}`}
                </button>
              </div>

              {!settings.alpacaKeys && (
                <p className="text-[11px] text-ios-orange text-center mt-2">Set Alpaca API keys in Settings first</p>
              )}
            </div>
          </div>
        )}
      </Card>
    );
  };

  const renderOutcomes = (outcomes: Outcome[]) => {
    if (outcomes.length === 0) return null;
    return (
      <Card>
        <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">Outcomes</h3>
        <div className="space-y-2">
          {outcomes.map((out, i) => (
            <div key={i} className="bg-ios-elevated rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{out.symbol}</span>
                  {out.hitTarget && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ios-green/20 text-ios-green">TARGET</span>
                  )}
                  {out.hitStop && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ios-red/20 text-ios-red">STOPPED</span>
                  )}
                  {out.directionCorrect && (
                    <svg className="w-3.5 h-3.5 text-ios-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className={`text-sm font-bold ${pctColor(out.actualReturnPercent)}`}>
                  {out.actualReturnPercent > 0 ? "+" : ""}{out.actualReturnPercent.toFixed(2)}%
                </span>
              </div>
              <div className="flex gap-3 text-[11px] text-white/60">
                <span>O: ${out.openPrice.toFixed(2)}</span>
                <span>H: ${out.highPrice.toFixed(2)}</span>
                <span>L: ${out.lowPrice.toFixed(2)}</span>
                <span>C: ${out.closePrice.toFixed(2)}</span>
              </div>
              {out.notes && <p className="text-[11px] text-white/50 mt-1">{out.notes}</p>}
            </div>
          ))}
        </div>
      </Card>
    );
  };

  const renderDimensionAnalysis = (analysis: TrialDetail["dimensionAnalysis"]) => {
    if (!analysis || Object.keys(analysis).length === 0) return null;
    return (
      <Card>
        <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">Dimension Analysis</h3>
        <div className="space-y-2">
          {Object.entries(analysis)
            .sort(([, a], [, b]) => b.predictivePower - a.predictivePower)
            .map(([dim, a]) => (
              <div key={dim} className="bg-ios-elevated rounded-lg p-2.5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium">{dim}</span>
                  <div className="flex gap-3 text-[10px] text-white/50 mt-0.5">
                    <span>Win avg: {a.avgScoreWinners.toFixed(1)}</span>
                    <span>Loss avg: {a.avgScoreLosers.toFixed(1)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-ios-gray">Predictive</p>
                  <p className={`text-sm font-bold ${
                    a.predictivePower >= 0.5 ? "text-ios-green" :
                    a.predictivePower >= 0.3 ? "text-ios-orange" : "text-ios-gray"
                  }`}>
                    {(a.predictivePower * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
            ))}
        </div>
      </Card>
    );
  };

  const renderOpusReview = (notes: string, reviewTrial?: number) => (
    <Card className="border border-ios-blue/30">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ios-blue/20 text-ios-blue">
          OPUS REVIEW
        </span>
        {reviewTrial && (
          <span className="text-[10px] text-ios-gray">Trial {reviewTrial}</span>
        )}
      </div>
      <p className="text-sm text-white/80 leading-relaxed whitespace-pre-line">{notes}</p>
    </Card>
  );

  const renderWeights = (weights: Record<string, number>, trialId: number) => {
    if (!weights || Object.keys(weights).length === 0) return null;
    return (
      <Card>
        <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-2">
          Weights (Trial {trialId})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(weights)
            .sort(([, a], [, b]) => b - a)
            .map(([dim, weight]) => (
              <span key={dim} className="text-[10px] px-2 py-1 rounded bg-ios-elevated text-white/80">
                {dim}: <span className="font-semibold">{(weight * 100).toFixed(0)}%</span>
              </span>
            ))}
        </div>
      </Card>
    );
  };

  /* ================================================================
     MAIN RENDER
     ================================================================ */

  return (
    <div className="px-4 pt-14 pb-28">
      {/* ---- Header ---- */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Morning Briefing</h1>
          <p className="text-sm text-ios-gray mt-1">
            {viewState === "detail" && selectedEntry
              ? formatDateLong(selectedEntry.date)
              : new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {viewState === "today" && (
            <>
              <button
                onClick={openHistory}
                className="text-ios-blue text-sm font-medium"
              >
                History
              </button>
              <button
                onClick={loadInitialData}
                disabled={loading}
                className="text-ios-blue text-sm font-medium disabled:opacity-50"
              >
                Refresh
              </button>
            </>
          )}
          {(viewState === "history" || viewState === "detail") && (
            <button
              onClick={backToToday}
              className="text-ios-blue text-sm font-medium"
            >
              Back to Today
            </button>
          )}
        </div>
      </div>

      {/* ---- LOADING STATE ---- */}
      {loading && viewState === "today" && (
        <Card className="mb-4">
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-2 border-ios-blue/30 border-t-ios-blue rounded-full animate-spin" />
            <span className="ml-3 text-sm text-ios-gray">Loading briefing...</span>
          </div>
        </Card>
      )}

      {/* ---- ERROR ---- */}
      {error && (
        <Card className="mb-4 border border-ios-red/30">
          <p className="text-ios-red text-sm">{error}</p>
        </Card>
      )}

      {/* ================================================================
         VIEW: TODAY
         ================================================================ */}
      {viewState === "today" && !loading && (
        <>
          {todayBriefing ? (
            <div className="space-y-3">
              {/* Summary */}
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <StatusBadge status={todayBriefing.marketCondition} size="md" />
                  <span className="text-xs text-ios-gray">
                    {new Date(todayBriefing.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>
                  {todayBriefing.model && (
                    <span className="text-[10px] text-ios-gray/60 ml-auto">
                      {todayBriefing.model.includes("opus") ? "Opus" : "Sonnet"}
                    </span>
                  )}
                </div>
                <p className="text-[15px] leading-relaxed text-white/90">{todayBriefing.summary}</p>
              </Card>

              {/* Accuracy */}
              {todayBriefing.accuracy && renderAccuracyCard(todayBriefing.accuracy)}

              {/* Regime */}
              {regime && renderRegimeCard(regime)}

              {/* Leading Indicators */}
              {regime?.leadingIndicators && renderLeadingIndicators(regime.leadingIndicators)}

              {/* Sections */}
              {renderSections(todayBriefing.sections || [])}

              {/* Trade Candidates */}
              {todayBriefing.recommendations && renderTradeCandidates(todayBriefing.recommendations)}

              {/* Watchlist */}
              {todayBriefing.watchlist && renderWatchlist(todayBriefing.watchlist)}

              {/* Avoid List */}
              {todayBriefing.avoidList && renderAvoidList(todayBriefing.avoidList)}

              {/* Scenarios */}
              {renderScenarios(todayBriefing.scenarios || [])}
            </div>
          ) : (
            /* Empty state */
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
        </>
      )}

      {/* ================================================================
         VIEW: HISTORY
         ================================================================ */}
      {viewState === "history" && (
        <div className="space-y-4">
          {/* Filter tabs — iOS segmented control style */}
          <div className="flex bg-ios-elevated rounded-lg p-0.5">
            {(["all", "live", "training"] as HistoryFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setHistoryFilter(f)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  historyFilter === f
                    ? "bg-ios-card text-white shadow-sm"
                    : "text-ios-gray"
                }`}
              >
                {f === "all" ? "All" : f === "live" ? "Live" : "Training"}
              </button>
            ))}
          </div>

          {/* History list */}
          {!historyLoaded && (
            <Card>
              <div className="flex items-center justify-center py-6">
                <div className="w-6 h-6 border-2 border-ios-blue/30 border-t-ios-blue rounded-full animate-spin" />
                <span className="ml-2 text-sm text-ios-gray">Loading history...</span>
              </div>
            </Card>
          )}

          {historyLoaded && filteredHistory.length === 0 && (
            <Card>
              <p className="text-sm text-ios-gray text-center py-4">
                No {historyFilter === "all" ? "" : historyFilter + " "}briefings found.
              </p>
            </Card>
          )}

          {historyLoaded && filteredHistory.length > 0 && (
            <div className="space-y-px">
              {filteredHistory.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => selectHistoryEntry(entry)}
                  className="w-full text-left bg-ios-card p-3.5 first:rounded-t-ios last:rounded-b-ios border-b border-ios-separator last:border-b-0 active:bg-ios-elevated transition-colors"
                >
                  {/* Row 1: Date, regime, score */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{formatDate(entry.date)}</span>
                      {entry.regime && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${regimeBadgeClass(entry.regime)}`}>
                          {entry.regime.toUpperCase()}
                        </span>
                      )}
                      {entry.marketCondition && !entry.regime && (
                        <StatusBadge status={entry.marketCondition} />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.score != null && (
                        <span className={`text-lg font-bold ${scoreColor(entry.score)}`}>
                          {typeof entry.score === "number" ? (Number.isInteger(entry.score) ? entry.score : entry.score.toFixed(1)) : entry.score}
                        </span>
                      )}
                      <svg className="w-4 h-4 text-ios-gray" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>

                  {/* Row 2: Summary preview */}
                  {entry.summary && (
                    <p className="text-xs text-white/60 line-clamp-1 mb-1.5">{entry.summary}</p>
                  )}

                  {/* Row 3: Stats + badges */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[11px] text-white/50">{entry.numRecs} recs</span>
                    {entry.winRate != null && (
                      <span className="text-[11px] text-white/50">
                        {(entry.winRate * 100).toFixed(0)}% win
                      </span>
                    )}
                    {entry.source === "training" && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ios-orange/20 text-ios-orange">
                        TRAINING
                      </span>
                    )}
                    {entry.hasOpusReview && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ios-blue/20 text-ios-blue">
                        OPUS
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================
         VIEW: DETAIL
         ================================================================ */}
      {viewState === "detail" && (
        <div className="space-y-3">
          {/* Loading */}
          {loadingDetail && (
            <Card>
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-2 border-ios-blue/30 border-t-ios-blue rounded-full animate-spin" />
                <span className="ml-3 text-sm text-ios-gray">Loading detail...</span>
              </div>
            </Card>
          )}

          {/* --- Live briefing detail --- */}
          {!loadingDetail && selectedEntry?.source === "live" && selectedBriefing && (
            <>
              {/* Summary */}
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <StatusBadge status={selectedBriefing.marketCondition} size="md" />
                  <span className="text-xs text-ios-gray">
                    {new Date(selectedBriefing.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>
                  {selectedBriefing.model && (
                    <span className="text-[10px] text-ios-gray/60 ml-auto">
                      {selectedBriefing.model.includes("opus") ? "Opus" : "Sonnet"}
                    </span>
                  )}
                </div>
                <p className="text-[15px] leading-relaxed text-white/90">{selectedBriefing.summary}</p>
              </Card>

              {/* Accuracy */}
              {selectedBriefing.accuracy && renderAccuracyCard(selectedBriefing.accuracy)}

              {/* Sections */}
              {renderSections(selectedBriefing.sections || [])}

              {/* Trade Candidates */}
              {selectedBriefing.recommendations && renderTradeCandidates(selectedBriefing.recommendations)}

              {/* Watchlist */}
              {selectedBriefing.watchlist && renderWatchlist(selectedBriefing.watchlist)}

              {/* Avoid List */}
              {selectedBriefing.avoidList && renderAvoidList(selectedBriefing.avoidList)}

              {/* Scenarios */}
              {renderScenarios(selectedBriefing.scenarios || [])}
            </>
          )}

          {/* --- Training trial detail --- */}
          {!loadingDetail && selectedEntry?.source === "training" && selectedTrialDetail && (
            <>
              {/* Header badges */}
              <Card>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ios-orange/20 text-ios-orange">
                    TRAINING
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${regimeBadgeClass(selectedTrialDetail.pipeline?.regime?.regime || "")}`}>
                    {(selectedTrialDetail.pipeline?.regime?.regime || "unknown").toUpperCase()}
                  </span>
                  {selectedTrialDetail.opusReviewNotes && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ios-blue/20 text-ios-blue">
                      OPUS REVIEWED
                    </span>
                  )}
                  <span className="ml-auto text-xs text-ios-gray">Trial {selectedTrialDetail.trialId}</span>
                </div>

                {/* Total score */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">Total Score</span>
                  <span className={`text-2xl font-bold ${scoreColor(selectedTrialDetail.scores.totalScore)}`}>
                    {selectedTrialDetail.scores.totalScore.toFixed(1)}
                  </span>
                </div>
                <div className="w-full bg-ios-gray-3 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${scoreBgColor(selectedTrialDetail.scores.totalScore)}`}
                    style={{ width: `${Math.min(100, selectedTrialDetail.scores.totalScore)}%` }}
                  />
                </div>
              </Card>

              {/* Scores grid */}
              {renderTrialScores(selectedTrialDetail.scores)}

              {/* Briefing Summary */}
              {selectedTrialDetail.pipeline?.briefing && (
                <Card>
                  <div className="flex items-center gap-2 mb-3">
                    <StatusBadge status={selectedTrialDetail.pipeline.briefing.marketCondition} size="md" />
                  </div>
                  <p className="text-[15px] leading-relaxed text-white/90">
                    {selectedTrialDetail.pipeline.briefing.summary}
                  </p>
                </Card>
              )}

              {/* Briefing Sections */}
              {selectedTrialDetail.pipeline?.briefing?.sections &&
                renderSections(selectedTrialDetail.pipeline.briefing.sections as BriefingSection[])}

              {/* Scenarios */}
              {selectedTrialDetail.pipeline?.briefing?.scenarios &&
                renderScenarios(selectedTrialDetail.pipeline.briefing.scenarios as ScenarioAnalysis[])}

              {/* Recommendations */}
              {renderRecommendations(selectedTrialDetail.recommendations)}

              {/* Outcomes */}
              {renderOutcomes(selectedTrialDetail.outcomes)}

              {/* Dimension Analysis */}
              {renderDimensionAnalysis(selectedTrialDetail.dimensionAnalysis)}

              {/* Revised Recommendations */}
              {selectedTrialDetail.revisedRecommendations &&
                selectedTrialDetail.revisedRecommendations.length > 0 &&
                renderRecommendations(selectedTrialDetail.revisedRecommendations, "OPUS REVISED")}

              {/* Opus Review Notes */}
              {selectedTrialDetail.opusReviewNotes &&
                renderOpusReview(selectedTrialDetail.opusReviewNotes, selectedTrialDetail.opusReviewTrial)}

              {/* Weights */}
              {renderWeights(selectedTrialDetail.weights, selectedTrialDetail.trialId)}
            </>
          )}

          {/* Not loaded or error state for detail */}
          {!loadingDetail && !selectedBriefing && !selectedTrialDetail && (
            <Card>
              <p className="text-sm text-ios-gray text-center py-4">
                No detail available for this entry.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
