// ============================================================
// SIGNAL - Briefing Storage (Vercel KV)
// ============================================================
// Stores daily briefings with history for accuracy tracking.
// Falls back gracefully when KV is not configured.
// ============================================================

export interface StoredBriefing {
  id: string;
  date: string; // YYYY-MM-DD
  generatedAt: string; // ISO timestamp
  model: string;
  summary: string;
  marketCondition: "bullish" | "bearish" | "neutral" | "volatile";
  sections: {
    title: string;
    content: string;
    importance: "high" | "medium" | "low";
  }[];
  scenarios: {
    event: string;
    scenarios: {
      condition: string;
      implication: string;
      trade: string;
    }[];
  }[];
  regimeType?: string; // e.g., "risk-on", "crisis" — from regime cron
  regimeConfidence?: number;
  accuracy?: {
    scoredAt: string;
    marketConditionCorrect: boolean;
    scenarioOutcomes: {
      event: string;
      predictedCondition: string;
      actualOutcome: string;
      accurate: boolean;
    }[];
    overallScore: number; // 0-100
    notes: string;
  };
}

const LATEST_KEY = "briefing:latest";
const HISTORY_PREFIX = "briefing:date:";
const HISTORY_INDEX_KEY = "briefing:dates";

export function kvAvailable(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Lazy-load @vercel/kv only when actually needed
async function getKv() {
  if (!kvAvailable()) return null;
  try {
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch {
    return null;
  }
}

export async function storeBriefing(briefing: StoredBriefing): Promise<boolean> {
  const kv = await getKv();
  if (!kv) return false;

  try {
    await Promise.all([
      kv.set(LATEST_KEY, briefing),
      kv.set(`${HISTORY_PREFIX}${briefing.date}`, briefing),
      kv.zadd(HISTORY_INDEX_KEY, { score: new Date(briefing.date).getTime(), member: briefing.date }),
    ]);
    return true;
  } catch (e) {
    console.error("Failed to store briefing:", e);
    return false;
  }
}

export async function getLatestBriefing(): Promise<StoredBriefing | null> {
  const kv = await getKv();
  if (!kv) return null;

  try {
    return await kv.get<StoredBriefing>(LATEST_KEY);
  } catch {
    return null;
  }
}

export async function getBriefingByDate(date: string): Promise<StoredBriefing | null> {
  const kv = await getKv();
  if (!kv) return null;

  try {
    return await kv.get<StoredBriefing>(`${HISTORY_PREFIX}${date}`);
  } catch {
    return null;
  }
}

export async function getBriefingDates(limit = 30): Promise<string[]> {
  const kv = await getKv();
  if (!kv) return [];

  try {
    const dates = await kv.zrange(HISTORY_INDEX_KEY, 0, limit - 1, { rev: true });
    return dates as string[];
  } catch {
    return [];
  }
}

// --- Regime Storage ---

const REGIME_LATEST_KEY = "regime:latest";
const REGIME_HISTORY_PREFIX = "regime:date:";

export async function storeRegime(date: string, regime: Record<string, unknown>): Promise<boolean> {
  const kv = await getKv();
  if (!kv) return false;

  try {
    await Promise.all([
      kv.set(REGIME_LATEST_KEY, regime),
      kv.set(`${REGIME_HISTORY_PREFIX}${date}`, regime),
    ]);
    return true;
  } catch (e) {
    console.error("Failed to store regime:", e);
    return false;
  }
}

export async function getLatestRegime(): Promise<Record<string, unknown> | null> {
  const kv = await getKv();
  if (!kv) return null;

  try {
    return await kv.get<Record<string, unknown>>(REGIME_LATEST_KEY);
  } catch {
    return null;
  }
}

export async function getRegimeByDate(date: string): Promise<Record<string, unknown> | null> {
  const kv = await getKv();
  if (!kv) return null;

  try {
    return await kv.get<Record<string, unknown>>(`${REGIME_HISTORY_PREFIX}${date}`);
  } catch {
    return null;
  }
}

export async function storeAccuracy(
  date: string,
  accuracy: StoredBriefing["accuracy"]
): Promise<boolean> {
  const kv = await getKv();
  if (!kv) return false;

  try {
    const briefing = await getBriefingByDate(date);
    if (!briefing) return false;

    briefing.accuracy = accuracy;
    await kv.set(`${HISTORY_PREFIX}${date}`, briefing);

    const latest = await getLatestBriefing();
    if (latest && latest.date === date) {
      latest.accuracy = accuracy;
      await kv.set(LATEST_KEY, latest);
    }

    return true;
  } catch {
    return false;
  }
}
