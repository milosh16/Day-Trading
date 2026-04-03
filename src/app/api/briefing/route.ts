// ============================================================
// SIGNAL - Briefing API
// ============================================================
// Reads briefing data from static JSON files in public/data/.
// These files are committed by the GitHub Actions workflow.
// KV is used as optional secondary source.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson(filepath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(filepath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function listBriefingDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(DATA_DIR);
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
      const dates = await listBriefingDates();
      return NextResponse.json({ available: true, dates });
    }

    if (date) {
      const briefing = await readJson(path.join(DATA_DIR, `briefing-${date}.json`));
      if (!briefing) {
        return NextResponse.json({ available: true, error: "No briefing for that date" }, { status: 404 });
      }
      return NextResponse.json({ available: true, ...briefing });
    }

    // Latest
    const latest = await readJson(path.join(DATA_DIR, "briefing-latest.json"));
    if (!latest) {
      return NextResponse.json(
        { available: true, error: "No briefings yet. Briefings are auto-generated at 6:15 AM ET on weekdays." },
        { status: 404 },
      );
    }
    return NextResponse.json({ available: true, ...latest });
  } catch (error) {
    return NextResponse.json(
      { available: false, error: `Failed: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 },
    );
  }
}
