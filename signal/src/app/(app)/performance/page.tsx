"use client";

import { useMemo } from "react";
import { useTradesStore, usePerformanceStore } from "@/lib/store";
import Card, { PnlDisplay } from "@/components/Card";
import type { PerformanceMetrics } from "@/lib/types";

export default function PerformancePage() {
  const { trades } = useTradesStore();
  const { metrics, setMetrics } = usePerformanceStore();

  const computed = useMemo((): PerformanceMetrics | null => {
    const closedTrades = trades.filter((t) => t.status === "closed" && t.pnl !== undefined);
    if (closedTrades.length === 0) return null;

    const wins = closedTrades.filter((t) => (t.pnl || 0) > 0);
    const losses = closedTrades.filter((t) => (t.pnl || 0) <= 0);

    const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length) : 0;

    const totalWins = wins.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    let currentStreak = 0;
    for (let i = closedTrades.length - 1; i >= 0; i--) {
      const won = (closedTrades[i].pnl || 0) > 0;
      if (i === closedTrades.length - 1) {
        currentStreak = won ? 1 : -1;
      } else {
        const prevWon = (closedTrades[closedTrades.length - 1].pnl || 0) > 0;
        if (won === prevWon) {
          currentStreak += won ? 1 : -1;
        } else {
          break;
        }
      }
    }

    const m: PerformanceMetrics = {
      totalTrades: closedTrades.length,
      winRate: (wins.length / closedTrades.length) * 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalReturn: 0,
      sp500Return: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      currentStreak,
      bestTrade: Math.max(...closedTrades.map((t) => t.pnl || 0)),
      worstTrade: Math.min(...closedTrades.map((t) => t.pnl || 0)),
    };

    setMetrics(m);
    return m;
  }, [trades, setMetrics]);

  const displayMetrics = computed || metrics;
  const closedTrades = trades.filter((t) => t.status === "closed");

  return (
    <div className="px-4 pt-14">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Performance</h1>
        <p className="text-sm text-ios-gray mt-1">Trade history and statistics</p>
      </div>

      {displayMetrics ? (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Card>
              <p className="text-xs text-ios-gray">Total P&L</p>
              <p className="text-xl font-bold mt-1">
                <PnlDisplay value={displayMetrics.totalPnl} />
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Win Rate</p>
              <p className="text-xl font-bold mt-1">
                {displayMetrics.winRate.toFixed(1)}%
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Avg Win</p>
              <p className="text-lg font-bold text-ios-green mt-1">
                +${displayMetrics.avgWin.toFixed(2)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Avg Loss</p>
              <p className="text-lg font-bold text-ios-red mt-1">
                -${displayMetrics.avgLoss.toFixed(2)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Profit Factor</p>
              <p className="text-lg font-bold mt-1">{displayMetrics.profitFactor.toFixed(2)}</p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Total Trades</p>
              <p className="text-lg font-bold mt-1">{displayMetrics.totalTrades}</p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Best Trade</p>
              <p className="text-sm font-bold text-ios-green mt-1">
                +${displayMetrics.bestTrade.toFixed(2)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Worst Trade</p>
              <p className="text-sm font-bold text-ios-red mt-1">
                ${displayMetrics.worstTrade.toFixed(2)}
              </p>
            </Card>
          </div>

          {/* Streak */}
          <Card className="mb-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-ios-gray">Current Streak</p>
              <p className={`text-lg font-bold ${displayMetrics.currentStreak > 0 ? "text-ios-green" : displayMetrics.currentStreak < 0 ? "text-ios-red" : "text-ios-gray"}`}>
                {displayMetrics.currentStreak > 0 ? `${displayMetrics.currentStreak}W` : displayMetrics.currentStreak < 0 ? `${Math.abs(displayMetrics.currentStreak)}L` : "-"}
              </p>
            </div>
          </Card>
        </>
      ) : (
        <Card className="text-center py-8 mb-6">
          <p className="text-ios-gray">No closed trades yet</p>
          <p className="text-sm text-ios-gray-2 mt-1">Performance metrics will appear after your first completed trade</p>
        </Card>
      )}

      {/* Trade History */}
      <h2 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3 px-1">
        Trade History ({closedTrades.length})
      </h2>
      {closedTrades.length > 0 ? (
        <div className="space-y-2">
          {closedTrades.slice().reverse().map((trade) => (
            <Card key={trade.id}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold">{trade.symbol}</span>
                  <span className={`text-xs ml-2 ${trade.direction === "long" ? "text-ios-green" : "text-ios-red"}`}>
                    {trade.direction.toUpperCase()}
                  </span>
                  <span className="text-xs text-ios-gray ml-2">
                    Score: {trade.conviction.total.toFixed(0)}
                  </span>
                </div>
                <div className="text-right">
                  {trade.pnl !== undefined && (
                    <PnlDisplay value={trade.pnl} percent={trade.pnlPercent} />
                  )}
                </div>
              </div>
              <div className="flex justify-between text-xs text-ios-gray mt-1">
                <span>Entry: ${trade.entryPrice.toFixed(2)}</span>
                {trade.exitPrice && <span>Exit: ${trade.exitPrice.toFixed(2)}</span>}
                <span>{new Date(trade.entryTimestamp).toLocaleDateString()}</span>
              </div>
              <p className="text-xs text-white/60 mt-1 truncate">{trade.thesis}</p>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-sm text-ios-gray">No trades recorded yet</p>
        </div>
      )}
    </div>
  );
}
