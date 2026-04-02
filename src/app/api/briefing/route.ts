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
} from "@/lib/briefing-store";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const history = searchParams.get("history");

  try {
    // Return list of briefing dates
    if (history === "true") {
      const dates = await getBriefingDates(30);
      return NextResponse.json({ dates });
    }

    // Return specific date's briefing
    if (date) {
      const briefing = await getBriefingByDate(date);
      if (!briefing) {
        return NextResponse.json({ error: "No briefing for that date" }, { status: 404 });
      }
      return NextResponse.json(briefing);
    }

    // Return latest briefing
    const latest = await getLatestBriefing();
    if (!latest) {
      return NextResponse.json({ error: "No briefings stored yet" }, { status: 404 });
    }
    return NextResponse.json(latest);
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch briefing: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
