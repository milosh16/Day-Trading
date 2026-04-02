"use client";

import { useState } from "react";
import { useBacktestStore } from "@/lib/store";
import { runBacktestOptimization } from "@/lib/backtest";
import Card, { PnlDisplay } from "@/components/Card";

export default function BacktestPage() {
  const { result, iterations, running, progress, setResult, setIterations, setRunning, setProgress } = useBacktestStore();
  const [showIterations, setShowIterations] = useState(false);

  const runBacktest = () => {
    setRunning(true);
    setProgress(0);

    // Run in a setTimeout to avoid blocking UI
    setTimeout(() => {
      const { best, iterations: iters } = runBacktestOptimization((current, total) => {
        setProgress(Math.round((current / total) * 100));
      });

      setResult(best);
      setIterations(iters);
      setRunning(false);
    }, 50);
  };

  // Build SVG equity curve
  const renderEquityCurve = () => {
    if (!result || result.equityCurve.length < 2) return null;

    const data = result.equityCurve;
    const width = 340;
    const height = 180;
    const padding = { top: 10, right: 10, bottom: 25, left: 45 };

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const allValues = data.flatMap((d) => [d.equity, d.sp500]);
    const minVal = Math.min(...allValues) * 0.95;
    const maxVal = Math.max(...allValues) * 1.05;
    const xScale = (i: number) => padding.left + (i / (data.length - 1)) * chartW;
    const yScale = (v: number) => padding.top + chartH - ((v - minVal) / (maxVal - minVal)) * chartH;

    const equityPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(d.equity).toFixed(1)}`).join(" ");
    const sp500Path = data.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(d.sp500).toFixed(1)}`).join(" ");

    // Y-axis labels
    const yLabels = [minVal, (minVal + maxVal) / 2, maxVal].map((v) => ({
      value: v,
      y: yScale(v),
      label: `$${(v / 1000).toFixed(1)}k`,
    }));

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* Grid lines */}
        {yLabels.map((l, i) => (
          <g key={i}>
            <line x1={padding.left} y1={l.y} x2={width - padding.right} y2={l.y} stroke="#38383A" strokeWidth="0.5" />
            <text x={padding.left - 4} y={l.y + 3} textAnchor="end" fill="#8E8E93" fontSize="8">{l.label}</text>
          </g>
        ))}

        {/* S&P 500 line */}
        <path d={sp500Path} fill="none" stroke="#636366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />

        {/* SIGNAL equity line */}
        <path d={equityPath} fill="none" stroke="#0A84FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Legend */}
        <line x1={padding.left} y1={height - 8} x2={padding.left + 15} y2={height - 8} stroke="#0A84FF" strokeWidth="2" />
        <text x={padding.left + 19} y={height - 5} fill="#0A84FF" fontSize="8" fontWeight="600">SIGNAL</text>
        <line x1={padding.left + 70} y1={height - 8} x2={padding.left + 85} y2={height - 8} stroke="#636366" strokeWidth="1.5" />
        <text x={padding.left + 89} y={height - 5} fill="#636366" fontSize="8">S&P 500</text>

        {/* X-axis labels */}
        <text x={padding.left} y={height - 16} fill="#8E8E93" fontSize="7">Day 1</text>
        <text x={width - padding.right} y={height - 16} textAnchor="end" fill="#8E8E93" fontSize="7">Day {data[data.length - 1].day}</text>
      </svg>
    );
  };

  return (
    <div className="px-4 pt-14">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Backtest</h1>
        <p className="text-sm text-ios-gray mt-1">Monte Carlo simulation of the conviction algorithm</p>
      </div>

      {/* Run Button */}
      <button
        onClick={runBacktest}
        disabled={running}
        className="w-full bg-ios-blue text-white font-semibold py-3.5 rounded-ios mb-6 active:opacity-80 transition-opacity disabled:opacity-50"
      >
        {running ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="spinner w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
            </svg>
            Optimizing... {progress}%
          </span>
        ) : (
          "Run Backtest (50 Iterations)"
        )}
      </button>

      {/* Disclaimer */}
      <Card className="mb-4 border border-ios-orange/20">
        <p className="text-xs text-ios-orange">
          This is a Monte Carlo simulation using realistic market return distributions. It is NOT a replay of historical events. Simulated results do not guarantee future performance.
        </p>
      </Card>

      {result && (
        <>
          {/* Equity Curve */}
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">
              Equity Curve (750 Days)
            </h3>
            {renderEquityCurve()}
          </Card>

          {/* Key Stats */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Card>
              <p className="text-xs text-ios-gray">Total Return</p>
              <p className="text-lg font-bold mt-1">
                <PnlDisplay value={result.metrics.totalReturn} />
                <span className="text-xs text-ios-gray">%</span>
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">S&P 500 Return</p>
              <p className="text-lg font-bold mt-1">
                <PnlDisplay value={result.metrics.sp500Return} />
                <span className="text-xs text-ios-gray">%</span>
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Sharpe Ratio</p>
              <p className="text-lg font-bold mt-1">{result.metrics.sharpeRatio.toFixed(2)}</p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Max Drawdown</p>
              <p className="text-lg font-bold text-ios-red mt-1">-{result.metrics.maxDrawdown.toFixed(1)}%</p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Win Rate</p>
              <p className="text-lg font-bold mt-1">{result.metrics.winRate.toFixed(1)}%</p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Total Trades</p>
              <p className="text-lg font-bold mt-1">{result.metrics.totalTrades}</p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Profit Factor</p>
              <p className="text-lg font-bold mt-1">{result.metrics.profitFactor.toFixed(2)}</p>
            </Card>
            <Card>
              <p className="text-xs text-ios-gray">Total P&L</p>
              <p className="text-sm font-bold mt-1">
                <PnlDisplay value={result.metrics.totalPnl} />
              </p>
            </Card>
          </div>

          {/* Optimized Parameters */}
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-3">
              Optimized Parameters
            </h3>
            <div className="space-y-2">
              {[
                { label: "Conviction Threshold", value: result.parameters.convictionThreshold.toFixed(0) },
                { label: "Avg Trades/Day", value: result.parameters.avgTradesPerDay.toFixed(2) },
                { label: "Win Rate", value: `${(result.parameters.winRate * 100).toFixed(1)}%` },
                { label: "Avg Win", value: `${result.parameters.avgWinPercent.toFixed(2)}%` },
                { label: "Avg Loss", value: `${result.parameters.avgLossPercent.toFixed(2)}%` },
                { label: "Max Position", value: `${result.parameters.maxPositionPercent.toFixed(0)}%` },
                { label: "Min R:R", value: `${result.parameters.minRewardRisk.toFixed(2)}:1` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-sm text-ios-gray">{label}</span>
                  <span className="text-sm font-medium">{value}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Iteration History */}
          <button
            onClick={() => setShowIterations(!showIterations)}
            className="w-full text-center text-ios-blue text-sm font-medium py-3 mb-2"
          >
            {showIterations ? "Hide" : "Show"} All {iterations.length} Iterations
          </button>

          {showIterations && (
            <div className="space-y-1 mb-20">
              {iterations
                .sort((a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio)
                .map((iter, i) => (
                  <Card key={i} className="py-2.5 px-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-ios-gray w-6">#{i + 1}</span>
                        <span className="text-xs">
                          Sharpe: <span className="font-semibold">{iter.metrics.sharpeRatio.toFixed(2)}</span>
                        </span>
                        <span className="text-xs">
                          Return: <PnlDisplay value={iter.metrics.totalReturn} />%
                        </span>
                      </div>
                      <span className="text-xs text-ios-gray">
                        WR: {iter.metrics.winRate.toFixed(0)}%
                      </span>
                    </div>
                  </Card>
                ))}
            </div>
          )}
        </>
      )}

      {!result && !running && (
        <div className="flex flex-col items-center justify-center pt-16 text-center">
          <div className="w-16 h-16 rounded-full bg-ios-card flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ios-gray">
              <path d="M4 20V10M10 20V4M16 20V14M22 20V8" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-1">No Backtest Results</h3>
          <p className="text-sm text-ios-gray max-w-[280px]">
            Run the backtest to simulate the conviction algorithm across 750 trading days with 50 parameter iterations
          </p>
        </div>
      )}
    </div>
  );
}
