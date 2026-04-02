"use client";

import { useEffect, useState, useCallback } from "react";
import { usePortfolioStore, useSettingsStore, useTradesStore } from "@/lib/store";
import Card, { PnlDisplay, StatusBadge } from "@/components/Card";
import type { AccountInfo, Position } from "@/lib/types";

export default function PortfolioPage() {
  const { account, positions, loading, error, setAccount, setPositions, setLoading, setError } = usePortfolioStore();
  const { settings } = useSettingsStore();
  const { trades } = useTradesStore();
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const fetchPortfolio = useCallback(async () => {
    if (!settings.alpacaKeys) return;

    setLoading(true);
    setError(null);

    try {
      const headers = {
        "x-alpaca-key": settings.alpacaKeys.apiKey,
        "x-alpaca-secret": settings.alpacaKeys.secretKey,
        "x-alpaca-paper": String(settings.alpacaKeys.paperTrading),
      };

      const [accountRes, positionsRes] = await Promise.all([
        fetch("/api/alpaca/account", { headers }),
        fetch("/api/alpaca/positions", { headers }),
      ]);

      if (accountRes.ok) {
        const acct = await accountRes.json();
        const accountInfo: AccountInfo = {
          equity: parseFloat(acct.equity),
          cash: parseFloat(acct.cash),
          buyingPower: parseFloat(acct.buying_power),
          portfolioValue: parseFloat(acct.portfolio_value),
          dayTradeCount: acct.daytrade_count || 0,
          patternDayTrader: acct.pattern_day_trader || false,
          tradingBlocked: acct.trading_blocked || false,
          accountBlocked: acct.account_blocked || false,
        };
        setAccount(accountInfo);
      }

      if (positionsRes.ok) {
        const posData = await positionsRes.json();
        const mappedPositions: Position[] = posData.map((p: Record<string, string>) => {
          const matchedTrade = trades.find((t) => t.symbol === p.symbol && t.status !== "closed");
          return {
            symbol: p.symbol,
            qty: parseFloat(p.qty),
            side: p.side,
            marketValue: parseFloat(p.market_value),
            costBasis: parseFloat(p.cost_basis),
            unrealizedPnl: parseFloat(p.unrealized_pl),
            unrealizedPnlPercent: parseFloat(p.unrealized_plpc) * 100,
            currentPrice: parseFloat(p.current_price),
            avgEntryPrice: parseFloat(p.avg_entry_price),
            assetClass: p.asset_class === "crypto" ? "crypto" : "equity",
            targetPrice: matchedTrade?.targetPrice,
            stopLoss: matchedTrade?.stopLoss,
            trade: matchedTrade,
          };
        });
        setPositions(mappedPositions);
      }

      setLastRefresh(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch portfolio");
    } finally {
      setLoading(false);
    }
  }, [settings.alpacaKeys, trades, setAccount, setPositions, setLoading, setError]);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  // Monitor positions for stop/target hits
  useEffect(() => {
    if (!settings.notifications.enabled || !settings.notifications.ntfyTopic || positions.length === 0) return;

    const monitorPositions = positions
      .filter((p) => p.stopLoss || p.targetPrice)
      .map((p) => ({
        symbol: p.symbol,
        currentPrice: p.currentPrice,
        stopLoss: p.stopLoss,
        targetPrice: p.targetPrice,
      }));

    if (monitorPositions.length === 0) return;

    fetch("/api/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positions: monitorPositions,
        ntfyTopic: settings.notifications.ntfyTopic,
      }),
    }).catch(() => {});
  }, [positions, settings.notifications]);

  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalCost = positions.reduce((sum, p) => sum + p.costBasis, 0);
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return (
    <div className="px-4 pt-14">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
          {lastRefresh && (
            <p className="text-xs text-ios-gray mt-0.5">Updated {lastRefresh}</p>
          )}
        </div>
        <button
          onClick={fetchPortfolio}
          disabled={loading}
          className="text-ios-blue text-sm font-medium active:opacity-60"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {!settings.alpacaKeys ? (
        <Card className="text-center py-8">
          <p className="text-ios-gray mb-2">Alpaca not connected</p>
          <p className="text-sm text-ios-gray-2">Add your API keys in Settings to see your portfolio</p>
        </Card>
      ) : (
        <>
          {/* Account Summary */}
          {account && (
            <Card className="mb-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-ios-gray">Equity</p>
                  <p className="text-xl font-bold">${account.equity.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-ios-gray">Cash</p>
                  <p className="text-xl font-bold">${account.cash.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-ios-gray">Buying Power</p>
                  <p className="text-sm font-semibold">${account.buyingPower.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-ios-gray">Unrealized P&L</p>
                  <p className="text-sm font-semibold">
                    <PnlDisplay value={totalPnl} percent={totalPnlPercent} />
                  </p>
                </div>
              </div>
              {settings.dailyLossHaltActive && (
                <div className="mt-3 bg-ios-red/10 rounded-lg p-2 text-center">
                  <p className="text-xs text-ios-red font-medium">Daily Loss Halt Active - Trading Blocked</p>
                </div>
              )}
            </Card>
          )}

          {/* Positions */}
          {positions.length > 0 ? (
            <div>
              <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
                Open Positions ({positions.length})
              </h2>
              <div className="space-y-2">
                {positions.map((pos) => (
                  <Card key={pos.symbol}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-[15px] font-bold">{pos.symbol}</span>
                        <span className="text-xs text-ios-gray ml-2">
                          {pos.qty.toFixed(pos.qty % 1 !== 0 ? 4 : 0)} shares
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-[15px] font-bold">
                          <PnlDisplay value={pos.unrealizedPnl} percent={pos.unrealizedPnlPercent} />
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-ios-gray">
                      <span>Avg: ${pos.avgEntryPrice.toFixed(2)}</span>
                      <span>Now: ${pos.currentPrice.toFixed(2)}</span>
                      <span>Value: ${pos.marketValue.toFixed(2)}</span>
                    </div>
                    {(pos.stopLoss || pos.targetPrice) && (
                      <div className="flex gap-3 mt-2 pt-2 border-t border-ios-separator">
                        {pos.stopLoss && (
                          <span className="text-xs">
                            <span className="text-ios-red">Stop: ${pos.stopLoss.toFixed(2)}</span>
                            {pos.currentPrice <= pos.stopLoss && (
                              <span className="ml-1 text-ios-red font-bold">HIT</span>
                            )}
                          </span>
                        )}
                        {pos.targetPrice && (
                          <span className="text-xs">
                            <span className="text-ios-green">Target: ${pos.targetPrice.toFixed(2)}</span>
                            {pos.currentPrice >= pos.targetPrice && (
                              <span className="ml-1 text-ios-green font-bold">HIT</span>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            !loading && (
              <div className="flex flex-col items-center justify-center pt-16 text-center">
                <div className="w-16 h-16 rounded-full bg-ios-card flex items-center justify-center mb-4">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ios-gray">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-1">No Open Positions</h3>
                <p className="text-sm text-ios-gray">Execute a trade to see it here</p>
              </div>
            )
          )}

          {error && (
            <Card className="mt-4 border border-ios-red/30">
              <p className="text-ios-red text-sm">{error}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
