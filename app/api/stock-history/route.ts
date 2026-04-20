import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface Bar {
  date: string;
  close: number;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tickersParam = url.searchParams.get("tickers");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!tickersParam || !from || !to) {
    return NextResponse.json(
      { error: "tickers (comma-separated), from, to required" },
      { status: 400 },
    );
  }
  const keyId = process.env.ALPACA_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secret) {
    return NextResponse.json({ error: "Alpaca credentials missing" }, { status: 500 });
  }
  const tickers = tickersParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

  // Single multi-symbol call. feed=iex required for free-tier paper accounts.
  const apiUrl = `https://data.alpaca.markets/v2/stocks/bars?symbols=${tickers.join(",")}&timeframe=1Day&start=${from}&end=${to}&adjustment=all&feed=iex&limit=10000`;

  try {
    const res = await fetch(apiUrl, {
      cache: "no-store",
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Alpaca returned ${res.status}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as { bars?: Record<string, { t: string; c: number }[]> };
    const data: Record<string, Bar[]> = {};
    for (const [ticker, bars] of Object.entries(json.bars ?? {})) {
      data[ticker] = bars.map((b) => ({ date: b.t.slice(0, 10), close: b.c }));
    }
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fetch failed" },
      { status: 500 },
    );
  }
}
