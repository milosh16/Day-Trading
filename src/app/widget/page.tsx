"use client";

import { useState, useEffect } from "react";
import { useTradesStore, usePortfolioStore } from "@/lib/store";

// Standalone widget page - no navigation bar
// Add to Home Screen as a shortcut for quick glance
export default function WidgetPage() {
  const { recommendations, trades } = useTradesStore();
  const { positions } = usePortfolioStore();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  // Market status in ET
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const etTime = etFormatter.format(time);

  const etDate = new Date(time.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = etDate.getHours();
  const minutes = etDate.getMinutes();
  const dayOfWeek = etDate.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const marketMinutes = hours * 60 + minutes;
  const isMarketOpen = isWeekday && marketMinutes >= 570 && marketMinutes < 960;
  const isPreMarket = isWeekday && marketMinutes >= 240 && marketMinutes < 570;

  const activeSignals = recommendations.filter((r) => r.status === "recommended");
  const openPositions = positions.length;
  const activeTrades = trades.filter((t) => t.status === "pending" || t.status === "filled");

  // Determine beacon state
  let level: string;
  let color: string;
  let message: string;
  let pulseAnimation = false;

  if (!isWeekday || (!isMarketOpen && !isPreMarket)) {
    level = "CLOSED";
    color = "#48484A";
    message = "Markets closed";
  } else if (activeSignals.length > 0) {
    level = "SIGNAL";
    color = "#0A84FF";
    message = `${activeSignals.length} high-conviction setup${activeSignals.length > 1 ? "s" : ""}`;
    pulseAnimation = true;
  } else if (openPositions > 0) {
    level = "WATCHING";
    color = "#FF9F0A";
    message = `Monitoring ${openPositions} position${openPositions > 1 ? "s" : ""}`;
  } else if (isPreMarket) {
    level = "PRE-MARKET";
    color = "#FFD60A";
    message = "Awaiting market open";
  } else {
    level = "CLEAR";
    color = "#30D158";
    message = "No setups - patience is edge";
  }

  return (
    <div className="min-h-screen bg-ios-black flex flex-col items-center justify-center px-8 select-none">
      {/* Ambient glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 40%, ${color}11 0%, transparent 60%)`,
        }}
      />

      {/* Beacon */}
      <div className="relative mb-10">
        {/* Outer pulse ring */}
        {pulseAnimation && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              width: 160,
              height: 160,
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              border: `2px solid ${color}`,
              opacity: 0.2,
              animation: "ping 2s cubic-bezier(0, 0, 0.2, 1) infinite",
            }}
          />
        )}
        {/* Mid ring */}
        <div
          className="w-28 h-28 rounded-full flex items-center justify-center mx-auto"
          style={{
            background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
            boxShadow: `0 0 80px ${color}22`,
          }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: `radial-gradient(circle, ${color}44 0%, ${color}11 100%)`,
            }}
          >
            <div
              className="w-8 h-8 rounded-full"
              style={{
                backgroundColor: color,
                boxShadow: `0 0 30px ${color}88, 0 0 60px ${color}44`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Level */}
      <h1
        className="text-4xl font-bold tracking-tight mb-2"
        style={{ color }}
      >
        {level}
      </h1>
      <p className="text-sm text-ios-gray mb-10 text-center">{message}</p>

      {/* Counters - no confidential data */}
      <div className="flex gap-8 mb-10">
        {[
          { n: activeSignals.length, label: "SIGNALS" },
          { n: openPositions, label: "POSITIONS" },
          { n: activeTrades.length, label: "ORDERS" },
        ].map(({ n, label }) => (
          <div key={label} className="text-center">
            <p className="text-3xl font-bold tabular-nums">{n}</p>
            <p className="text-[9px] text-ios-gray-2 tracking-widest mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Market indicator */}
      <div className="flex items-center gap-2 mb-6">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: isMarketOpen ? "#30D158" : isPreMarket ? "#FF9F0A" : "#48484A" }}
        />
        <span className="text-[11px] text-ios-gray-2">
          {isMarketOpen ? "Market Open" : isPreMarket ? "Pre-Market" : "Market Closed"} / {etTime} ET
        </span>
      </div>

      {/* Top signal preview - symbol only, no amounts */}
      {activeSignals.length > 0 && (
        <a href="/trades" className="w-full max-w-xs">
          <div className="bg-ios-card/60 rounded-ios p-4 border border-ios-separator/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{activeSignals[0].symbol}</span>
                <span className={`text-xs font-semibold ${activeSignals[0].direction === "long" ? "text-ios-green" : "text-ios-red"}`}>
                  {activeSignals[0].direction.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-lg font-bold text-ios-blue">{activeSignals[0].conviction.total.toFixed(0)}</span>
                <span className="text-[10px] text-ios-gray">/100</span>
              </div>
            </div>
            <p className="text-xs text-ios-gray leading-relaxed line-clamp-2">
              {activeSignals[0].thesis}
            </p>
            <p className="text-[10px] text-ios-blue font-medium mt-2">
              Tap to view details
            </p>
          </div>
        </a>
      )}

      {/* Branding */}
      <div className="fixed bottom-8 flex flex-col items-center">
        <p className="text-[9px] text-ios-gray-3 tracking-[0.3em] uppercase">SIGNAL</p>
      </div>

      <style jsx>{`
        @keyframes ping {
          75%, 100% {
            transform: translate(-50%, -50%) scale(2);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
