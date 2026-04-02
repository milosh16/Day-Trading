// ============================================================
// SIGNAL - Risk Management Engine
// ============================================================
// Programmatic enforcement of all risk rules.
// These are hard limits - the AI cannot override them.
// ============================================================

import { RiskAssessment, RiskCheck, AccountInfo, Trade, Position } from "./types";
import { CONVICTION_THRESHOLD } from "./conviction";

// Hard-coded risk parameters
export const RISK_RULES = {
  MIN_CONVICTION: CONVICTION_THRESHOLD,       // 72/100
  MAX_POSITION_PERCENT: 50,                   // 50% of portfolio per position
  MAX_EXPOSURE_PERCENT: 80,                   // 80% max invested (20% cash floor)
  MAX_LOSS_PER_TRADE_PERCENT: 3,              // 3% of portfolio max loss per trade
  DAILY_LOSS_HALT_PERCENT: 5,                 // 5% daily loss halts trading
  MIN_REWARD_RISK_RATIO: 1.3,                 // 1.3:1 minimum R:R
} as const;

export function assessTradeRisk(params: {
  convictionScore: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  positionSizeDollars: number;
  direction: "long" | "short";
  account: AccountInfo;
  existingPositions: Position[];
  dailyPnl: number;
  dailyLossHaltActive: boolean;
}): RiskAssessment {
  const checks: RiskCheck[] = [];
  const {
    convictionScore,
    entryPrice,
    targetPrice,
    stopLoss,
    positionSizeDollars,
    direction,
    account,
    existingPositions,
    dailyPnl,
    dailyLossHaltActive,
  } = params;

  const portfolioValue = account.equity;

  // 1. Conviction threshold
  checks.push({
    passed: convictionScore >= RISK_RULES.MIN_CONVICTION,
    rule: "Minimum Conviction",
    message: convictionScore >= RISK_RULES.MIN_CONVICTION
      ? `Conviction ${convictionScore} meets threshold of ${RISK_RULES.MIN_CONVICTION}`
      : `Conviction ${convictionScore} below minimum threshold of ${RISK_RULES.MIN_CONVICTION}`,
    value: convictionScore,
    limit: RISK_RULES.MIN_CONVICTION,
  });

  // 2. Maximum position size (50% of portfolio)
  const positionPercent = (positionSizeDollars / portfolioValue) * 100;
  checks.push({
    passed: positionPercent <= RISK_RULES.MAX_POSITION_PERCENT,
    rule: "Maximum Position Size",
    message: positionPercent <= RISK_RULES.MAX_POSITION_PERCENT
      ? `Position ${positionPercent.toFixed(1)}% within ${RISK_RULES.MAX_POSITION_PERCENT}% limit`
      : `Position ${positionPercent.toFixed(1)}% exceeds ${RISK_RULES.MAX_POSITION_PERCENT}% limit`,
    value: positionPercent,
    limit: RISK_RULES.MAX_POSITION_PERCENT,
  });

  // 3. Maximum total exposure (80% of portfolio)
  const currentExposure = existingPositions.reduce(
    (sum, p) => sum + Math.abs(p.marketValue),
    0
  );
  const newExposure = currentExposure + positionSizeDollars;
  const exposurePercent = (newExposure / portfolioValue) * 100;
  checks.push({
    passed: exposurePercent <= RISK_RULES.MAX_EXPOSURE_PERCENT,
    rule: "Maximum Portfolio Exposure",
    message: exposurePercent <= RISK_RULES.MAX_EXPOSURE_PERCENT
      ? `Total exposure ${exposurePercent.toFixed(1)}% within ${RISK_RULES.MAX_EXPOSURE_PERCENT}% limit`
      : `Total exposure ${exposurePercent.toFixed(1)}% exceeds ${RISK_RULES.MAX_EXPOSURE_PERCENT}% limit (20% cash floor)`,
    value: exposurePercent,
    limit: RISK_RULES.MAX_EXPOSURE_PERCENT,
  });

  // 4. Maximum loss per trade (3% of portfolio)
  const riskPerShare = direction === "long"
    ? entryPrice - stopLoss
    : stopLoss - entryPrice;
  const shares = positionSizeDollars / entryPrice;
  const maxLossDollars = riskPerShare * shares;
  const maxLossPercent = (maxLossDollars / portfolioValue) * 100;
  checks.push({
    passed: maxLossPercent <= RISK_RULES.MAX_LOSS_PER_TRADE_PERCENT,
    rule: "Maximum Loss Per Trade",
    message: maxLossPercent <= RISK_RULES.MAX_LOSS_PER_TRADE_PERCENT
      ? `Max loss ${maxLossPercent.toFixed(2)}% within ${RISK_RULES.MAX_LOSS_PER_TRADE_PERCENT}% limit`
      : `Max loss ${maxLossPercent.toFixed(2)}% exceeds ${RISK_RULES.MAX_LOSS_PER_TRADE_PERCENT}% limit`,
    value: maxLossPercent,
    limit: RISK_RULES.MAX_LOSS_PER_TRADE_PERCENT,
  });

  // 5. Reward-to-risk ratio
  const rewardPerShare = direction === "long"
    ? targetPrice - entryPrice
    : entryPrice - targetPrice;
  const rewardRiskRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;
  checks.push({
    passed: rewardRiskRatio >= RISK_RULES.MIN_REWARD_RISK_RATIO,
    rule: "Minimum Reward:Risk Ratio",
    message: rewardRiskRatio >= RISK_RULES.MIN_REWARD_RISK_RATIO
      ? `R:R ratio ${rewardRiskRatio.toFixed(2)}:1 meets ${RISK_RULES.MIN_REWARD_RISK_RATIO}:1 minimum`
      : `R:R ratio ${rewardRiskRatio.toFixed(2)}:1 below ${RISK_RULES.MIN_REWARD_RISK_RATIO}:1 minimum`,
    value: rewardRiskRatio,
    limit: RISK_RULES.MIN_REWARD_RISK_RATIO,
  });

  // 6. Daily loss halt
  const dailyLossPercent = portfolioValue > 0
    ? (Math.abs(Math.min(0, dailyPnl)) / portfolioValue) * 100
    : 0;
  const haltTriggered = dailyLossHaltActive || dailyLossPercent >= RISK_RULES.DAILY_LOSS_HALT_PERCENT;
  checks.push({
    passed: !haltTriggered,
    rule: "Daily Loss Halt",
    message: haltTriggered
      ? `Trading halted: daily loss ${dailyLossPercent.toFixed(2)}% exceeds ${RISK_RULES.DAILY_LOSS_HALT_PERCENT}% limit`
      : `Daily P&L ${dailyLossPercent.toFixed(2)}% within ${RISK_RULES.DAILY_LOSS_HALT_PERCENT}% halt threshold`,
    value: dailyLossPercent,
    limit: RISK_RULES.DAILY_LOSS_HALT_PERCENT,
  });

  // 7. Stop loss and target must be set (non-zero, logical direction)
  const hasValidStops = direction === "long"
    ? stopLoss < entryPrice && targetPrice > entryPrice
    : stopLoss > entryPrice && targetPrice < entryPrice;
  checks.push({
    passed: hasValidStops,
    rule: "Valid Stop Loss & Target",
    message: hasValidStops
      ? "Stop loss and target prices are logically valid"
      : "Stop loss and/or target prices are invalid for trade direction",
  });

  const approved = checks.every((c) => c.passed);

  // If position size fails but other checks pass, calculate adjusted size
  let adjustedPositionSize: number | undefined;
  if (!approved) {
    const maxByPosition = (portfolioValue * RISK_RULES.MAX_POSITION_PERCENT) / 100;
    const maxByExposure = Math.max(0, (portfolioValue * RISK_RULES.MAX_EXPOSURE_PERCENT / 100) - currentExposure);
    const maxByLoss = riskPerShare > 0
      ? ((portfolioValue * RISK_RULES.MAX_LOSS_PER_TRADE_PERCENT / 100) / riskPerShare) * entryPrice
      : 0;
    adjustedPositionSize = Math.min(maxByPosition, maxByExposure, maxByLoss);
    if (adjustedPositionSize < 1) adjustedPositionSize = undefined;
  }

  return { approved, checks, adjustedPositionSize };
}

export function checkDailyLossHalt(
  startOfDayEquity: number,
  currentEquity: number
): boolean {
  if (startOfDayEquity <= 0) return false;
  const lossPercent = ((startOfDayEquity - currentEquity) / startOfDayEquity) * 100;
  return lossPercent >= RISK_RULES.DAILY_LOSS_HALT_PERCENT;
}
