// ============================================================
// SIGNAL - Training API
// ============================================================
// Reads training data from static JSON files in public/data/training/.
// These files are committed by the training engine.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data", "training");

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
  const id = searchParams.get("id");

  try {
    if (id) {
      // Find the specific trial file by scanning directory
      const files = await fs.readdir(DATA_DIR).catch(() => [] as string[]);
      const match = files.find(f => f.startsWith(`day-${id}-`) && f.endsWith(".json"));
      if (!match) {
        return NextResponse.json({ available: true, error: "No trial found for that id" }, { status: 404 });
      }
      const trial = await readJson(path.join(DATA_DIR, match));
      if (!trial) {
        return NextResponse.json({ available: true, error: "Failed to read trial data" }, { status: 500 });
      }
      return NextResponse.json({ available: true, ...trial });
    }

    // Return index
    const index = await readJson(path.join(DATA_DIR, "index.json"));
    if (!index) {
      return NextResponse.json(
        { available: true, error: "No training data yet. Run the training engine to generate trials." },
        { status: 404 },
      );
    }
    return NextResponse.json({ available: true, ...index });
  } catch (error) {
    return NextResponse.json(
      { available: false, error: `Failed: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 },
    );
  }
}
