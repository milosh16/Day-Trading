"use client";

import { useState } from "react";
import { useTradesStore, usePortfolioStore, useSettingsStore } from "@/lib/store";
import { buildConvictionPrompt, calculateConviction, convictionToPositionPercent, CONVICTION_THRESHOLD } from "@/lib/conviction";
import { assessTradeRisk, RISK_RULES } from "@/lib/risk";
import Card, { StatusBadge, PnlDisplay } from "@/components/Card";
import type { TradeRecommendation, Trade, ConvictionScore, Position } from "@/lib/types";
import type { DimensionKey } from "@/lib/conviction";


export default function TradesPage() {
  const { recommendations, trades, loading, error, setRecommendations, addTrade, setLoading, setError } = useTradesStore();
  const { account, positions } = usePortfolioStore();
  const { settings } = useSettingsStore();
  const [executing, setExecuting] = useState<string | null>(null);
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  const scanForTrades = async () => {
    setLoading(true);
    setError(null);

    try {
      const portfolioValue = account?.equity || 100;
      const cashAvailable = account?.cash || portfolioValue;

      const convictionPrompt = buildConvictionPrompt();
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
          system: `You are SIGNAL, an AI trading intelligence system. Today is ${dateStr}.
Portfolio size: $${portfolioValue.toFixed(2)}. Cash available: $${cashAvailable.toFixed(2)}.

Your job: scan markets for high-conviction trade setups. You MUST use web_search to find real-time data - current prices, news, catalysts, and technical levels.

CRITICAL RULES:
- There is NO limit on the number of recommendations. If 20 setups pass the conviction threshold, recommend all 20.
- If nothing looks compelling, return an empty array. Zero trades is a valid result.
- Do NOT fabricate or hallucinate trades. Every recommendation must be backed by real data from web search.
- Every trade MUST have a specific, imminent catalyst (not "could go up").
- Every trade MUST have exact entry price, target price, and stop loss based on REAL current prices.
- Minimum conviction threshold: ${CONVICTION_THRESHOLD}/100.
- Minimum reward:risk ratio: ${RISK_RULES.MIN_REWARD_RISK_RATIO}:1.
- Maximum position size: ${RISK_RULES.MAX_POSITION_PERCENT}% of portfolio.
- Maximum loss per trade: ${RISK_RULES.MAX_LOSS_PER_TRADE_PERCENT}% of portfolio.

${convictionPrompt}

Scan across: US equities, ETFs (including leveraged), and crypto available on Alpaca.

For each recommendation, return a JSON array wrapped in <json> tags:
<json>[
  {
    "symbol": "TICKER",
    "assetClass": "equity" | "etf" | "crypto",
    "direction": "long" | "short",
    "thesis": "1-2 sentence thesis (readable in 10 seconds)",
    "catalyst": "Specific catalyst driving this trade",
    "entryPrice": 123.45,
    "targetPrice": 135.00,
    "stopLoss": 118.00,
    "scenarioAnalysis": "If X then Y, if A then B",
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
              content: "Scan all liquid markets for high-conviction trade setups. Search for current prices, breaking news, earnings, economic data, technical levels, and any catalysts that could drive moves today. Be extremely selective - only recommend trades with genuine edge.",
            },
          ],
          max_tokens: 8192,
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
      let streamBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split("\n");
        streamBuffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              textContent += event.delta.text;
            }
          } catch { /* skip */ }
        }
      }

      const jsonMatch = textContent.match(/<json>([\s\S]*?)<\/json>/);
      let recsData: unknown[];
      if (jsonMatch) {
        recsData = JSON.parse(jsonMatch[1]);
      } else {
        const jsonStart = textContent.indexOf("[");
        const jsonEnd = textContent.lastIndexOf("]");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          recsData = JSON.parse(textContent.slice(jsonStart, jsonEnd + 1));
        } else {
          recsData = [];
        }
      }

      // Process recommendations through conviction algorithm and risk checks
      const processedRecs: TradeRecommendation[] = [];

      for (const rec of recsData as Record<string, unknown>[]) {
        const conviction: ConvictionScore = calculateConviction(
          rec.conviction as Record<DimensionKey, { score: number; reasoning: string }>
        );

        if (!conviction.passesThreshold) continue;

        const entryPrice = rec.entryPrice as number;
        const targetPrice = rec.targetPrice as number;
        const stopLoss = rec.stopLoss as number;
        const direction = rec.direction as "long" | "short";

        const positionPercent = convictionToPositionPercent(conviction.total);
        const positionSizeDollars = Math.min(
          portfolioValue * (positionPercent / 100),
          cashAvailable
        );

        // Calculate reward:risk ratio
        const risk = direction === "long" ? entryPrice - stopLoss : stopLoss - entryPrice;
        const reward = direction === "long" ? targetPrice - entryPrice : entryPrice - targetPrice;
        const rewardRiskRatio = risk > 0 ? reward / risk : 0;

        if (rewardRiskRatio < RISK_RULES.MIN_REWARD_RISK_RATIO) continue;

        // Run risk assessment
        const riskAssessment = assessTradeRisk({
          convictionScore: conviction.total,
          entryPrice,
          targetPrice,
          stopLoss,
          positionSizeDollars,
          direction,
          account: account || { equity: portfolioValue, cash: cashAvailable, buyingPower: cashAvailable, portfolioValue, dayTradeCount: 0, patternDayTrader: false, tradingBlocked: false, accountBlocked: false },
          existingPositions: positions,
          dailyPnl: 0,
          dailyLossHaltActive: settings.dailyLossHaltActive,
        });

        if (!riskAssessment.approved) {
          // Use adjusted position size if available
          if (riskAssessment.adjustedPositionSize) {
            processedRecs.push({
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              symbol: rec.symbol as string,
              assetClass: rec.assetClass as TradeRecommendation["assetClass"],
              direction,
              thesis: rec.thesis as string,
              catalyst: rec.catalyst as string,
              entryPrice,
              targetPrice,
              stopLoss,
              positionSizeDollars: riskAssessment.adjustedPositionSize,
              positionSizePercent: (riskAssessment.adjustedPositionSize / portfolioValue) * 100,
              conviction,
              rewardRiskRatio: Math.round(rewardRiskRatio * 100) / 100,
              status: "recommended",
              scenarioAnalysis: rec.scenarioAnalysis as string,
            });
          }
          continue;
        }

        processedRecs.push({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          symbol: rec.symbol as string,
          assetClass: rec.assetClass as TradeRecommendation["assetClass"],
          direction,
          thesis: rec.thesis as string,
          catalyst: rec.catalyst as string,
          entryPrice,
          targetPrice,
          stopLoss,
          positionSizeDollars,
          positionSizePercent: positionPercent,
          conviction,
          rewardRiskRatio: Math.round(rewardRiskRatio * 100) / 100,
          status: "recommended",
          scenarioAnalysis: rec.scenarioAnalysis as string,
        });
      }

      setRecommendations(processedRecs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan for trades");
    } finally {
      setLoading(false);
    }
  };

  const executeTrade = async (rec: TradeRecommendation) => {
    if (!settings.alpacaKeys) {
      setError("Connect Alpaca in Settings to execute trades");
      return;
    }

    setExecuting(rec.id);
    try {
      const orderBody: Record<string, unknown> = {
        symbol: rec.symbol,
        notional: rec.positionSizeDollars.toFixed(2),
        side: rec.direction === "long" ? "buy" : "sell",
        type: "market",
        time_in_force: "day",
      };

      const response = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-alpaca-key": settings.alpacaKeys.apiKey,
          "x-alpaca-secret": settings.alpacaKeys.secretKey,
          "x-alpaca-paper": String(settings.alpacaKeys.paperTrading),
        },
        body: JSON.stringify(orderBody),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `Order failed: ${response.status}`);
      }

      const orderData = await response.json();

      const trade: Trade = {
        id: crypto.randomUUID(),
        recommendationId: rec.id,
        symbol: rec.symbol,
        assetClass: rec.assetClass,
        direction: rec.direction,
        side: rec.direction === "long" ? "buy" : "sell",
        entryPrice: rec.entryPrice,
        quantity: 0,
        notional: rec.positionSizeDollars,
        targetPrice: rec.targetPrice,
        stopLoss: rec.stopLoss,
        conviction: rec.conviction,
        thesis: rec.thesis,
        status: "pending",
        alpacaOrderId: orderData.id,
        entryTimestamp: new Date().toISOString(),
      };

      addTrade(trade);

      // Update recommendation status
      setRecommendations(
        recommendations.map((r) =>
          r.id === rec.id ? { ...r, status: "pending" as const } : r
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div className="px-4 pt-14">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Trade Scanner</h1>
        <p className="text-sm text-ios-gray mt-1">
          High-conviction setups only
        </p>
      </div>

      {/* Scan Button */}
      <button
        onClick={scanForTrades}
        disabled={loading}
        className="w-full bg-ios-blue text-white font-semibold py-3.5 rounded-ios mb-6 active:opacity-80 transition-opacity disabled:opacity-50"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="spinner w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
            </svg>
            Scanning Markets...
          </span>
        ) : (
          "Scan for Trades"
        )}
      </button>

      {error && (
        <Card className="mb-4 border border-ios-red/30">
          <p className="text-ios-red text-sm">{error}</p>
        </Card>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-ios-gray uppercase tracking-wider px-1">
            {recommendations.length} Setup{recommendations.length !== 1 ? "s" : ""} Found
          </p>
          {recommendations.map((rec) => (
            <Card key={rec.id} className="space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{rec.symbol}</span>
                  <StatusBadge status={rec.conviction.grade} size="md" />
                  <span className={`text-xs font-semibold ${rec.direction === "long" ? "text-ios-green" : "text-ios-red"}`}>
                    {rec.direction.toUpperCase()}
                  </span>
                </div>
                <span className="text-2xl font-bold text-ios-blue">
                  {rec.conviction.total.toFixed(0)}
                </span>
              </div>

              {/* Thesis */}
              <p className="text-sm text-white/90 leading-relaxed">{rec.thesis}</p>

              {/* Key Numbers */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-ios-elevated rounded-lg p-2.5 text-center">
                  <p className="text-[11px] text-ios-gray mb-0.5">Entry</p>
                  <p className="text-sm font-semibold">${rec.entryPrice.toFixed(2)}</p>
                </div>
                <div className="bg-ios-elevated rounded-lg p-2.5 text-center">
                  <p className="text-[11px] text-ios-green mb-0.5">Target</p>
                  <p className="text-sm font-semibold text-ios-green">${rec.targetPrice.toFixed(2)}</p>
                </div>
                <div className="bg-ios-elevated rounded-lg p-2.5 text-center">
                  <p className="text-[11px] text-ios-red mb-0.5">Stop</p>
                  <p className="text-sm font-semibold text-ios-red">${rec.stopLoss.toFixed(2)}</p>
                </div>
              </div>

              {/* Position Info */}
              <div className="flex justify-between text-xs text-ios-gray">
                <span>Size: ${rec.positionSizeDollars.toFixed(2)} ({rec.positionSizePercent.toFixed(1)}%)</span>
                <span>R:R {rec.rewardRiskRatio.toFixed(1)}:1</span>
              </div>

              {/* Expand toggle */}
              <button
                onClick={() => setExpandedRec(expandedRec === rec.id ? null : rec.id)}
                className="text-xs text-ios-blue font-medium"
              >
                {expandedRec === rec.id ? "Hide Details" : "Show Details"}
              </button>

              {expandedRec === rec.id && (
                <div className="space-y-2 pt-1">
                  {/* Catalyst */}
                  <div className="bg-ios-elevated rounded-lg p-3">
                    <p className="text-[11px] text-ios-gray uppercase mb-1">Catalyst</p>
                    <p className="text-sm text-white/90">{rec.catalyst}</p>
                  </div>

                  {/* Scenario Analysis */}
                  {rec.scenarioAnalysis && (
                    <div className="bg-ios-elevated rounded-lg p-3">
                      <p className="text-[11px] text-ios-gray uppercase mb-1">Scenario Analysis</p>
                      <p className="text-sm text-white/80">{rec.scenarioAnalysis}</p>
                    </div>
                  )}

                  {/* Conviction Breakdown */}
                  <div className="bg-ios-elevated rounded-lg p-3">
                    <p className="text-[11px] text-ios-gray uppercase mb-2">Conviction Breakdown</p>
                    {rec.conviction.dimensions.map((dim, i) => (
                      <div key={i} className="mb-2 last:mb-0">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-white/70">{dim.name.split(" - ")[0]}</span>
                          <span className="font-semibold">{dim.score}</span>
                        </div>
                        <div className="w-full bg-ios-gray-3 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              dim.score >= 80
                                ? "bg-ios-green"
                                : dim.score >= 60
                                ? "bg-ios-blue"
                                : "bg-ios-orange"
                            }`}
                            style={{ width: `${dim.score}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-ios-gray mt-0.5">{dim.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Execute Button */}
              {rec.status === "recommended" && (
                <button
                  onClick={() => executeTrade(rec)}
                  disabled={executing === rec.id}
                  className="w-full bg-ios-green text-white font-semibold py-3 rounded-ios active:opacity-80 transition-opacity disabled:opacity-50"
                >
                  {executing === rec.id ? "Executing..." : `Execute ${rec.direction === "long" ? "Buy" : "Sell"} $${rec.positionSizeDollars.toFixed(2)}`}
                </button>
              )}
              {rec.status === "pending" && (
                <div className="text-center py-2 text-ios-orange text-sm font-medium">
                  Order Submitted
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Zero Recommendations */}
      {!loading && recommendations.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center pt-20 text-center">
          <div className="w-16 h-16 rounded-full bg-ios-card flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ios-gray">
              <path d="M2 20L8 14l4 4 10-12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-1">No Active Recommendations</h3>
          <p className="text-sm text-ios-gray max-w-[280px]">
            Tap Scan for Trades to search for high-conviction setups across all markets. Zero recommendations on a given day is fine.
          </p>
        </div>
      )}

      {/* Recent Trades */}
      {trades.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
            Recent Orders
          </h2>
          {trades.slice(-5).reverse().map((trade) => (
            <Card key={trade.id} className="mb-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold">{trade.symbol}</span>
                  <span className={`text-xs ml-2 ${trade.direction === "long" ? "text-ios-green" : "text-ios-red"}`}>
                    {trade.side.toUpperCase()}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">${trade.notional.toFixed(2)}</p>
                  <StatusBadge status={trade.status} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
