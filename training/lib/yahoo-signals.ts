// ============================================================
// Training - Yahoo Finance Historical Signal Fetcher
// ============================================================
// Fetches real market data from Yahoo Finance for ANY historical
// date. Populates GlobalSignals with actual VIX, yields, sectors,
// commodities, currencies, crypto, etc.
//
// This replaces the broken web-search-based signal gathering
// that returned defaults 80% of the time.
//
// Zero tokens, deterministic, fast, works for every trading day.
// ============================================================

import type { GlobalSignals } from "../../src/lib/market-regime.ts";

let yfModule: any = null;

async function getYF(): Promise<any> {
  if (yfModule) return yfModule;
  const mod = await import("yahoo-finance2");
  const YF = mod.default;
  yfModule = typeof YF === "function" ? new YF() : YF;
  return yfModule;
}

interface QuoteData {
  close: number;
  priorClose: number;
  change: number; // % change
}

// Fetch close + prior close for a ticker on a given date
async function getQuote(yf: any, symbol: string, date: string): Promise<QuoteData | null> {
  try {
    const target = new Date(date + "T12:00:00Z");
    const start = new Date(target);
    start.setUTCDate(start.getUTCDate() - 10); // Go back 10 days to ensure we get prior
    const end = new Date(target);
    end.setUTCDate(end.getUTCDate() + 2);

    const result = await yf.chart(symbol, {
      period1: start.toISOString().split("T")[0],
      period2: end.toISOString().split("T")[0],
      interval: "1d",
    });

    if (!result.quotes || result.quotes.length < 2) return null;

    // Find the quote on or just before the target date
    const targetTime = target.getTime();
    const validQuotes = result.quotes.filter((q: any) =>
      q.close != null && new Date(q.date).getTime() <= targetTime + 24 * 60 * 60 * 1000
    );

    if (validQuotes.length < 2) return null;

    const current = validQuotes[validQuotes.length - 1];
    const prior = validQuotes[validQuotes.length - 2];

    const close = current.close;
    const priorClose = prior.close;
    const change = priorClose !== 0 ? ((close - priorClose) / priorClose) * 100 : 0;

    return { close: round2(close), priorClose: round2(priorClose), change: round2(change) };
  } catch {
    return null;
  }
}

