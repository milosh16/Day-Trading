// ============================================================
// Training - Historical Date Selection
// ============================================================
// Generates a list of real US market trading days for testing.
// Excludes weekends and major holidays.
// Uses a seeded PRNG so the same inputs always produce the
// same output — no more data loss on restart.
// ============================================================

// Seed-based PRNG (Mulberry32) — same seed always produces same sequence
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// US market holidays 2024-2026 (observed dates)
const US_MARKET_HOLIDAYS = new Set([
  // 2023
  "2023-01-02", // New Year's Day (observed)
  "2023-01-16", // MLK Day
  "2023-02-20", // Presidents' Day
  "2023-04-07", // Good Friday
  "2023-05-29", // Memorial Day
  "2023-06-19", // Juneteenth
  "2023-07-04", // Independence Day
  "2023-09-04", // Labor Day
  "2023-11-23", // Thanksgiving
  "2023-12-25", // Christmas
  // 2024
  "2024-01-01", // New Year's Day
  "2024-01-15", // MLK Day
  "2024-02-19", // Presidents' Day
  "2024-03-29", // Good Friday
  "2024-05-27", // Memorial Day
  "2024-06-19", // Juneteenth
  "2024-07-04", // Independence Day
  "2024-09-02", // Labor Day
  "2024-11-28", // Thanksgiving
  "2024-12-25", // Christmas
  // 2025
  "2025-01-01", // New Year's Day
  "2025-01-20", // MLK Day
  "2025-02-17", // Presidents' Day
  "2025-04-18", // Good Friday
  "2025-05-26", // Memorial Day
  "2025-06-19", // Juneteenth
  "2025-07-04", // Independence Day
  "2025-09-01", // Labor Day
  "2025-11-27", // Thanksgiving
  "2025-12-25", // Christmas
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents' Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed — Jul 4 is Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
]);

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function isHoliday(dateStr: string): boolean {
  return US_MARKET_HOLIDAYS.has(dateStr);
}

// Return every trading day (Mon-Fri, excluding US market holidays) between two dates
export function getAllTradingDays(startDate: string, endDate: string): string[] {
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  const days: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dateStr = formatDate(current);
    if (isWeekday(current) && !isHoliday(dateStr)) {
      days.push(dateStr);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}

// Generate N deterministic random trading days between start and end dates.
// Same seed + same date range + same count = always same output.
export function getRandomTradingDays(
  count: number,
  startDate: string,
  endDate: string,
  seed: number = 42,
): string[] {
  const allDays = getAllTradingDays(startDate, endDate);

  // Fisher-Yates shuffle with seeded PRNG
  const rng = mulberry32(seed);
  for (let i = allDays.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allDays[i], allDays[j]] = [allDays[j], allDays[i]];
  }

  return allDays.slice(0, Math.min(count, allDays.length));
}

// Get sequential trading days (for ordered testing)
export function getSequentialTradingDays(count: number, startDate: string): string[] {
  const start = new Date(startDate + "T00:00:00Z");
  const days: string[] = [];
  const current = new Date(start);

  while (days.length < count) {
    const dateStr = formatDate(current);
    if (isWeekday(current) && !isHoliday(dateStr)) {
      days.push(dateStr);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}
