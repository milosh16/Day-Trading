// ============================================================
// Training - Deterministic Economic Event Calendar (2024-2026)
// ============================================================
// Static calendar of known economic events: FOMC meetings, CPI
// releases, NFP releases, OPEX dates, month/quarter ends.
//
// Zero API calls, zero tokens, instant lookups.
// Fills the calendar fields that Yahoo Finance cannot provide.
// ============================================================

import type { GlobalSignals } from "../../src/lib/market-regime.ts";

// ---- FOMC Meeting Dates (decision/statement day) ----
const FOMC_DATES: string[] = [
  // 2024
  "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12",
  "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
  // 2025
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
  "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-17",
  // 2026
  "2026-01-28", "2026-03-18", "2026-05-06", "2026-06-24",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-16",
];

// ---- CPI Release Dates (BLS schedule) ----
// CPI is typically released on the 2nd or 3rd Tuesday/Wednesday of the month.
// These are the actual published BLS release dates.
const CPI_DATES: string[] = [
  // 2024
  "2024-01-11", "2024-02-13", "2024-03-12", "2024-04-10",
  "2024-05-15", "2024-06-12", "2024-07-11", "2024-08-14",
  "2024-09-11", "2024-10-10", "2024-11-13", "2024-12-11",
  // 2025
  "2025-01-15", "2025-02-12", "2025-03-12", "2025-04-10",
  "2025-05-13", "2025-06-11", "2025-07-15", "2025-08-12",
  "2025-09-10", "2025-10-14", "2025-11-12", "2025-12-10",
  // 2026 (approximated using standard BLS pattern: ~2nd week of month)
  "2026-01-14", "2026-02-11", "2026-03-11", "2026-04-14",
  "2026-05-12", "2026-06-10", "2026-07-14", "2026-08-12",
  "2026-09-15", "2026-10-13", "2026-11-10", "2026-12-09",
];

// ---- NFP Release Dates (BLS schedule) ----
// Non-Farm Payrolls: typically 1st Friday of the month.
// Computed dynamically below, but we hardcode known dates for accuracy.
const NFP_DATES: string[] = [
  // 2024
  "2024-01-05", "2024-02-02", "2024-03-08", "2024-04-05",
  "2024-05-03", "2024-06-07", "2024-07-05", "2024-08-02",
  "2024-09-06", "2024-10-04", "2024-11-01", "2024-12-06",
  // 2025
  "2025-01-10", "2025-02-07", "2025-03-07", "2025-04-04",
  "2025-05-02", "2025-06-06", "2025-07-03", "2025-08-01",
  "2025-09-05", "2025-10-03", "2025-11-07", "2025-12-05",
  // 2026 (1st Friday of each month)
  "2026-01-02", "2026-02-06", "2026-03-06", "2026-04-03",
  "2026-05-01", "2026-06-05", "2026-07-02", "2026-08-07",
  "2026-09-04", "2026-10-02", "2026-11-06", "2026-12-04",
];

// Pre-compute date sets for O(1) lookup
const FOMC_SET = new Set(FOMC_DATES);
const CPI_SET = new Set(CPI_DATES);
const NFP_SET = new Set(NFP_DATES);

// ---- Helper Functions ----

/** Parse a YYYY-MM-DD string to a Date at noon UTC (avoids timezone issues). */
function parseDate(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00Z");
}

/** Format a Date to YYYY-MM-DD. */
function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Get the day of week (0=Sun, 1=Mon, ..., 6=Sat). */
function dayOfWeek(d: Date): number {
  return d.getUTCDay();
}

/** Get the 3rd Friday of a given month (OPEX day). */
function thirdFriday(year: number, month: number): Date {
  // month is 0-indexed
  const first = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  const firstDow = first.getUTCDay();
  // Days until first Friday: (5 - firstDow + 7) % 7
  const daysToFirstFriday = (5 - firstDow + 7) % 7;
  const thirdFridayDay = 1 + daysToFirstFriday + 14; // +14 for 3rd occurrence
  return new Date(Date.UTC(year, month, thirdFridayDay, 12, 0, 0));
}

