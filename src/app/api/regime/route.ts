// ============================================================
// SIGNAL - Regime API (Read from KV)
// ============================================================
// GET /api/regime         - Returns today's regime assessment
// GET /api/regime?date=X  - Returns regime for specific date
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getLatestRegime, getRegimeByDate, kvAvailable } from "@/lib/briefing-store";

export async function GET(req: NextRequest) {
  if (!kvAvailable()) {
    return NextResponse.json({ available: false, error: "KV not configured" }, { status: 200 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  try {
    if (date) {
      const regime = await getRegimeByDate(date);
      if (!regime) {
        return NextResponse.json({ available: true, error: "No regime for that date" }, { status: 404 });
      }
      return NextResponse.json({ available: true, ...regime });
    }

    const latest = await getLatestRegime();
    if (!latest) {
      return NextResponse.json({ available: true, error: "No regime assessment yet" }, { status: 404 });
    }
    return NextResponse.json({ available: true, ...latest });
  } catch (error) {
    return NextResponse.json(
      { available: false, error: `Failed: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
