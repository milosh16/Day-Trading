// ============================================================
// SIGNAL - Anthropic Claude API Proxy (Streaming)
// ============================================================
// Server-side proxy to keep Anthropic API key hidden.
// Uses streaming to avoid Vercel serverless timeout limits.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

// GET handler for quick diagnostics
export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ status: "error", reason: "ANTHROPIC_API_KEY not set" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 32,
        messages: [{ role: "user", content: "Say OK" }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ status: "error", code: response.status, detail: err });
    }

    return NextResponse.json({ status: "ok", model: "claude-opus-4-6" });
  } catch (e) {
    return NextResponse.json({ status: "error", detail: String(e) });
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Anthropic API key not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { messages, system, tools, max_tokens = 4096 } = body;

    const requestBody: Record<string, unknown> = {
      model: "claude-opus-4-6",
      max_tokens,
      messages,
      stream: true,
    };

    if (system) requestBody.system = system;

    // Always include web_search tool for real-time market data
    const allTools = [
      {
        type: "web_search_20260209",
        name: "web_search",
      },
      ...(tools || []),
    ];
    requestBody.tools = allTools;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Anthropic API error: ${response.status} - ${error}` },
        { status: response.status }
      );
    }

    // Stream the response through to the client
    const stream = response.body;
    if (!stream) {
      return NextResponse.json(
        { error: "No response stream from Anthropic" },
        { status: 502 }
      );
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Proxy error: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
