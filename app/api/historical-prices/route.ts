import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface DailyClose {
  date: string;
  close: number;
}

const STABLES = new Set([
  "USDT", "USDC", "USDe", "USD1", "DAI", "BUSD", "TUSD", "FDUSD", "GUSD",
  "syrupUSDC".toUpperCase(),
]);

async function binanceCloses(token: string, from: string, to: string): Promise<DailyClose[]> {
  if (STABLES.has(token.toUpperCase())) {
    // Stablecoins peg to $1; synthesize daily series so reconstruction works.
    const out: DailyClose[] = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push({ date: d.toISOString().slice(0, 10), close: 1 });
    }
    return out;
  }
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T23:59:59Z`).getTime();
  const symbol = `${token.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&startTime=${start}&endTime=${end}&limit=1000`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown[][];
    return data.map((k) => ({
      date: new Date(k[0] as number).toISOString().slice(0, 10),
      close: parseFloat(k[4] as string),
    }));
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const tokensParam = url.searchParams.get("tokens");
  if (!from || !to || !tokensParam) {
    return NextResponse.json(
      { error: "from, to, and tokens (comma-separated) required" },
      { status: 400 },
    );
  }
  const tokens = tokensParam.split(",").map((t) => t.trim()).filter(Boolean);
  const results = await Promise.all(
    tokens.map(async (t) => [t, await binanceCloses(t, from, to)] as const),
  );
  const data: Record<string, DailyClose[]> = {};
  for (const [token, closes] of results) {
    data[token] = closes;
  }
  return NextResponse.json({ data });
}