/** Check if a date is in the same week (Mon-Fri) as the 3rd Friday. */
function isInOpexWeek(d: Date, year: number, month: number): boolean {
  const opex = thirdFriday(year, month);
  const opexDay = opex.getUTCDate();
  // OPEX week = Monday through Friday of the 3rd Friday
  const mondayOfOpexWeek = opexDay - 4; // Friday - 4 = Monday
  const day = d.getUTCDate();
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month &&
    day >= mondayOfOpexWeek &&
    day <= opexDay
  );
}

/** Get last business day of a month. */
function lastBusinessDay(year: number, month: number): Date {
  // Last calendar day of the month
  const last = new Date(Date.UTC(year, month + 1, 0, 12, 0, 0));
  const dow = last.getUTCDay();
  if (dow === 0) last.setUTCDate(last.getUTCDate() - 2); // Sunday -> Friday
  else if (dow === 6) last.setUTCDate(last.getUTCDate() - 1); // Saturday -> Friday
  return last;
}

/** Days between two dates (absolute calendar days). */
function daysBetween(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime();
  return Math.round(diff / (24 * 60 * 60 * 1000));
}

/** Find the next occurrence on or after a date from a sorted date list. */
function daysUntilNext(dateStr: string, dates: string[]): number {
  const d = parseDate(dateStr);
  for (const eventDate of dates) {
    const event = parseDate(eventDate);
    const diff = daysBetween(d, event);
    if (diff >= 0) return diff;
  }
  // Past all known dates — return a large number rather than lying
  return 999;
}

// ---- Quarter-end months (0-indexed): March=2, June=5, Sep=8, Dec=11 ----
const QUARTER_END_MONTHS = new Set([2, 5, 8, 11]);

/**
 * Look up deterministic calendar signals for a given date.
 * Returns a partial GlobalSignals with calendar/event fields populated.
 *
 * Works for any date in 2024-2026. For dates outside this range,
 * OPEX/month-end/quarter-end still work (computed), but FOMC/CPI/NFP
 * will return 999 for "days until next" since we lack the schedule.
 */
export function lookupCalendarSignals(
  date: string,
): Partial<GlobalSignals> {
  const d = parseDate(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();

  // --- Event-on-this-date checks ---
  const isFOMC = FOMC_SET.has(date);
  const isCPI = CPI_SET.has(date);
  const isNFP = NFP_SET.has(date);

  const hasMajorEconData = isFOMC || isCPI || isNFP;
  let econDataType = "";
  if (isFOMC) econDataType = "FOMC";
  else if (isCPI) econDataType = "CPI";
  else if (isNFP) econDataType = "NFP";

  // --- Days-to-next calculations ---
  const daysToFOMC = daysUntilNext(date, FOMC_DATES);
  const daysToNextCPI = daysUntilNext(date, CPI_DATES);
  const daysToNextNFP = daysUntilNext(date, NFP_DATES);

  // --- OPEX ---
  const opexDate = thirdFriday(year, month);
  const opexDateStr = formatDate(opexDate);
  const isOpexDay = date === opexDateStr;
  const isOpexWeek = isInOpexWeek(d, year, month);

  // --- Month-end / Quarter-end ---
  const lbd = lastBusinessDay(year, month);
  const lbdStr = formatDate(lbd);
  const isMonthEnd = date === lbdStr;
  const isQuarterEnd = isMonthEnd && QUARTER_END_MONTHS.has(month);

  return {
    hasMajorEconData,
    econDataType,
    daysToFOMC,
    daysToNextCPI,
    daysToNextNFP,
    isOpexWeek,
    isOpexDay,
    isMonthEnd,
    isQuarterEnd,
  };
}