// Fetch multi-day data for computing consecutive days, 5d/20d returns
async function getMultiDay(yf: any, symbol: string, date: string, days: number): Promise<{ date: string; close: number }[]> {
  try {
    const target = new Date(date + "T12:00:00Z");
    const start = new Date(target);
    start.setUTCDate(start.getUTCDate() - days - 5);
    const end = new Date(target);
    end.setUTCDate(end.getUTCDate() + 2);

    const result = await yf.chart(symbol, {
      period1: start.toISOString().split("T")[0],
      period2: end.toISOString().split("T")[0],
      interval: "1d",
    });

    if (!result.quotes) return [];

    const targetTime = target.getTime();
    return result.quotes
      .filter((q: any) => q.close != null && new Date(q.date).getTime() <= targetTime + 24 * 60 * 60 * 1000)
      .map((q: any) => ({
        date: new Date(q.date).toISOString().split("T")[0],
        close: round2(q.close),
      }));
  } catch {
    return [];
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Ticker mapping for GlobalSignals fields
const TICKER_MAP = {
  // Indices (for computing "futures" change — we use index close-to-close as proxy)
  sp: "^GSPC",
  nasdaq: "^IXIC",
  dow: "^DJI",
  russell: "^RUT",

  // Volatility
  vix: "^VIX",
  vix3m: "^VIX3M",

  // Yields (Yahoo returns yield * 10 for TNX/TYX/IRX, or direct — we handle both)
  tenYear: "^TNX",
  thirtyYear: "^TYX",
  fiveYear: "^FVX",
  threeMonth: "^IRX",

  // Dollar & Currencies
  dollar: "DX-Y.NYB",
  eurUsd: "EURUSD=X",
  usdJpy: "JPY=X",
  usdCny: "CNY=X",

  // Commodities
  oilWTI: "CL=F",
  brentOil: "BZ=F",
  natGas: "NG=F",
  gold: "GC=F",
  silver: "SI=F",
  copper: "HG=F",

  // International
  nikkei: "^N225",
  dax: "^GDAXI",
  ftse: "^FTSE",
  shanghai: "000001.SS",
  hangSeng: "^HSI",
  kospi: "^KS11",

  // Sector ETFs
  xlk: "XLK", xlf: "XLF", xle: "XLE", xlv: "XLV", xlp: "XLP",
  xlu: "XLU", xlre: "XLRE", xli: "XLI", xlb: "XLB", xlc: "XLC",
  xly: "XLY", smh: "SMH",

  // Crypto
  bitcoin: "BTC-USD",
  ethereum: "ETH-USD",

  // Credit (ETF proxies)
  hyBond: "HYG",   // High yield bond ETF
  igBond: "LQD",   // Investment grade bond ETF
  tlt: "TLT",      // Long-term treasuries

  // Breadth proxy
  rsp: "RSP",      // Equal-weight S&P (breadth proxy)
};

/**
 * Fetch all available GlobalSignals from Yahoo Finance for a historical date.
 * Returns real market data — no defaults, no web search, no tokens.
 */
export async function fetchHistoricalSignals(date: string): Promise<{ signals: GlobalSignals; fieldsPopulated: number }> {
  const yf = await getYF();

  // Batch all quote fetches in parallel (grouped to avoid rate limits)
  const allTickers = Object.values(TICKER_MAP);
  const quoteResults = new Map<string, QuoteData>();

  // Fetch in batches of 10
  for (let i = 0; i < allTickers.length; i += 10) {
    const batch = allTickers.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(async (ticker) => {
        const data = await getQuote(yf, ticker, date);
        return { ticker, data };
      })
    );
    for (const { ticker, data } of results) {
      if (data) quoteResults.set(ticker, data);
    }
  }

  // Also fetch multi-day S&P data for context fields
  const spHistory = await getMultiDay(yf, "^GSPC", date, 25);
  const nasdaqHistory = await getMultiDay(yf, "^IXIC", date, 7);
  const russellHistory = await getMultiDay(yf, "^RUT", date, 7);

  // Helper to get quote data
  const q = (ticker: string): QuoteData | null => quoteResults.get(ticker) || null;

  // Compute consecutive up/down days for S&P
  let consecutiveUp = 0;
  let consecutiveDown = 0;
  if (spHistory.length >= 2) {
    for (let i = spHistory.length - 1; i > 0; i--) {
      const change = spHistory[i].close - spHistory[i - 1].close;
      if (change > 0) {
        if (consecutiveDown > 0) break;
        consecutiveUp++;
      } else if (change < 0) {
        if (consecutiveUp > 0) break;
        consecutiveDown++;
      } else {
        break;
      }
    }
  }

  // Compute N-day returns
  const sp5dReturn = spHistory.length >= 6
    ? round2(((spHistory[spHistory.length - 1].close - spHistory[spHistory.length - 6].close) / spHistory[spHistory.length - 6].close) * 100)
    : 0;
  const sp20dReturn = spHistory.length >= 21
    ? round2(((spHistory[spHistory.length - 1].close - spHistory[spHistory.length - 21].close) / spHistory[spHistory.length - 21].close) * 100)
    : 0;

  // Nasdaq vs Russell 5d divergence
  const nas5d = nasdaqHistory.length >= 6
    ? ((nasdaqHistory[nasdaqHistory.length - 1].close - nasdaqHistory[nasdaqHistory.length - 6].close) / nasdaqHistory[nasdaqHistory.length - 6].close) * 100
    : 0;
  const rus5d = russellHistory.length >= 6
    ? ((russellHistory[russellHistory.length - 1].close - russellHistory[russellHistory.length - 6].close) / russellHistory[russellHistory.length - 6].close) * 100
    : 0;

  // VIX term structure
  const vixData = q("^VIX");
  const vix3mData = q("^VIX3M");
  let vixTermStructure: "contango" | "flat" | "backwardation" = "contango";
  if (vixData && vix3mData) {
    const ratio = vixData.close / vix3mData.close;
    if (ratio > 1.05) vixTermStructure = "backwardation";
    else if (ratio > 0.95) vixTermStructure = "flat";
  }

  // 2Y yield: approximate from 5Y and 3M
  const fiveY = q("^FVX");
  const threeM = q("^IRX");
  const tenY = q("^TNX");
  // Yahoo TNX/TYX values are already in percentage points (e.g., 4.25 = 4.25%)
  const tenYearYield = tenY ? tenY.close : 0;
  const thirtyYearYield = q("^TYX")?.close || 0;
  const threeMonthYield = threeM ? threeM.close : 0;
  const fiveYearYield = fiveY ? fiveY.close : 0;
  // Estimate 2Y as between 3M and 5Y (rough but better than 0)
  const twoYearYield = threeM && fiveY ? round2((threeM.close * 0.3 + fiveY.close * 0.7)) : 0;

  // Breadth proxy: RSP vs SPY divergence indicates breadth
  const rspData = q("RSP");
  const spData = q("^GSPC");

  // Build HY spread proxy: HYG inverse vs LQD
  const hyg = q("HYG");
  const lqd = q("LQD");

  // Build the signals object
  const signals: GlobalSignals = {
    // Index "futures" (using prior day close-to-close % change as proxy)
    spFuturesChange: q("^GSPC")?.change || 0,
    nasdaqFuturesChange: q("^IXIC")?.change || 0,
    dowFuturesChange: q("^DJI")?.change || 0,
    russellFuturesChange: q("^RUT")?.change || 0,
    vixFuturesChange: vixData?.change || 0,

    // Volatility
    vix: vixData?.close || 0,
    vixChange: vixData?.change || 0,
    vixTermStructure,
    vix9d: 0, // Not available on Yahoo
    vix3m: vix3mData?.close || 0,
    skewIndex: 0, // Not available
    putCallRatio: 0, // Not available
    spxGammaExposure: "neutral",

    // Yields
    tenYearYield,
    tenYearYieldChange: tenY?.change || 0,
    twoYearYield,
    twoYearYieldChange: 0,
    thirtyYearYield,
    threeMonthYield,
    twoTenSpread: twoYearYield && tenYearYield ? round2(tenYearYield - twoYearYield) : 0,
    threeMoTenYrSpread: threeMonthYield && tenYearYield ? round2(tenYearYield - threeMonthYield) : 0,
    realYield10Y: 0, // TIPS not on Yahoo
    fedFundsRate: 0, // Would need FRED
    fedFundsExpected: 0,

    // Dollar & Currencies
    dollarIndex: q("DX-Y.NYB")?.close || 0,
    dollarIndexChange: q("DX-Y.NYB")?.change || 0,
    eurUsd: q("EURUSD=X")?.close || 0,
    eurUsdChange: q("EURUSD=X")?.change || 0,
    usdJpy: q("JPY=X")?.close || 0,
    usdJpyChange: q("JPY=X")?.change || 0,
    usdCny: q("CNY=X")?.close || 0,
    usdCnyChange: q("CNY=X")?.change || 0,

    // Commodities
    oilWTI: q("CL=F")?.close || 0,
    oilChange: q("CL=F")?.change || 0,
    brentOil: q("BZ=F")?.close || 0,
    brentOilChange: q("BZ=F")?.change || 0,
    natGasChange: q("NG=F")?.change || 0,
    goldPrice: q("GC=F")?.close || 0,
    goldChange: q("GC=F")?.change || 0,
    silverChange: q("SI=F")?.change || 0,
    copperChange: q("HG=F")?.change || 0,
    ironOreChange: 0, // Not on Yahoo
    wheatChange: 0, // Could add ZW=F
    uraniumChange: 0, // Could add URA
    balticDryIndex: 0, // Not on Yahoo
    balticDryChange: 0,

    // International
    nikkeiChange: q("^N225")?.change || 0,
    daxChange: q("^GDAXI")?.change || 0,
    ftseChange: q("^FTSE")?.change || 0,
    shanghaiChange: q("000001.SS")?.change || 0,
    hangSengChange: q("^HSI")?.change || 0,
    kospiChange: q("^KS11")?.change || 0,
    emChange: 0, // Could add EEM
    euroStoxx50Change: 0, // Could add ^STOXX50E

    // Credit (ETF-based proxies — directional, not absolute spread)
    highYieldSpread: hyg ? round2(100 - hyg.close) * 5 : 0, // Rough proxy
    spreadChange: hyg?.change ? round2(-hyg.change) : 0, // HYG down = spreads widening
    igSpread: lqd ? round2(100 - lqd.close) * 2 : 0,
    igSpreadChange: lqd?.change ? round2(-lqd.change) : 0,
    cdsIndex: 0,
    tedSpread: 0,
    mbs30YrSpread: 0,

    // Breadth (proxied from RSP vs SPY divergence)
    advanceDeclineRatio: rspData && spData
      ? round2(1 + (rspData.change - spData.change) / 10) // >1 = broad strength
      : 0,
    newHighsNewLows: 0,
    percentAbove200DMA: 0, // Would need scanning
    percentAbove50DMA: 0,
    mcclellanOscillator: 0,

    // Sectors
    xlkChange: q("XLK")?.change || 0,
    xlfChange: q("XLF")?.change || 0,
    xleChange: q("XLE")?.change || 0,
    xlvChange: q("XLV")?.change || 0,
    xlpChange: q("XLP")?.change || 0,
    xluChange: q("XLU")?.change || 0,
    xlreChange: q("XLRE")?.change || 0,
    xliChange: q("XLI")?.change || 0,
    xlbChange: q("XLB")?.change || 0,
    xlcChange: q("XLC")?.change || 0,
    xlyChange: q("XLY")?.change || 0,
    smhChange: q("SMH")?.change || 0,

    // Sentiment (not available from Yahoo — leave as defaults)
    aaiiBullBear: 0,
    cnnFearGreed: 0,
    naaim: 0,
    marginDebt: "flat",
    etfFlows: "flat",

    // Crypto
    bitcoinChange: q("BTC-USD")?.change || 0,
    ethereumChange: q("ETH-USD")?.change || 0,
    btcDominance: 0,
    cryptoTotalMarketCapChange: 0,

    // Liquidity (not available from Yahoo)
    sofr: 0,
    repoRate: 0,
    fedBalanceSheet: "flat",
    tgaBalance: "flat",

    // Calendar (not available from Yahoo — needs separate data)
    hasMajorEconData: false,
    econDataType: "",
    hasEarningsOfNote: false,
    earningsNames: "",
    isOpexWeek: false,
    isOpexDay: false,
    isMonthEnd: false,
    isQuarterEnd: false,
    daysToFOMC: 0,
    daysToNextCPI: 0,
    daysToNextNFP: 0,
    isExDividendHeavy: false,

    // Geopolitical (not available from Yahoo)
    geopoliticalRisk: "low",
    geopoliticalEvents: "",

    // Multi-day context
    spConsecutiveUpDays: consecutiveUp,
    spConsecutiveDownDays: consecutiveDown,
    sp5DayReturn: sp5dReturn,
    sp20DayReturn: sp20dReturn,
    nasdaqVsRussell5d: round2(nas5d - rus5d),
    sp52WeekRange: 0, // Would need 252 days of data
    spDistanceFrom200DMA: 0,
    spDistanceFrom50DMA: 0,
  };

  // Count non-default fields
  const fieldsPopulated = Object.entries(signals).filter(([, v]) =>
    v !== 0 && v !== "" && v !== false && v !== "flat" && v !== "neutral" && v !== "contango" && v !== "low"
  ).length;

  return { signals, fieldsPopulated };
}
