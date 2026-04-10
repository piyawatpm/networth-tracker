import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
  country: string;
  logo?: string;
}

interface FinnhubProfile {
  logo?: string;
}

/**
 * Fetch the Finnhub company logo for a single symbol. Cached by Next's fetch
 * cache for a week — logos rarely change and the free tier has a 60/min cap.
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

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );

    if (!res.ok) {
      return NextResponse.json({ results: [] });
    }

    const data = await res.json();
    const quotes = data.quotes ?? [];

    const baseResults: SearchResult[] = quotes
      .filter((q: { quoteType?: string }) =>
        ["EQUITY", "ETF", "MUTUALFUND", "INDEX", "BOND"].includes(q.quoteType ?? ""),
      )
      .map((q: { symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchange?: string; exchDisp?: string }) => {
        const rawSymbol = q.symbol ?? "";
        const symbol = rawSymbol.replace(/\.AX$/, "");
        const isAU = rawSymbol.endsWith(".AX");
        return {
          symbol,
          name: q.longname ?? q.shortname ?? symbol,
          type: q.quoteType ?? "EQUITY",
          exchange: q.exchDisp ?? q.exchange ?? "",
          country: isAU ? "AU" : "US",
        };
      });

    // Attach logos in parallel. US symbols reliably return logos on the free
    // tier; AU symbols may come back empty — handled by the optional field.
    const results = await Promise.all(
      baseResults.map(async (r) => {
        const lookupSymbol = r.country === "AU" ? `${r.symbol}.AX` : r.symbol;
        const logo = await fetchLogo(lookupSymbol);
        return logo ? { ...r, logo } : r;
      }),
    );

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
