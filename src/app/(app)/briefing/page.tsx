"use client";

import { useState, useEffect } from "react";
import Card, { StatusBadge } from "@/components/Card";
import type { MarketBriefing, BriefingSection, ScenarioAnalysis } from "@/lib/types";

const LOADING_STEPS = [
  "Connecting to Claude...",
  "Searching market futures...",
  "Scanning economic calendar...",
  "Analyzing VIX and yields...",
  "Checking sector performance...",
  "Reviewing breaking news...",
  "Compiling briefing...",
];

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [loadingStep, setLoadingStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [historyBriefing, setHistoryBriefing] = useState<StoredBriefing | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Try to load latest briefing from KV on mount
  useEffect(() => {
    loadLatestBriefing();
  }, []);

  // Animated loading steps
  useEffect(() => {
    if (!loading) { setLoadingStep(0); setElapsed(0); return; }
    const stepInterval = setInterval(() => {
      setLoadingStep((s) => (s < LOADING_STEPS.length - 1 ? s + 1 : s));
    }, 8000);
    const timerInterval = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    return () => { clearInterval(stepInterval); clearInterval(timerInterval); };
  }, [loading]);

  const loadLatestBriefing = async () => {
    try {
      const res = await fetch("/api/briefing");
      if (res.ok) {
        const data: StoredBriefing = await res.json();
        setBriefing({
          id: data.id,
          timestamp: data.generatedAt,
          summary: data.summary,
          marketCondition: data.marketCondition,
          sections: data.sections,
          scenarios: data.scenarios,
        });
        setHistoryBriefing(data);
      }
    } catch {
      // KV not configured or no briefings — that's fine, user can generate on-demand
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
    } catch {
      // KV not available
    } finally {
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
          sections: data.sections,
          scenarios: data.scenarios,
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

  const generateBriefing = async () => {
    setLoading(true);
    setError(null);
    setShowHistory(false);
    setHistoryBriefing(null);
    setSelectedDate(null);

    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const response = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: `You are SIGNAL, an AI trading intelligence system. Today is ${dateStr}. Generate a comprehensive morning market briefing by searching for current market data. Be factual and concise. Do not use emojis.

You MUST use the web_search tool to find current, real-time market data. Search for multiple topics to build a complete picture.

Return your briefing as a JSON object with this exact structure:
{
  "summary": "2-3 sentence market overview",
  "marketCondition": "bullish" | "bearish" | "neutral" | "volatile",
  "sections": [
    { "title": "Section Title", "content": "Detailed content...", "importance": "high" | "medium" | "low" }
  ],
  "scenarios": [
    {
      "event": "Event name",
      "scenarios": [
        { "condition": "If X happens...", "implication": "Then Y...", "trade": "Consider Z..." }
      ]
    }
  ]
}

Sections to include:
1. Index Futures & Overnight Moves (importance: high)
2. Economic Calendar & Earnings (importance: high if major events, medium otherwise)
3. VIX / Yields / Dollar / Commodities / Crypto (importance: medium)
4. Sector Sentiment (importance: medium)
5. Breaking News & Key Developments (importance: high if significant)
6. Prediction Market Signals (importance: medium)

For EVERY high-importance event today, provide scenario analysis with at least 2 scenarios.

IMPORTANT: Wrap your final JSON in <json> tags like this: <json>{"summary": ...}</json>`,
          messages: [
            {
              role: "user",
              content: "Generate today's morning market briefing. Search for current market data, futures, economic calendar, earnings, VIX, yields, dollar index, commodities, crypto, sector performance, breaking news, and prediction market odds for key events.",
            },
          ],
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API ${response.status}: ${errText.slice(0, 300)}`);
      }

      // Read the SSE stream and extract text deltas
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let textContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const event = JSON.parse(payload);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              textContent += event.delta.text;
            }
          } catch {
            // skip unparseable SSE lines
          }
        }
      }

      if (!textContent) {
        throw new Error("No text content in response");
      }

      // Parse JSON from response
      const jsonMatch = textContent.match(/<json>([\s\S]*?)<\/json>/);
      let briefingData;
      if (jsonMatch) {
        briefingData = JSON.parse(jsonMatch[1]);
      } else {
        const jsonStart = textContent.indexOf("{");
        const jsonEnd = textContent.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          briefingData = JSON.parse(textContent.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error("Could not parse briefing response");
        }
      }

      const marketBriefing: MarketBriefing = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        summary: briefingData.summary || "Market briefing generated.",
        sections: briefingData.sections || [],
        scenarios: briefingData.scenarios || [],
        marketCondition: briefingData.marketCondition || "neutral",
      };

      setBriefing(marketBriefing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate briefing");
    } finally {
      setLoading(false);
    }
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
        <button
          onClick={() => {
            setShowHistory(!showHistory);
            if (!showHistory && historyDates.length === 0) loadHistory();
          }}
          className="text-ios-blue text-sm font-medium"
        >
          {showHistory ? "Close" : "History"}
        </button>
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
              No history yet. Briefings are stored automatically when scheduled generation is active (requires Vercel KV).
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

      {/* Generate / Refresh Button */}
      <button
        onClick={generateBriefing}
        disabled={loading}
        className="w-full bg-ios-blue text-white font-semibold py-3.5 rounded-ios mb-6 active:opacity-80 transition-opacity disabled:opacity-50"
      >
        {loading ? "Analyzing Markets..." : briefing ? "Refresh Briefing" : "Generate Briefing"}
      </button>

      {/* Loading State */}
      {loading && (
        <Card className="mb-4">
          <div className="flex flex-col items-center py-4">
            <div className="relative w-16 h-16 mb-4">
              <svg className="spinner w-16 h-16" viewBox="0 0 50 50">
                <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(59,130,246,0.2)" strokeWidth="4" />
                <circle cx="25" cy="25" r="20" fill="none" stroke="#3B82F6" strokeWidth="4"
                  strokeDasharray="31.4 94.2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-[15px] font-medium text-white mb-1">
              {LOADING_STEPS[loadingStep]}
            </p>
            <p className="text-xs text-ios-gray">
              {elapsed}s elapsed
            </p>
            <div className="w-full mt-4 space-y-1.5">
              {LOADING_STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  {i < loadingStep ? (
                    <svg className="w-4 h-4 text-ios-green flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : i === loadingStep ? (
                    <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                      <div className="w-2 h-2 bg-ios-blue rounded-full pulse" />
                    </div>
                  ) : (
                    <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-ios-gray/40 rounded-full" />
                    </div>
                  )}
                  <span className={`text-xs ${i < loadingStep ? "text-ios-green" : i === loadingStep ? "text-white" : "text-ios-gray/50"}`}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
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
            Tap Generate Briefing for today&apos;s market analysis, or check History for previous days
          </p>
        </div>
      )}
    </div>
  );
}
