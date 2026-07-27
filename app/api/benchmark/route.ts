import { NextRequest, NextResponse } from "next/server";

// Daily-close history for the benchmark index (SPY). Same unofficial Yahoo
// chart endpoint the snapshot cron already relies on, so no new upstream.
const SYMBOL = "SPY";

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  // period1 must predate the requested window slightly so the first close
  // exists on or before `from` (weekends/holidays).
  const fromMs = from
    ? Date.parse(from + "T00:00:00Z") - 14 * 86400000
    : Date.parse("2020-01-01");
  const period1 = Math.floor(
    (Number.isFinite(fromMs) ? fromMs : Date.parse("2020-01-01")) / 1000,
  );
  const period2 = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}?interval=1d&period1=${period1}&period2=${period2}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
        next: { revalidate: 21600 }, // 6h — daily closes don't need more
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps: number[] | undefined = result?.timestamp;
    const closes: (number | null)[] | undefined =
      result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closes)) {
      return NextResponse.json({ error: "malformed upstream payload" }, { status: 502 });
    }
    const prices: { date: string; close: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (typeof c !== "number" || !Number.isFinite(c)) continue;
      prices.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close: c,
      });
    }
    return NextResponse.json(
      { symbol: SYMBOL, prices },
      {
        headers: {
          "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return NextResponse.json({ error: "benchmark fetch failed" }, { status: 502 });
  }
}
