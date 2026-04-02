import { NextRequest, NextResponse } from "next/server";

// Yahoo Finance chart API — no key needed, server-side only
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

// Map country suffix for Yahoo tickers
function toYahooTicker(ticker: string, country: string): string {
  const t = ticker.toUpperCase();
  // Already has suffix
  if (t.includes(".")) return t;
  // Australian securities
  if (country.toUpperCase() === "AU") return `${t}.AX`;
  // US is default (no suffix)
  return t;
}

interface PriceResult {
  ticker: string;
  price: number | null;
  currency: string;
  error?: string;
}

async function fetchPrice(
  ticker: string,
  country: string
): Promise<PriceResult> {
  const yahooTicker = toYahooTicker(ticker, country);
  try {
    const res = await fetch(
      `${YAHOO_BASE}/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 3600 }, // cache 1 hour
      }
    );

    if (!res.ok) {
      return { ticker, price: null, currency: "", error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) {
      return { ticker, price: null, currency: "", error: "No data" };
    }

    return {
      ticker,
      price: meta.regularMarketPrice ?? null,
      currency: meta.currency ?? "USD",
    };
  } catch (e) {
    return {
      ticker,
      price: null,
      currency: "",
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const holdings: { ticker: string; country: string }[] = body.holdings ?? [];

    if (holdings.length === 0) {
      return NextResponse.json({ prices: [] });
    }

    // Fetch all in parallel (max 20 to be safe)
    const results = await Promise.all(
      holdings.slice(0, 20).map((h) => fetchPrice(h.ticker, h.country))
    );

    return NextResponse.json({ prices: results, fetchedAt: Date.now() });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch prices" },
      { status: 500 }
    );
  }
}
