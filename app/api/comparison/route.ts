import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ComparisonPoint {
  date: string;
  btc: number | null;
  spy: number | null;
}

async function fetchBtcCloses(from: string, to: string): Promise<Map<string, number>> {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T23:59:59Z`).getTime();
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${start}&endTime=${end}&limit=1000`;
  const map = new Map<string, number>();
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return map;
    const data = (await res.json()) as unknown[][];
    for (const k of data) {
      const day = new Date(k[0] as number).toISOString().slice(0, 10);
      map.set(day, parseFloat(k[4] as string));
    }
  } catch {
    // network failure → return empty map
  }
  return map;
}

async function fetchSpyCloses(from: string, to: string): Promise<Map<string, number>> {
  const keyId = process.env.ALPACA_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  const map = new Map<string, number>();
  if (!keyId || !secret) return map;
  // feed=iex required for free-tier paper accounts; SIP needs a paid plan.
  const url = `https://data.alpaca.markets/v2/stocks/SPY/bars?start=${from}&end=${to}&timeframe=1Day&adjustment=all&feed=iex&limit=10000`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
      },
    });
    if (!res.ok) return map;
    const data = (await res.json()) as { bars?: { t: string; c: number }[] };
    for (const bar of data.bars ?? []) {
      map.set(bar.t.slice(0, 10), bar.c);
    }
  } catch {
    // network failure → return empty map
  }
  return map;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from and to required (YYYY-MM-DD)" }, { status: 400 });
  }

  const [btc, spy] = await Promise.all([fetchBtcCloses(from, to), fetchSpyCloses(from, to)]);

  const dates = new Set<string>([...btc.keys(), ...spy.keys()]);
  const data: ComparisonPoint[] = [...dates]
    .sort()
    .map((date) => ({ date, btc: btc.get(date) ?? null, spy: spy.get(date) ?? null }));

  return NextResponse.json({ data });
}
