// ============================================================
// SIGNAL - Anthropic Claude API Proxy
// ============================================================
// Server-side proxy to keep Anthropic API key hidden.
// Supports web_search tool for real-time data retrieval.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

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
      model: "claude-sonnet-4-6",
      max_tokens,
      messages,
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

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: `Proxy error: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 500 }
    );
  }
}
