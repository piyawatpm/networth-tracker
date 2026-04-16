import { NextRequest, NextResponse } from "next/server";
import { fetchExtendedStockQuote, type MarketState } from "@/lib/utils/stock-prices";

export const dynamic = "force-dynamic";

interface PriceResult {
  ticker: string;
  price: number | null;
  currency: string;
  marketState?: MarketState;
  extended?: boolean;
  source?: "alpaca" | "yahoo" | "finnhub";
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const holdings: { ticker: string; country: string }[] = body.holdings ?? [];

    if (holdings.length === 0) {
      return NextResponse.json({ prices: [] });
    }

    const results: PriceResult[] = await Promise.all(
      holdings.slice(0, 20).map(async (h) => {
        const quote = await fetchExtendedStockQuote(h.ticker, h.country);
        if (!quote) {
          return { ticker: h.ticker, price: null, currency: "", error: "No data" };
        }
        return {
          ticker: h.ticker,
          price: quote.price,
          currency: quote.currency,
          marketState: quote.marketState,
          extended: quote.extended,
          source: quote.source,
        };
      }),
    );

    return NextResponse.json({ prices: results, fetchedAt: Date.now() });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch prices" },
      { status: 500 }
    );
  }
}
