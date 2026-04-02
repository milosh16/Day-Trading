import { NextRequest, NextResponse } from "next/server";

function getAlpacaHeaders(req: NextRequest) {
  const apiKey = req.headers.get("x-alpaca-key");
  const secretKey = req.headers.get("x-alpaca-secret");
  const paper = req.headers.get("x-alpaca-paper") !== "false";

  if (!apiKey || !secretKey) {
    return null;
  }

  const baseUrl = paper
    ? "https://paper-api.alpaca.markets"
    : "https://api.alpaca.markets";

  return {
    baseUrl,
    headers: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": secretKey,
      "Content-Type": "application/json",
    },
  };
}

export async function GET(req: NextRequest) {
  const config = getAlpacaHeaders(req);
  if (!config) {
    return NextResponse.json({ error: "Alpaca keys not provided" }, { status: 401 });
  }

  try {
    const response = await fetch(`${config.baseUrl}/v2/account`, {
      headers: config.headers,
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Alpaca error: ${response.status} - ${error}` },
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
