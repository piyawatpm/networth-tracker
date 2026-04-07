import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface SearchResult {
  symbol: string;
  name: string;
  type: string; // "EQUITY", "ETF", "MUTUALFUND", "BOND", etc.
  exchange: string;
  country: string;
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

    const results: SearchResult[] = quotes
      .filter((q: { quoteType?: string }) =>
        ["EQUITY", "ETF", "MUTUALFUND", "INDEX", "BOND"].includes(q.quoteType ?? ""),
      )
      .map((q: { symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchange?: string; exchDisp?: string }) => {
        const symbol = (q.symbol ?? "").replace(/\.AX$/, "");
        const isAU = (q.symbol ?? "").endsWith(".AX");
        return {
          symbol,
          name: q.longname ?? q.shortname ?? symbol,
          type: q.quoteType ?? "EQUITY",
          exchange: q.exchDisp ?? q.exchange ?? "",
          country: isAU ? "AU" : "US",
        };
      });

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
