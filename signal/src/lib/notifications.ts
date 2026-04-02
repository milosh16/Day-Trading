// ============================================================
// SIGNAL - Push Notifications via ntfy.sh
// ============================================================
// ntfy.sh is a simple pub/sub notification service.
// No signup required. User sets a topic name, subscribes
// on their iPhone via the ntfy app, and we POST to it.
// ============================================================

export async function sendNotification(
  topic: string,
  title: string,
  message: string,
  priority: "urgent" | "high" | "default" | "low" = "high",
  tags?: string[]
): Promise<boolean> {
  if (!topic) return false;

  try {
    const response = await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: priority,
        Tags: tags?.join(",") || "chart_with_upwards_trend",
      },
      body: message,
    });
    return response.ok;
  } catch {
    console.error("Failed to send notification");
    return false;
  }
}

export function buildStopHitMessage(symbol: string, price: number, stopLoss: number): string {
  return `${symbol} hit stop loss at $${price.toFixed(2)} (stop: $${stopLoss.toFixed(2)}). Consider closing position.`;
}

export function buildTargetHitMessage(symbol: string, price: number, target: number): string {
  return `${symbol} reached target at $${price.toFixed(2)} (target: $${target.toFixed(2)}). Consider taking profits.`;
}
