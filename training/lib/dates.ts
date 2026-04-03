// ============================================================
// Training - Historical Date Selection
// ============================================================
// Generates a list of real US market trading days for testing.
// Excludes weekends and major holidays.
// ============================================================

const US_HOLIDAYS_2024_2025 = new Set([
  // 2024
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29",
  "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02",
  "2024-11-28", "2024-12-25",
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18",
  "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01",
  "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
]);

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function isHoliday(dateStr: string): boolean {
  return US_HOLIDAYS_2024_2025.has(dateStr);
}

// Generate N random trading days between start and end dates
export function getRandomTradingDays(count: number, startDate: string, endDate: string): string[] {
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  // Build list of all trading days in range
  const allDays: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dateStr = formatDate(current);
    if (isWeekday(current) && !isHoliday(dateStr)) {
      allDays.push(dateStr);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Shuffle and take N
  for (let i = allDays.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
