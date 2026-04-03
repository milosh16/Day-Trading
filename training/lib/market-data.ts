// ============================================================
// Training - Market Data API
// ============================================================
// Deterministic price lookups. Tries Yahoo Finance first (when
// available), falls back to Claude web search for environments
// where Yahoo Finance is blocked.
//
// Key design: Agent B (price verification) receives ONLY
// symbols + entry prices + date. No thesis, no direction.
// ============================================================

import { callClaude, extractJson } from "./api.ts";

export interface OHLC {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

let yahooAvailable: boolean | null = null;
let yfModule: any = null;

async function getYF(): Promise<any | null> {
  if (yahooAvailable === false) return null;
  if (yfModule) return yfModule;

  try {
    const mod = await import("yahoo-finance2");
    const YF = mod.default;
    const yf = typeof YF === "function" ? new YF() : YF;

    // Test connectivity with a simple call
    await yf.chart("AAPL", {
      period1: "2024-01-02",
      period2: "2024-01-05",
      interval: "1d",
    });

    yfModule = yf;
    yahooAvailable = true;
    console.log("  [market-data] Yahoo Finance API: available");
    return yf;
  } catch {
    yahooAvailable = false;
    console.log("  [market-data] Yahoo Finance API: unavailable, using Claude web search fallback");
    return null;
  }
}

// ---- Yahoo Finance implementation ----

async function getOHLC_YF(yf: any, symbol: string, date: string): Promise<OHLC | null> {
  try {
    const targetDate = new Date(date + "T12:00:00Z");
    const startDate = new Date(targetDate);
    startDate.setUTCDate(startDate.getUTCDate() - 3);
    const endDate = new Date(targetDate);
    endDate.setUTCDate(endDate.getUTCDate() + 3);

    const result = await yf.chart(symbol, {
      period1: startDate.toISOString().split("T")[0],
      period2: endDate.toISOString().split("T")[0],
      interval: "1d",
    });

    if (!result.quotes || result.quotes.length === 0) return null;

    const targetTime = targetDate.getTime();
    let best = result.quotes[0];
    let bestDiff = Infinity;

    for (const q of result.quotes) {
      const qDate = new Date(q.date);
      const diff = Math.abs(qDate.getTime() - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = q;
      }
    }

    if (bestDiff > 2 * 24 * 60 * 60 * 1000) return null;
    if (best.open == null || best.close == null) return null;

    return {
      date: new Date(best.date).toISOString().split("T")[0],
      open: round2(best.open),
      high: round2(best.high),
      low: round2(best.low),
      close: round2(best.close),
      volume: best.volume ?? 0,
    };
  } catch {
    return null;
  }
}

async function getPriorClose_YF(yf: any, symbol: string, tradingDate: string): Promise<number | null> {
  try {
    const target = new Date(tradingDate + "T12:00:00Z");
    const startDate = new Date(target);
    startDate.setUTCDate(startDate.getUTCDate() - 7);

    const result = await yf.chart(symbol, {
      period1: startDate.toISOString().split("T")[0],
      period2: tradingDate,
      interval: "1d",
    });

    if (!result.quotes || result.quotes.length === 0) return null;

    const priorQuotes = result.quotes.filter(
      (q: any) => new Date(q.date).getTime() < target.getTime()
    );

    if (priorQuotes.length === 0) return null;
    const lastQuote = priorQuotes[priorQuotes.length - 1];
    return lastQuote.close != null ? round2(lastQuote.close) : null;
  } catch {
    return null;
  }
}

async function getMultiDayOHLC_YF(yf: any, symbol: string, startDate: string, days: number): Promise<OHLC[]> {
  try {
    const start = new Date(startDate + "T12:00:00Z");
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + days + 3);

    const result = await yf.chart(symbol, {
      period1: startDate,
      period2: end.toISOString().split("T")[0],
      interval: "1d",
    });

    if (!result.quotes || result.quotes.length === 0) return [];

    return result.quotes
      .filter((q: any) => q.open != null && q.close != null)
      .slice(0, days)
      .map((q: any) => ({
        date: new Date(q.date).toISOString().split("T")[0],
        open: round2(q.open!),
        high: round2(q.high!),
        low: round2(q.low!),
        close: round2(q.close!),
        volume: q.volume ?? 0,
      }));
  } catch {
    return [];
  }
}

// ---- Claude web search fallback ----
// Uses a STRUCTURALLY SEPARATED prompt: only symbols + date, no thesis/direction.

