import { NextResponse } from "next/server";

export const revalidate = 86400;

interface CoinListEntry {
  id: string;
  symbol: string;
  name: string;
}

/**
 * GET /api/crypto/coin-list
 * Proxies CoinGecko's free /coins/list endpoint. Cached by Next's fetch cache
 * for 24h so the upstream call happens at most once per day.
 */
export async function GET() {
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

  try {
    const res = await fetch("https://api.coingecko.com/api/v3/coins/list", {
      headers,
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return NextResponse.json({ coins: [] }, { status: 200 });
    }
    const data = (await res.json()) as CoinListEntry[];
    const trimmed = data.map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
    }));
    return NextResponse.json({ coins: trimmed });
  } catch {
    return NextResponse.json({ coins: [] }, { status: 200 });
  }
}
