// ============================================================
// SIGNAL - Conviction Scoring Algorithm
// ============================================================
// Evaluates trade quality across 7 independent dimensions.
// Minimum threshold: 72/100 (top ~30% of setups).
// No artificial cap on trade count - recommend all that pass threshold.
// ============================================================

import { ConvictionScore, ConvictionDimension, TradeDirection } from "./types";

export const CONVICTION_THRESHOLD = 72;

// Dimension weights (must sum to 1.0)
// Updated from training: 12 trials, 28 trades (Phase 2 summary)
const DIMENSION_WEIGHTS = {
  catalystClarity: 0.25,    // Strongest absolute predictor of direction accuracy
  technicalSetup: 0.10,     // Noise on catalyst days; only useful on calm earnings days
  riskReward: 0.15,         // Stable hygiene factor — consistent but never the differentiator
  volumeLiquidity: 0.10,    // Pure risk filter; inversely correlated with return on shorts
  marketAlignment: 0.10,    // Context-dependent: positive on macro days, inverse on earnings
  informationEdge: 0.15,    // Powerful when real data asymmetry exists
  timingUrgency: 0.15,      // Strongest timing signal; 85+ score → near-100% win rate
} as const;

export type DimensionKey = keyof typeof DIMENSION_WEIGHTS;

export const DIMENSION_DESCRIPTIONS: Record<DimensionKey, string> = {
  catalystClarity: "Catalyst Clarity - Specific event or data point driving the move",
  technicalSetup: "Technical Setup - Price action, levels, and pattern quality",
  riskReward: "Risk/Reward - Asymmetry of potential outcome vs. downside",
  volumeLiquidity: "Volume & Liquidity - Ability to enter and exit at desired prices",
  marketAlignment: "Market Alignment - Macro/sector/sentiment tailwinds",
  informationEdge: "Information Edge - Data advantage vs. current consensus",
  timingUrgency: "Timing Urgency - Why this trade must be taken now",
};

export interface ConvictionOptions {
  direction?: TradeDirection;
  catalystAgeHours?: number;
}

export function calculateConviction(
  dimensions: Record<DimensionKey, { score: number; reasoning: string }>,
  options?: ConvictionOptions,
): ConvictionScore {
  const scored: ConvictionDimension[] = Object.entries(dimensions).map(
    ([key, { score, reasoning }]) => {
      let adjustedScore = Math.max(0, Math.min(100, score));
      let weight = DIMENSION_WEIGHTS[key as DimensionKey];

      // timingUrgency decay: discount when catalyst is stale (>24h old)
      // Training insight: urgency 85+ → near-100% win rate, but only when fresh
      if (key === "timingUrgency" && options?.catalystAgeHours != null) {
        const age = options.catalystAgeHours;
        if (age > 24) {
          const decay = Math.max(0.5, 1 - (age - 24) / 48);
          adjustedScore = Math.round(adjustedScore * decay);
        }
      }

      return {
        name: DIMENSION_DESCRIPTIONS[key as DimensionKey],
        score: adjustedScore,
        weight,
        reasoning,
      };
    },
  );

  const total = scored.reduce((sum, d) => sum + d.score * d.weight, 0);
  const rounded = Math.round(total * 10) / 10;

  return {
    total: rounded,
    dimensions: scored,
    grade: getGrade(rounded),
    passesThreshold: rounded >= CONVICTION_THRESHOLD,
  };
}

function getGrade(score: number): ConvictionScore["grade"] {
  if (score >= 85) return "A";
  if (score >= 72) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

// Position sizing scales linearly with conviction above threshold
// At threshold (72): 15% of available capital
// At maximum (100): 50% of available capital (hard cap)
export function convictionToPositionPercent(convictionScore: number): number {
  if (convictionScore < CONVICTION_THRESHOLD) return 0;
  const range = 100 - CONVICTION_THRESHOLD;
  const above = convictionScore - CONVICTION_THRESHOLD;
  const percent = 15 + (above / range) * 35;
  return Math.min(50, Math.round(percent * 10) / 10);
}

// Build the conviction scoring prompt for Claude
export function buildConvictionPrompt(): string {
  const dimensionList = Object.entries(DIMENSION_WEIGHTS)
    .map(([key, weight]) => {
      const desc = DIMENSION_DESCRIPTIONS[key as DimensionKey];
      return `- ${desc} (weight: ${(weight * 100).toFixed(0)}%)`;
    })
    .join("\n");

  return `
Score each trade recommendation on these 7 dimensions (0-100 each):

${dimensionList}

CRITICAL RULES:
- Minimum threshold to recommend: ${CONVICTION_THRESHOLD}/100 weighted score
- If no setups reach ${CONVICTION_THRESHOLD}, return ZERO recommendations. Zero trades on a day is perfectly fine.
- There is NO cap on the number of recommendations. If 20 setups genuinely pass the threshold, recommend all 20.
- A score of 50 means "average/neutral" - NOT good enough to trade.
- A score of 70 means "above average but marginal" - borderline.
- A score of 80+ means "strong conviction across multiple dimensions."
- Do NOT inflate scores to fabricate recommendations. But do NOT suppress valid ones either.
- Every recommendation MUST have a specific catalyst (not "could go up").
- Every recommendation MUST have exact entry, target, and stop-loss prices.
- Single-stock day trade targets should be 3-5% from entry. ETF targets should be 1.5-2.5% (ETFs move less than individual stocks). Never use 8-15% targets for day trades.

TRAINING-DERIVED INSIGHTS (apply when scoring):
- Timing Urgency 85+ with a fresh catalyst (<24h) → near-100% historical win rate. Score high only when the window is truly NOW.
- On paradigm-shift or macro-shock days, Technical Setup is noise — weight it less mentally.
- Second-derivative plays (e.g., power stocks during an AI scare) often outperform the obvious direct target. Consider non-obvious beneficiaries/casualties.
- For SHORT trades, lower Volume/Liquidity can mean BIGGER moves (illiquid names gap harder in panics). Do not penalize shorts for moderate liquidity.
- Catalyst Clarity above 85 has diminishing returns — the "most obvious" trade often gets front-run in pre-market.

For each dimension, provide a 1-sentence reasoning.

Return your conviction scores as a JSON object with this structure:
{
  "catalystClarity": { "score": <number>, "reasoning": "<string>" },
  "technicalSetup": { "score": <number>, "reasoning": "<string>" },
  "riskReward": { "score": <number>, "reasoning": "<string>" },
  "volumeLiquidity": { "score": <number>, "reasoning": "<string>" },
  "marketAlignment": { "score": <number>, "reasoning": "<string>" },
  "informationEdge": { "score": <number>, "reasoning": "<string>" },
  "timingUrgency": { "score": <number>, "reasoning": "<string>" }
}
`;
}
