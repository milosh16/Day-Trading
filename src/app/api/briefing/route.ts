// ============================================================
// SIGNAL - Briefing API (Read from KV)
// ============================================================
// GET /api/briefing - Returns latest briefing
// GET /api/briefing?date=YYYY-MM-DD - Returns specific date
// GET /api/briefing?history=true - Returns list of all dates
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getLatestBriefing,
  getBriefingByDate,
  getBriefingDates,
  kvAvailable,
} from "@/lib/briefing-store";

export async function GET(req: NextRequest) {
  if (!kvAvailable()) {
    return NextResponse.json({ available: false, error: "KV not configured" }, { status: 200 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const history = searchParams.get("history");

  try {
    if (history === "true") {
      const dates = await getBriefingDates(30);
      return NextResponse.json({ available: true, dates });
    }

    if (date) {
      const briefing = await getBriefingByDate(date);
      if (!briefing) {
        return NextResponse.json({ available: true, error: "No briefing for that date" }, { status: 404 });
      }
      return NextResponse.json({ available: true, ...briefing });
    }

    const latest = await getLatestBriefing();
    if (!latest) {
      return NextResponse.json({ available: true, error: "No briefings stored yet" }, { status: 404 });
    }
    return NextResponse.json({ available: true, ...latest });
  } catch (error) {
    return NextResponse.json(
      { available: false, error: `Failed: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
