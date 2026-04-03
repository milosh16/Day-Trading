// ============================================================
// SIGNAL - Briefing API (Read from static JSON or KV)
// ============================================================
// GET /api/briefing - Returns latest briefing
// GET /api/briefing?date=YYYY-MM-DD - Returns specific date
// GET /api/briefing?history=true - Returns list of all dates
//
// Primary source: static JSON files in public/data/ (committed by GitHub Actions)
// Fallback: Vercel KV (if configured)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getLatestBriefing,
  getBriefingByDate,
  getBriefingDates,
  kvAvailable,
} from "@/lib/briefing-store";
import { promises as fs } from "fs";
import path from "path";

async function readStaticJson(filename: string): Promise<Record<string, unknown> | null> {
  try {
    const filePath = path.join(process.cwd(), "public", "data", filename);
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function listStaticBriefingDates(): Promise<string[]> {
  try {
    const dataDir = path.join(process.cwd(), "public", "data");
    const files = await fs.readdir(dataDir);
    return files
      .filter(f => f.startsWith("briefing-") && f !== "briefing-latest.json" && f.endsWith(".json"))
      .map(f => f.replace("briefing-", "").replace(".json", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const history = searchParams.get("history");

  try {
    if (history === "true") {
      // Try KV first, then static files
      if (kvAvailable()) {
        const dates = await getBriefingDates(30);
        if (dates.length > 0) return NextResponse.json({ available: true, dates });
      }
      const staticDates = await listStaticBriefingDates();
      return NextResponse.json({ available: true, dates: staticDates });
    }

    if (date) {
      // Try KV first, then static file
      if (kvAvailable()) {
        const briefing = await getBriefingByDate(date);
        if (briefing) return NextResponse.json({ available: true, ...briefing });
      }
      const staticBriefing = await readStaticJson(`briefing-${date}.json`);
      if (staticBriefing) return NextResponse.json({ available: true, ...staticBriefing });
      return NextResponse.json({ available: true, error: "No briefing for that date" }, { status: 404 });
    }

    // Latest briefing: try KV first, then static file
    if (kvAvailable()) {
      const latest = await getLatestBriefing();
      if (latest) return NextResponse.json({ available: true, ...latest });
    }
    const staticLatest = await readStaticJson("briefing-latest.json");
    if (staticLatest) return NextResponse.json({ available: true, ...staticLatest });

    return NextResponse.json({ available: true, error: "No briefings stored yet" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { available: false, error: `Failed: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
