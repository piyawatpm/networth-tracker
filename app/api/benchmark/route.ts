import { NextRequest, NextResponse } from "next/server";

// Daily-close history for benchmark indices. SPY proxies the same unofficial
// Yahoo chart endpoint the snapshot cron relies on; BTC uses Binance klines
// (the app's existing crypto price source, no key required).

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
};

async function fetchSpy(period1: number, period2: number) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&period1=${period1}&period2=${period2}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 21600 },
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const timestamps: number[] | undefined = result?.timestamp;
  const closes: (number | null)[] | undefined =
    result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;
  const prices: { date: string; close: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c !== "number" || !Number.isFinite(c)) continue;
    prices.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close: c,
    });
  }
  return prices;
}

async function fetchBtc(startMs: number) {
  // Binance returns the FIRST 1000 daily candles after startTime, so clamp
  // the start to keep the 1000-candle window ending at today — otherwise a
  // far-past `from` returns 2020-2022 and never reaches the present.
  const clampedStart = Math.max(startMs, Date.now() - 999 * 86400000);
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${clampedStart}&limit=1000`,
    { signal: AbortSignal.timeout(8000), next: { revalidate: 21600 } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as unknown[];
  if (!Array.isArray(data)) return null;
  const prices: { date: string; close: number }[] = [];
  for (const k of data) {
    if (!Array.isArray(k)) continue;
    const close = parseFloat(k[4] as string);
    if (!Number.isFinite(close)) continue;
    prices.push({
      date: new Date(k[0] as number).toISOString().slice(0, 10),
      close,
    });
  }
  return prices;
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "SPY").toUpperCase();
  if (symbol !== "SPY" && symbol !== "BTC") {
    return NextResponse.json(
      { error: `unsupported symbol ${symbol}` },
      { status: 400 },
    );
  }
  const from = req.nextUrl.searchParams.get("from");
  const fromMs = from
    ? Date.parse(from + "T00:00:00Z") - 14 * 86400000
    : Date.parse("2020-01-01");
  const startMs = Number.isFinite(fromMs) ? fromMs : Date.parse("2020-01-01");

  try {
    const prices =
      symbol === "BTC"
        ? await fetchBtc(startMs)
        : await fetchSpy(Math.floor(startMs / 1000), Math.floor(Date.now() / 1000));
    if (!prices || prices.length === 0) {
      return NextResponse.json({ error: "upstream failed" }, { status: 502 });
    }
    return NextResponse.json({ symbol, prices }, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ error: "benchmark fetch failed" }, { status: 502 });
  }
}
