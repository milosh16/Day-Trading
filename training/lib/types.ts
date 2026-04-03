// ============================================================
// Training - Type Definitions
// ============================================================

export interface TradeRecommendation {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  thesis: string;
  catalyst: string;
  conviction: {
    catalystClarity: { score: number; reasoning: string };
    technicalSetup: { score: number; reasoning: string };
    riskReward: { score: number; reasoning: string };
    volumeLiquidity: { score: number; reasoning: string };
    marketAlignment: { score: number; reasoning: string };
    informationEdge: { score: number; reasoning: string };
    timingUrgency: { score: number; reasoning: string };
  };
}

export interface RealOutcome {
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

export interface TrialResult {
  trialId: number;
  date: string;
  generatedAt: string;
  recommendations: TradeRecommendation[];
  outcomes: RealOutcome[];
  scores: {
    directionAccuracy: number;       // % of trades where direction was correct
    targetHitRate: number;            // % of trades that hit target
    stopHitRate: number;              // % of trades that hit stop
    avgReturnPercent: number;         // average actual return
    profitFactor: number;             // gross profit / gross loss
    winRate: number;                  // % of trades with positive return
    totalScore: number;               // composite 0-100
  };
  dimensionAnalysis: {
    [key: string]: {
      avgScoreWinners: number;
      avgScoreLosers: number;
      predictivePower: number;  // correlation with actual outcomes
    };
  };
  weights: ConvictionWeights;
  totalTokensUsed: number;
}

export interface ConvictionWeights {
  catalystClarity: number;
  technicalSetup: number;
  riskReward: number;
  volumeLiquidity: number;
  marketAlignment: number;
  informationEdge: number;
  timingUrgency: number;
}

export interface TrainingState {
  currentTrial: number;
  totalTrials: number;
  weights: ConvictionWeights;
  results: TrialResult[];
  bestScore: number;
  bestWeights: ConvictionWeights;
  startedAt: string;
  lastUpdatedAt: string;
  totalTokensUsed: number;
  weightHistory: {
    trial: number;
    weights: ConvictionWeights;
    score: number;
  }[];
}
