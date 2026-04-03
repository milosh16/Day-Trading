// ============================================================
// SIGNAL - Regime API
// ============================================================
// Reads regime data from static JSON files in public/data/.
// These files are committed by the GitHub Actions workflow.
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  try {
    if (date) {
      const regime = await readJson(path.join(DATA_DIR, `regime-${date}.json`));
      if (!regime) {
        return NextResponse.json({ available: true, error: "No regime for that date" }, { status: 404 });
      }
      return NextResponse.json({ available: true, ...regime });
    }

    const latest = await readJson(path.join(DATA_DIR, "regime-latest.json"));
    if (!latest) {
      return NextResponse.json(
        { available: true, error: "No regime assessment yet" },
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
