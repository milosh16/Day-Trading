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

// Briefing generated for each training day
export interface TrainingBriefing {
  summary: string;
  marketCondition: "bullish" | "bearish" | "neutral" | "volatile";
  sections: { title: string; content: string; importance: "high" | "medium" | "low" }[];
  scenarios: { event: string; scenarios: { condition: string; implication: string; trade: string }[] }[];
}

// Regime classification for each training day
export interface TrainingRegime {
  regime: string;
  confidence: number;
  directionalBias: string;
  volatilityRegime: string;
  stressIndex: number;
  riskAppetiteIndex: number;
  sectorTilts: Record<string, string>;
}

export interface TrialResult {
  trialId: number;
  date: string;
  generatedAt: string;
  // Full pipeline outputs
  signals?: Record<string, unknown>;       // 100+ GlobalSignals fields
  regime?: TrainingRegime;                  // Regime classification
  briefing?: TrainingBriefing;              // Daily briefing
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
  // Opus-revised recommendations (populated after every 10-trial review)
  revisedRecommendations?: TradeRecommendation[];
  opusReviewNotes?: string;
}

// Full training day record — written to public/data/training/ for app display
export interface TrainingDayRecord {
  trialId: number;
  date: string;
  dateDisplay: string;
  generatedAt: string;
  pipeline: {
    signals: Record<string, unknown>;
    regime: TrainingRegime;
    briefing: TrainingBriefing;
  };
  recommendations: TradeRecommendation[];
  outcomes: RealOutcome[];
  scores: TrialResult["scores"];
  dimensionAnalysis: TrialResult["dimensionAnalysis"];
  weights: ConvictionWeights;
  revisedRecommendations?: TradeRecommendation[];
  opusReviewNotes?: string;
  opusReviewTrial?: number; // which Opus review batch this was part of
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
