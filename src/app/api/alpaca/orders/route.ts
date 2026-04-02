import { NextRequest, NextResponse } from "next/server";

function getAlpacaConfig(req: NextRequest) {
  const apiKey = req.headers.get("x-alpaca-key");
  const secretKey = req.headers.get("x-alpaca-secret");
  const paper = req.headers.get("x-alpaca-paper") !== "false";

  if (!apiKey || !secretKey) return null;

  return {
    baseUrl: paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets",
    headers: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": secretKey,
      "Content-Type": "application/json",
    },
  };
}

// Submit order
export async function POST(req: NextRequest) {
  const config = getAlpacaConfig(req);
  if (!config) {
    return NextResponse.json({ error: "Alpaca keys not provided" }, { status: 401 });
  }

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
    const response = await fetch(`${config.baseUrl}/v2/orders`, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error }, { status: response.status });
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

// Get orders
export async function GET(req: NextRequest) {
  const config = getAlpacaConfig(req);
  if (!config) {
    return NextResponse.json({ error: "Alpaca keys not provided" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "all";
    const limit = searchParams.get("limit") || "50";

    const response = await fetch(
      `${config.baseUrl}/v2/orders?status=${status}&limit=${limit}&direction=desc`,
      { headers: config.headers }
    );

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error }, { status: response.status });
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
