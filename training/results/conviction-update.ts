// Auto-generated from training Phase 2 (12 trials, 28 trades)
// Best score: 100/100 (Trial 12 — DeepSeek AI scare day)
// Generated at: 2026-04-03T02:00:00.000Z

export const CONVICTION_THRESHOLD = 72;

export const DIMENSION_WEIGHTS = {
  catalystClarity: 0.250,    // +5%: strongest absolute predictor of direction accuracy
  technicalSetup: 0.100,     // -5%: noise on catalyst days, only useful on calm earnings
  riskReward: 0.150,         // unchanged: stable hygiene factor
  volumeLiquidity: 0.100,    // unchanged: pure risk filter
  marketAlignment: 0.100,    // -5%: context-dependent, often inverse on earnings days
  informationEdge: 0.150,    // unchanged: powerful when real asymmetry exists
  timingUrgency: 0.150,      // +5%: strongest timing signal, 85+ → near-100% win rate
} as const;
