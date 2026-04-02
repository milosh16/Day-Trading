// ============================================================
// SIGNAL - Briefing Storage (Vercel KV)
// ============================================================
// Stores daily briefings with history for accuracy tracking.
// Falls back gracefully when KV is not configured.
// ============================================================

import { kv } from "@vercel/kv";

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
  // Accuracy tracking (filled in after market close)
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
const HISTORY_INDEX_KEY = "briefing:dates"; // sorted set of dates

function kvAvailable(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Store a briefing
export async function storeBriefing(briefing: StoredBriefing): Promise<boolean> {
  if (!kvAvailable()) return false;

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

// Get the latest briefing
export async function getLatestBriefing(): Promise<StoredBriefing | null> {
  if (!kvAvailable()) return null;

  try {
    return await kv.get<StoredBriefing>(LATEST_KEY);
  } catch {
    return null;
  }
}

// Get briefing for a specific date
export async function getBriefingByDate(date: string): Promise<StoredBriefing | null> {
  if (!kvAvailable()) return null;

  try {
    return await kv.get<StoredBriefing>(`${HISTORY_PREFIX}${date}`);
  } catch {
    return null;
  }
}

// Get list of all briefing dates (most recent first)
export async function getBriefingDates(limit = 30): Promise<string[]> {
  if (!kvAvailable()) return [];

  try {
    const dates = await kv.zrange(HISTORY_INDEX_KEY, 0, limit - 1, { rev: true });
    return dates as string[];
  } catch {
    return [];
  }
}

// Store accuracy score for a date
export async function storeAccuracy(
  date: string,
  accuracy: StoredBriefing["accuracy"]
): Promise<boolean> {
  if (!kvAvailable()) return false;

  try {
    const briefing = await getBriefingByDate(date);
    if (!briefing) return false;

    briefing.accuracy = accuracy;
    await kv.set(`${HISTORY_PREFIX}${date}`, briefing);

    // Also update latest if it's today's
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
