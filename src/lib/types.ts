// ============================================================
// SIGNAL - Core Type Definitions
// ============================================================

// --- Conviction Algorithm Types ---

export interface ConvictionDimension {
  name: string;
  score: number; // 0-100
  weight: number; // 0-1, all weights sum to 1
  reasoning: string;
}

export interface ConvictionScore {
  total: number; // 0-100 weighted composite
  dimensions: ConvictionDimension[];
  grade: "A" | "B" | "C" | "D" | "F";
  passesThreshold: boolean;
}

// --- Trade Types ---

export type AssetClass = "equity" | "etf" | "crypto";
export type TradeDirection = "long" | "short";
export type TradeStatus = "recommended" | "pending" | "filled" | "partial" | "cancelled" | "closed";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";

export interface TradeRecommendation {
  id: string;
  timestamp: string;
  symbol: string;
  assetClass: AssetClass;
  direction: TradeDirection;
  thesis: string;
  catalyst: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  positionSizeDollars: number;
  positionSizePercent: number;
  conviction: ConvictionScore;
  rewardRiskRatio: number;
  status: TradeStatus;
  scenarioAnalysis?: string;
}

export interface Trade {
  id: string;
  recommendationId?: string;
  symbol: string;
  assetClass: AssetClass;
  direction: TradeDirection;
  side: OrderSide;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  notional: number;
  targetPrice: number;
  stopLoss: number;
  conviction: ConvictionScore;
  thesis: string;
  status: TradeStatus;
  alpacaOrderId?: string;
  entryTimestamp: string;
  exitTimestamp?: string;
  pnl?: number;
  pnlPercent?: number;
}

// --- Position Types ---

export interface Position {
  symbol: string;
  qty: number;
  side: string;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  currentPrice: number;
  avgEntryPrice: number;
  assetClass: AssetClass;
  targetPrice?: number;
  stopLoss?: number;
  trade?: Trade;
}

// --- Account Types ---

export interface AccountInfo {
  equity: number;
  cash: number;
  buyingPower: number;
  portfolioValue: number;
  dayTradeCount: number;
  patternDayTrader: boolean;
  tradingBlocked: boolean;
  accountBlocked: boolean;
}

// --- Briefing Types ---

export interface MarketBriefing {
  id: string;
  timestamp: string;
  summary: string;
  sections: BriefingSection[];
  scenarios: ScenarioAnalysis[];
  marketCondition: "bullish" | "bearish" | "neutral" | "volatile";
}

export interface BriefingSection {
  title: string;
  content: string;
  importance: "high" | "medium" | "low";
}

export interface ScenarioAnalysis {
  event: string;
  scenarios: {
    condition: string;
    implication: string;
    trade: string;
  }[];
}

// --- Performance Types ---

export interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalPnl: number;
  totalReturn: number;
  sp500Return: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentStreak: number;
  bestTrade: number;
  worstTrade: number;
}

// --- Backtest Types ---

export interface BacktestResult {
  id: string;
  timestamp: string;
  parameters: BacktestParameters;
  metrics: PerformanceMetrics;
  equityCurve: { day: number; equity: number; sp500: number }[];
  tradeLog: BacktestTrade[];
}

export interface BacktestParameters {
  days: number;
  initialCapital: number;
  convictionThreshold: number;
  maxPositionPercent: number;
  maxExposurePercent: number;
  maxLossPerTrade: number;
  dailyLossHalt: number;
  minRewardRisk: number;
  avgTradesPerDay: number;
  winRate: number;
  avgWinPercent: number;
  avgLossPercent: number;
}

export interface BacktestTrade {
  day: number;
  symbol: string;
  direction: TradeDirection;
  conviction: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  won: boolean;
}

export interface BacktestIteration {
  iteration: number;
  parameters: BacktestParameters;
  metrics: PerformanceMetrics;
}

// --- Settings Types ---

export interface AlpacaKeys {
  apiKey: string;
  secretKey: string;
  paperTrading: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  ntfyTopic: string;
  alertOnStopHit: boolean;
  alertOnTargetHit: boolean;
  alertOnBriefing: boolean;
}

export interface AppSettings {
  alpacaKeys: AlpacaKeys | null;
  notifications: NotificationSettings;
  dailyLossHaltActive: boolean;
  dailyLossHaltResetDate: string | null;
}

// --- Risk Management Types ---

export interface RiskCheck {
  passed: boolean;
  rule: string;
  message: string;
  value?: number;
  limit?: number;
}

export interface RiskAssessment {
  approved: boolean;
  checks: RiskCheck[];
  adjustedPositionSize?: number;
}

// --- API Response Types ---

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
