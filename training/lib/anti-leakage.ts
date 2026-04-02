// ============================================================
// Training - Anti-Data-Leakage Verification
// ============================================================
// Multiple layers to prevent hindsight bias:
// 1. Price verification against real prior-day data
// 2. Hindsight audit by a separate Claude call
// 3. Recommendation filtering based on temporal plausibility
// ============================================================

import { callClaude, extractJson } from "./api.ts";
import type { TradeRecommendation } from "./types.ts";

interface PriceCheck {
  symbol: string;
  priorClose: number;
  entryPrice: number;
  deviation: number; // % difference
  plausible: boolean;
}

interface AuditResult {
  passesAudit: boolean;
  flaggedTrades: {
    symbol: string;
    reason: string;
  }[];
  cleanTrades: TradeRecommendation[];
}

// Step 1: Verify entry prices match real prior-day close prices
export async function verifyPrices(
  date: string,
  recommendations: TradeRecommendation[]
): Promise<{ checks: PriceCheck[]; tokensUsed: number }> {
  if (recommendations.length === 0) {
    return { checks: [], tokensUsed: 0 };
  }

  const priorDate = getPriorTradingDate(date);
  const symbols = recommendations.map((r) => r.symbol).join(", ");

  const response = await callClaude({
    system: `You are a financial data verification tool. Look up the CLOSING prices for the given stocks on the specified date. Return only factual data.

Return JSON wrapped in <json> tags:
<json>{
  "prices": {
    "TICKER": 123.45,
    "TICKER2": 67.89
  }
}</json>

If you cannot find the closing price for a stock, use -1.`,
    messages: [
      {
        role: "user",
        content: `What were the closing prices for these stocks on ${priorDate}: ${symbols}`,
      },
    ],
    maxTokens: 1024,
    useWebSearch: true,
  });

  const data = extractJson<{ prices: Record<string, number> }>(response.text);
  const prices = data?.prices || {};

  const checks: PriceCheck[] = recommendations.map((rec) => {
    const priorClose = prices[rec.symbol] || -1;
    if (priorClose === -1) {
      return {
        symbol: rec.symbol,
        priorClose: -1,
        entryPrice: rec.entryPrice,
        deviation: 0,
        plausible: true, // can't verify, give benefit of doubt
      };
    }

    const deviation = Math.abs((rec.entryPrice - priorClose) / priorClose) * 100;
    // Entry price should be within 5% of prior close (allowing for pre-market moves)
    return {
      symbol: rec.symbol,
      priorClose,
      entryPrice: rec.entryPrice,
      deviation: Math.round(deviation * 100) / 100,
      plausible: deviation <= 5,
    };
  });

  return {
    checks,
    tokensUsed: response.inputTokens + response.outputTokens,
  };
}

// Step 2: Hindsight audit — have Claude check for temporal leakage
export async function auditForHindsight(
  date: string,
  recommendations: TradeRecommendation[]
): Promise<{ result: AuditResult; tokensUsed: number }> {
  if (recommendations.length === 0) {
    return {
      result: { passesAudit: true, flaggedTrades: [], cleanTrades: [] },
      tokensUsed: 0,
    };
  }

  const recsSummary = recommendations.map((r) =>
    `${r.symbol} ${r.direction}: "${r.thesis}" | Catalyst: "${r.catalyst}"`
  ).join("\n");

  const response = await callClaude({
    system: `You are a data leakage auditor for a trading backtesting system. Your job is to check whether trade recommendations could ONLY have been made using pre-market information, or whether they show signs of hindsight bias.

A recommendation is FLAGGED if:
- The thesis references events that happened DURING the trading day (e.g., "stock drops 5% at open" — how would you know before the open?)
- The catalyst references intraday price moves or intraday news breaks
- The entry/target/stop prices seem suspiciously precise (hitting exact intraday levels)
- The recommendation references earnings results that were released AFTER market open on that day
- The direction is exactly right for a major move that would only be known in hindsight

A recommendation is CLEAN if:
- The thesis is based on prior-day or earlier information (overnight earnings, pre-market economic data, multi-day trends)
- The entry price is near the prior day's close
- The catalyst was known before market open

Return JSON in <json> tags:
<json>{
  "flagged": [
    { "symbol": "TICKER", "reason": "References intraday price action" }
  ],
  "clean": ["TICKER1", "TICKER2"]
}</json>`,
    messages: [
      {
        role: "user",
        content: `These recommendations were generated for trading on ${date}. Check each for hindsight bias:\n\n${recsSummary}`,
      },
    ],
    maxTokens: 2048,
    useWebSearch: false, // no web search needed for audit
  });

  const data = extractJson<{ flagged: { symbol: string; reason: string }[]; clean: string[] }>(response.text);
  const flagged = data?.flagged || [];
  const cleanSymbols = new Set(data?.clean || []);

  const cleanTrades = recommendations.filter((r) => cleanSymbols.has(r.symbol));

  return {
    result: {
      passesAudit: flagged.length === 0,
      flaggedTrades: flagged,
      cleanTrades,
    },
    tokensUsed: response.inputTokens + response.outputTokens,
  };
}

// Helper: get the prior trading date (skip weekends)
function getPriorTradingDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().split("T")[0];
}

// Combined verification: run both checks and return clean recommendations only
export async function verifyRecommendations(
  date: string,
  recommendations: TradeRecommendation[]
): Promise<{
  cleanRecs: TradeRecommendation[];
  flaggedCount: number;
  priceDeviations: PriceCheck[];
  tokensUsed: number;
}> {
  let totalTokens = 0;

  // Price verification
  const { checks, tokensUsed: priceTokens } = await verifyPrices(date, recommendations);
  totalTokens += priceTokens;

  // Filter out implausible prices
  const plausibleRecs = recommendations.filter((rec) => {
    const check = checks.find((c) => c.symbol === rec.symbol);
    return !check || check.plausible;
  });

  const priceFiltered = recommendations.length - plausibleRecs.length;
  if (priceFiltered > 0) {
    console.log(`  Price filter removed ${priceFiltered} trades with >5% entry deviation`);
  }

  // Hindsight audit
  const { result: audit, tokensUsed: auditTokens } = await auditForHindsight(date, plausibleRecs);
  totalTokens += auditTokens;

  if (audit.flaggedTrades.length > 0) {
    console.log(`  Hindsight audit flagged ${audit.flaggedTrades.length} trades:`);
    for (const f of audit.flaggedTrades) {
      console.log(`    ${f.symbol}: ${f.reason}`);
    }
  }

  return {
    cleanRecs: audit.cleanTrades,
    flaggedCount: priceFiltered + audit.flaggedTrades.length,
    priceDeviations: checks,
    tokensUsed: totalTokens,
  };
}
