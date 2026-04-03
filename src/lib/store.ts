// ============================================================
// SIGNAL - Zustand State Management
// ============================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect } from "react";
import {
  TradeRecommendation,
  Trade,
  MarketBriefing,
  AccountInfo,
  Position,
  AppSettings,
  BacktestResult,
  BacktestIteration,
  PerformanceMetrics,
} from "./types";

// --- Hydration-safe hook for SSR ---
// Prevents hydration mismatch when persisted stores load from localStorage
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  return hydrated;
}

// --- Settings Store (persisted to localStorage) ---
interface SettingsState {
  settings: AppSettings;
  updateAlpacaKeys: (keys: AppSettings["alpacaKeys"]) => void;
  updateNotifications: (n: AppSettings["notifications"]) => void;
  setDailyLossHalt: (active: boolean, resetDate?: string) => void;
  clearSettings: () => void;
}

const defaultSettings: AppSettings = {
  alpacaKeys: null,
  notifications: {
    enabled: false,
    ntfyTopic: "",
    alertOnStopHit: true,
    alertOnTargetHit: true,
    alertOnBriefing: false,
  },
  dailyLossHaltActive: false,
  dailyLossHaltResetDate: null,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      updateAlpacaKeys: (keys) =>
        set((s) => ({ settings: { ...s.settings, alpacaKeys: keys } })),
      updateNotifications: (n) =>
        set((s) => ({ settings: { ...s.settings, notifications: n } })),
      setDailyLossHalt: (active, resetDate) =>
        set((s) => ({
          settings: {
            ...s.settings,
            dailyLossHaltActive: active,
            dailyLossHaltResetDate: resetDate || s.settings.dailyLossHaltResetDate,
          },
        })),
      clearSettings: () => set({ settings: defaultSettings }),
    }),
    { name: "signal-settings" }
  )
);

// --- Briefing Store ---
interface BriefingState {
  briefing: MarketBriefing | null;
  loading: boolean;
  error: string | null;
  setBriefing: (b: MarketBriefing | null) => void;
  setLoading: (l: boolean) => void;
  setError: (e: string | null) => void;
}

export const useBriefingStore = create<BriefingState>((set) => ({
  briefing: null,
  loading: false,
  error: null,
  setBriefing: (b) => set({ briefing: b, error: null }),
  setLoading: (l) => set({ loading: l }),
  setError: (e) => set({ error: e, loading: false }),
}));

// --- Trades Store (persisted) ---
interface TradesState {
  recommendations: TradeRecommendation[];
  trades: Trade[];
  loading: boolean;
  error: string | null;
  setRecommendations: (r: TradeRecommendation[]) => void;
  addTrade: (t: Trade) => void;
  updateTrade: (id: string, updates: Partial<Trade>) => void;
  setLoading: (l: boolean) => void;
  setError: (e: string | null) => void;
}

export const useTradesStore = create<TradesState>()(
  persist(
    (set) => ({
      recommendations: [],
      trades: [],
      loading: false,
      error: null,
      setRecommendations: (r) => set({ recommendations: r, error: null }),
      addTrade: (t) => set((s) => ({ trades: [...s.trades, t] })),
      updateTrade: (id, updates) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),
      setLoading: (l) => set({ loading: l }),
      setError: (e) => set({ error: e, loading: false }),
    }),
    { name: "signal-trades" }
  )
);

// --- Portfolio Store ---
interface PortfolioState {
  account: AccountInfo | null;
  positions: Position[];
  startOfDayEquity: number;
  loading: boolean;
  error: string | null;
  setAccount: (a: AccountInfo | null) => void;
  setPositions: (p: Position[]) => void;
  setStartOfDayEquity: (e: number) => void;
  setLoading: (l: boolean) => void;
  setError: (e: string | null) => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  account: null,
  positions: [],
  startOfDayEquity: 0,
  loading: false,
  error: null,
  setAccount: (a) => set({ account: a }),
  setPositions: (p) => set({ positions: p }),
  setStartOfDayEquity: (e) => set({ startOfDayEquity: e }),
  setLoading: (l) => set({ loading: l }),
  setError: (e) => set({ error: e, loading: false }),
}));

// --- Performance Store (persisted) ---
interface PerformanceState {
  metrics: PerformanceMetrics | null;
  setMetrics: (m: PerformanceMetrics) => void;
}

export const usePerformanceStore = create<PerformanceState>()(
  persist(
    (set) => ({
      metrics: null,
      setMetrics: (m) => set({ metrics: m }),
    }),
    { name: "signal-performance" }
  )
);

// --- Backtest Store (persisted) ---
interface BacktestState {
  result: BacktestResult | null;
  iterations: BacktestIteration[];
  running: boolean;
  progress: number;
  setResult: (r: BacktestResult | null) => void;
  setIterations: (i: BacktestIteration[]) => void;
  setRunning: (r: boolean) => void;
  setProgress: (p: number) => void;
}

export const useBacktestStore = create<BacktestState>()(
  persist(
    (set) => ({
      result: null,
      iterations: [],
      running: false,
      progress: 0,
      setResult: (r) => set({ result: r }),
      setIterations: (i) => set({ iterations: i }),
      setRunning: (r) => set({ running: r }),
      setProgress: (p) => set({ progress: p }),
    }),
    { name: "signal-backtest" }
  )
);
