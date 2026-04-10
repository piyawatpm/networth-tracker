import { NextRequest, NextResponse } from "next/server";
import { COINGECKO_IDS } from "@/lib/utils/constants";

export const dynamic = "force-dynamic";

/**
 * POST /api/crypto-prices
 * Body: { tokens: string[] }  — token symbols that failed Binance lookup
 * Returns CoinGecko prices for tokens that have a known CoinGecko ID.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ prices: {} });
  }

  try {
    const { tokens } = (await request.json()) as { tokens: string[] };
    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ prices: {} });
    }

    // Map tokens to CoinGecko IDs
    const cgMap: { token: string; cgId: string }[] = [];
    for (const token of tokens) {
      const cgId = COINGECKO_IDS[token.toUpperCase()] ?? COINGECKO_IDS[token];
      if (cgId) cgMap.push({ token, cgId });
    }

    if (cgMap.length === 0) {
      return NextResponse.json({ prices: {} });
    }

    const ids = cgMap.map((c) => c.cgId).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { headers: { "x-cg-demo-api-key": apiKey } },
    );

    if (!res.ok) {
      return NextResponse.json({ prices: {} });
    }

    const data = await res.json();
    const prices: Record<string, number> = {};
    for (const { token, cgId } of cgMap) {
      const price = data[cgId]?.usd;
      if (price != null) prices[token] = price;
    }

    return NextResponse.json({ prices });
  } catch {
    return NextResponse.json({ prices: {} });
  }
}
