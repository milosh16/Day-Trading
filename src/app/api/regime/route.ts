// ============================================================
// SIGNAL - Regime API (Read from static JSON or KV)
// ============================================================
// GET /api/regime         - Returns today's regime assessment
// GET /api/regime?date=X  - Returns regime for specific date
//
// Primary source: static JSON files in public/data/ (committed by GitHub Actions)
// Fallback: Vercel KV (if configured)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getLatestRegime, getRegimeByDate, kvAvailable } from "@/lib/briefing-store";
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  try {
    if (date) {
      if (kvAvailable()) {
        const regime = await getRegimeByDate(date);
        if (regime) return NextResponse.json({ available: true, ...regime });
      }
      const staticRegime = await readStaticJson(`regime-${date}.json`);
      if (staticRegime) return NextResponse.json({ available: true, ...staticRegime });
      return NextResponse.json({ available: true, error: "No regime for that date" }, { status: 404 });
    }

    // Latest regime: try KV first, then static file
    if (kvAvailable()) {
      const latest = await getLatestRegime();
      if (latest) return NextResponse.json({ available: true, ...latest });
    }
    const staticLatest = await readStaticJson("regime-latest.json");
    if (staticLatest) return NextResponse.json({ available: true, ...staticLatest });

    return NextResponse.json({ available: true, error: "No regime assessment yet" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { available: false, error: `Failed: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
