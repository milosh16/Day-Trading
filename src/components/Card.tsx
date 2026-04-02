"use client";

import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Card({ children, className = "", onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-ios-card rounded-ios p-4 ${onClick ? "active:bg-ios-elevated transition-colors cursor-pointer" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider">
        {title}
      </h3>
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function StatusBadge({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const colorMap: Record<string, string> = {
    bullish: "bg-ios-green/20 text-ios-green",
    bearish: "bg-ios-red/20 text-ios-red",
    neutral: "bg-ios-gray/20 text-ios-gray",
    volatile: "bg-ios-orange/20 text-ios-orange",
    high: "bg-ios-red/20 text-ios-red",
    medium: "bg-ios-orange/20 text-ios-orange",
    low: "bg-ios-gray/20 text-ios-gray",
    filled: "bg-ios-green/20 text-ios-green",
    pending: "bg-ios-orange/20 text-ios-orange",
    cancelled: "bg-ios-gray/20 text-ios-gray",
    closed: "bg-ios-blue/20 text-ios-blue",
    recommended: "bg-ios-blue/20 text-ios-blue",
    A: "bg-ios-green/20 text-ios-green",
    B: "bg-ios-blue/20 text-ios-blue",
    C: "bg-ios-orange/20 text-ios-orange",
    D: "bg-ios-red/20 text-ios-red",
    F: "bg-ios-red/20 text-ios-red",
  };

  const colors = colorMap[status] || "bg-ios-gray/20 text-ios-gray";
  const padding = size === "md" ? "px-3 py-1" : "px-2 py-0.5";
  const text = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <span className={`${colors} ${padding} ${text} font-semibold rounded-full inline-block`}>
      {status.toUpperCase()}
    </span>
  );
}

export function PnlDisplay({ value, percent }: { value: number; percent?: number }) {
  const positive = value >= 0;
  const color = positive ? "text-ios-green" : "text-ios-red";
  const sign = positive ? "+" : "";

  return (
    <span className={color}>
      {sign}${value.toFixed(2)}
      {percent !== undefined && (
        <span className="text-xs ml-1">({sign}{percent.toFixed(2)}%)</span>
      )}
    </span>
  );
}
