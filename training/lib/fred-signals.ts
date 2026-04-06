// ============================================================
// Training - FRED API Historical Signal Fetcher
// ============================================================
// Fetches real economic data from the Federal Reserve Economic
// Data (FRED) API for historical dates. Fills gaps that Yahoo
// Finance cannot provide: fed funds rate, SOFR, real yields,
// actual credit spreads (not ETF proxies), and TED spread.
//
// Requires FRED_API_KEY env var. If not set, returns empty
// partial gracefully — training continues with Yahoo-only data.
// ============================================================

import type { GlobalSignals } from "../../src/lib/market-regime.ts";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

// FRED series mapping to GlobalSignals fields
const SERIES_MAP: Record<string, keyof GlobalSignals> = {
  DFF: "fedFundsRate",
  SOFR: "sofr",
  DGS2: "twoYearYield",
  DFII10: "realYield10Y",
  TEDRATE: "tedSpread",
  BAMLH0A0HYM2: "highYieldSpread",
  BAMLC0A0CM: "igSpread",
};

interface FredObservation {
  date: string;
  value: string;
}

/**
 * Fetch observations for a single FRED series around a target date.
 * Returns the most recent observation on or before the target date,
 * plus the prior observation for computing changes.
 */
async function fetchSeries(
  seriesId: string,
  date: string,
  apiKey: string,
): Promise<{ current: number; prior: number } | null> {
  try {
    // Look back 14 days to handle weekends, holidays, and FRED's 1-day lag
    const target = new Date(date + "T12:00:00Z");
    const start = new Date(target);
    start.setUTCDate(start.getUTCDate() - 14);
    const end = new Date(target);
    end.setUTCDate(end.getUTCDate() + 1);

    const startStr = start.toISOString().split("T")[0];
    const endStr = end.toISOString().split("T")[0];

    const url =
      `${FRED_BASE}?series_id=${seriesId}` +
      `&observation_start=${startStr}` +
      `&observation_end=${endStr}` +
      `&api_key=${apiKey}` +
      `&file_type=json` +
      `&sort_order=desc`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;

    const data = await response.json();
    const observations: FredObservation[] = data?.observations;
    if (!observations || observations.length === 0) return null;

    // Filter out missing values (FRED uses "." for missing)
    const valid = observations.filter(
      (o) => o.value !== "." && !isNaN(parseFloat(o.value)),
    );
    if (valid.length === 0) return null;

    const current = parseFloat(valid[0].value);
    const prior = valid.length >= 2 ? parseFloat(valid[1].value) : current;

    return { current: round4(current), prior: round4(prior) };
  } catch {
    return null;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fetch all available FRED signals for a historical date.
 * Returns a partial GlobalSignals with only the fields that have data.
 *
 * Requires FRED_API_KEY environment variable. If not set, returns
 * an empty object — the training engine continues with Yahoo-only data.
 */
export async function fetchFredSignals(
  date: string,
): Promise<Partial<GlobalSignals>> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return {};
  }

  const result: Partial<GlobalSignals> = {};

  // Fetch all series in parallel
  const seriesIds = Object.keys(SERIES_MAP);
  const fetches = await Promise.all(
    seriesIds.map(async (seriesId) => {
      const data = await fetchSeries(seriesId, date, apiKey);
      return { seriesId, data };
    }),
  );

  for (const { seriesId, data } of fetches) {
    if (!data) continue;

    const field = SERIES_MAP[seriesId];

    switch (seriesId) {
      case "DFF":
        // Fed funds rate — direct percentage (e.g., 5.33)
        result.fedFundsRate = data.current;
        break;

      case "SOFR":
        // Secured Overnight Financing Rate — direct percentage
        result.sofr = data.current;
        break;

      case "DGS2":
        // 2-Year Treasury yield — replaces Yahoo's broken interpolation
        result.twoYearYield = round2(data.current);
        result.twoYearYieldChange = round2(data.current - data.prior);
        break;

      case "DFII10":
        // 10-Year TIPS real yield
        result.realYield10Y = round2(data.current);
        break;

      case "TEDRATE":
        // TED spread (T-bill vs LIBOR/SOFR)
        result.tedSpread = round2(data.current);
        break;

      case "BAMLH0A0HYM2":
        // ICE BofA High Yield OAS — actual spread in bps (reported as percentage points)
        // FRED reports this in percentage points (e.g., 3.50 = 350 bps)
        // Store as basis points to match the interface semantics
        result.highYieldSpread = round2(data.current * 100);
        result.spreadChange = round2((data.current - data.prior) * 100);
        break;

      case "BAMLC0A0CM":
        // ICE BofA IG OAS — actual spread in bps
        result.igSpread = round2(data.current * 100);
        result.igSpreadChange = round2((data.current - data.prior) * 100);
        break;
    }
  }

  // If we have both 2Y and 10Y from FRED, recompute the 2-10 spread
  if (result.twoYearYield !== undefined) {
    // We need 10Y to compute the spread — caller should merge with Yahoo data
    // that already has tenYearYield. We just provide the accurate 2Y.
  }

  return result;
}