async function getPriorClose_Claude(symbol: string, tradingDate: string): Promise<number | null> {
  const priorDate = getPriorTradingDate(tradingDate);

  const response = await callClaude({
    system: `You are a financial data lookup tool. Look up the CLOSING PRICE for a single stock on a specific date. Return ONLY a JSON object with the closing price. Do not explain or add commentary.

Return in <json> tags: <json>{"close": 123.45}</json>

If you cannot find the exact closing price, return: <json>{"close": null}</json>`,
    messages: [
      {
        role: "user",
        content: `What was the closing price of ${symbol} on ${priorDate}? Search for "${symbol} stock price ${priorDate}" or "${symbol} closing price ${priorDate}".`,
      },
    ],
    maxTokens: 512,
    useWebSearch: true,
  });

  const data = extractJson<{ close: number | null }>(response.text);
  return data?.close ?? null;
}

async function getOHLC_Claude(symbol: string, date: string): Promise<OHLC | null> {
  const response = await callClaude({
    system: `You are a financial data lookup tool. Look up the OHLC (open, high, low, close) price data for a single stock on a specific date. Return ONLY a JSON object. Do not explain.

Return in <json> tags: <json>{"open": 123.45, "high": 125.00, "low": 121.00, "close": 124.00, "volume": 50000000}</json>

If you cannot find reliable data, return: <json>null</json>`,
    messages: [
      {
        role: "user",
        content: `What were the OHLC prices for ${symbol} on ${date}? Search for "${symbol} stock price ${date}" and "${symbol} OHLC ${date}".`,
      },
    ],
    maxTokens: 512,
    useWebSearch: true,
  });

  const data = extractJson<{ open: number; high: number; low: number; close: number; volume?: number }>(response.text);
  if (!data || !data.open || !data.close) return null;

  return {
    date,
    open: round2(data.open),
    high: round2(data.high),
    low: round2(data.low),
    close: round2(data.close),
    volume: data.volume ?? 0,
  };
}

async function getMultiDayOHLC_Claude(
  symbol: string,
  startDate: string,
  days: number
): Promise<OHLC[]> {
  const response = await callClaude({
    system: `You are a financial data lookup tool. Look up OHLC prices for a stock over multiple consecutive trading days. Return a JSON array of daily OHLC data. Do not explain.

Return in <json> tags:
<json>[
  {"date": "2024-01-02", "open": 123.45, "high": 125.00, "low": 121.00, "close": 124.00},
  {"date": "2024-01-03", "open": 124.00, "high": 126.00, "low": 123.00, "close": 125.50}
]</json>

If you cannot find reliable data, return: <json>[]</json>
Use REAL prices only. Do not fabricate.`,
    messages: [
      {
        role: "user",
        content: `Look up the OHLC prices for ${symbol} for ${days} consecutive trading days starting from ${startDate}. Search for "${symbol} stock price history ${startDate}" and "${symbol} daily prices ${startDate}".`,
      },
    ],
    maxTokens: 1024,
    useWebSearch: true,
  });

  const data = extractJson<Array<{ date: string; open: number; high: number; low: number; close: number }>>(response.text, true);
  if (!data || !Array.isArray(data)) return [];

  return data
    .filter((d) => d.open && d.close)
    .slice(0, days)
    .map((d) => ({
      date: d.date,
      open: round2(d.open),
      high: round2(d.high),
      low: round2(d.low),
      close: round2(d.close),
      volume: 0,
    }));
}

// ---- Public API (auto-selects backend) ----

/**
 * Get prior trading day close price for a symbol.
 * Used by anti-leakage price verification (Agent B role).
 */
export async function getPriorClose(symbol: string, tradingDate: string): Promise<number | null> {
  const yf = await getYF();
  if (yf) return getPriorClose_YF(yf, symbol, tradingDate);
  return getPriorClose_Claude(symbol, tradingDate);
}

/**
 * Get OHLC for a symbol on a specific date.
 */
export async function getOHLC(symbol: string, date: string): Promise<OHLC | null> {
  const yf = await getYF();
  if (yf) return getOHLC_YF(yf, symbol, date);
  return getOHLC_Claude(symbol, date);
}

/**
 * Get multi-day OHLC for outcome scoring.
 */
export async function getMultiDayOHLC(
  symbol: string,
  startDate: string,
  days: number = 3
): Promise<OHLC[]> {
  const yf = await getYF();
  if (yf) return getMultiDayOHLC_YF(yf, symbol, startDate, days);
  return getMultiDayOHLC_Claude(symbol, startDate, days);
}

/**
 * Batch OHLC lookups for multiple symbols.
 */
export async function getBatchOHLC(
  symbols: string[],
  date: string
): Promise<Map<string, OHLC>> {
  const results = new Map<string, OHLC>();
  const batchSize = 5;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const promises = batch.map(async (sym) => {
      const ohlc = await getOHLC(sym, date);
      if (ohlc) results.set(sym, ohlc);
    });
    await Promise.all(promises);
  }
  return results;
}

// ---- Helpers ----

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getPriorTradingDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().split("T")[0];
}
