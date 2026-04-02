// ============================================================
// SIGNAL - Position Monitor API
// ============================================================
// Checks positions against stops and targets, sends alerts.
// Called by client-side polling during market hours.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed request body" },
      { status: 400 }
    );
  }

  try {
    const { positions, ntfyTopic } = body;

    if (!positions || !Array.isArray(positions) || !ntfyTopic) {
      return NextResponse.json({ alerts: [] });
    }

    const alerts: { symbol: string; type: string; message: string }[] = [];

    for (const pos of positions) {
      const { symbol, currentPrice, stopLoss, targetPrice } = pos;
      if (!currentPrice || !symbol) continue;

      if (stopLoss && currentPrice <= stopLoss) {
        alerts.push({
          symbol,
          type: "stop_hit",
          message: `${symbol} hit stop loss at $${currentPrice.toFixed(2)} (stop: $${stopLoss.toFixed(2)})`,
        });

        // Send push notification
        await fetch(`https://ntfy.sh/${ntfyTopic}`, {
          method: "POST",
          headers: {
            Title: `STOP HIT: ${symbol}`,
            Priority: "urgent",
            Tags: "warning,chart_with_downwards_trend",
          },
          body: `${symbol} hit stop loss at $${currentPrice.toFixed(2)} (stop: $${stopLoss.toFixed(2)}). Consider closing position.`,
        }).catch((err) => { console.error(`Failed to send stop-hit notification for ${symbol}:`, err); });
      }

      if (targetPrice && currentPrice >= targetPrice) {
        alerts.push({
          symbol,
          type: "target_hit",
          message: `${symbol} reached target at $${currentPrice.toFixed(2)} (target: $${targetPrice.toFixed(2)})`,
        });

        await fetch(`https://ntfy.sh/${ntfyTopic}`, {
          method: "POST",
          headers: {
            Title: `TARGET HIT: ${symbol}`,
            Priority: "high",
            Tags: "white_check_mark,chart_with_upwards_trend",
          },
          body: `${symbol} reached target at $${currentPrice.toFixed(2)} (target: $${targetPrice.toFixed(2)}). Consider taking profits.`,
        }).catch((err) => { console.error(`Failed to send target-hit notification for ${symbol}:`, err); });
      }
    }

    return NextResponse.json({ alerts });
  } catch (error) {
    return NextResponse.json(
      { error: `Monitor error: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
