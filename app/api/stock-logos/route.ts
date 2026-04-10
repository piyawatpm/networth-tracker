import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface FinnhubProfile {
  logo?: string;
}

/**
 * Fetch the Finnhub logo for a single symbol. Cached by Next's fetch cache
 * for a week — logos rarely change and the free tier has a 60/min cap.
 */
async function fetchLogo(symbol: string): Promise<string | undefined> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return undefined;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${key}`,
      { next: { revalidate: 604800 } },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as FinnhubProfile;
    return data.logo && data.logo.length > 0 ? data.logo : undefined;
  } catch {
    return undefined;
  }
}

/**
 * GET /api/stock-logos?symbols=AAPL,VAS,VOO
 * Returns { logos: { [symbol]: url } } — omits symbols with no logo.
 * Accepts plain US symbols or AU-suffixed `.AX` symbols; the caller is
 * responsible for passing the exchange-qualified symbol when needed.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("symbols");
  if (!raw) return NextResponse.json({ logos: {} });
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);

  const entries = await Promise.all(
    symbols.map(async (sym) => {
      const logo = await fetchLogo(sym);
      return [sym, logo] as const;
    }),
  );

  const logos: Record<string, string> = {};
  for (const [sym, url] of entries) {
    if (url) logos[sym] = url;
  }
  return NextResponse.json({ logos });
}
