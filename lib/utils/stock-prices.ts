/**
 * Server-side stock price fetcher with extended-hours (pre/post market) support.
 *
 * Primary source: Yahoo Finance chart endpoint — returns marketState and
 * pre/regular/post prices in one payload. Free, no key required.
 * Fallback: Finnhub REST /quote (regular-hours only on free tier).
 */

export type MarketState =
  | "PRE"
  | "REGULAR"
  | "POST"
  | "CLOSED"
  | "PREPRE"
  | "POSTPOST";

export interface ExtendedQuote {
  price: number;
  currency: string;
  marketState: MarketState;
  source: "yahoo" | "finnhub";
  extended: boolean;
}

function toYahooSymbol(ticker: string, country?: string): string {
  const upper = ticker.toUpperCase();
  if (country?.toUpperCase() === "AU") return `${upper}.AX`;
  return upper;
}

async function fetchYahoo(symbol: string): Promise<ExtendedQuote | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "application/json",
        },
        // Yahoo is unofficial — keep this short
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const marketState: MarketState = meta.marketState ?? "CLOSED";
    let price: number = meta.regularMarketPrice;
    let extended = false;

    if (marketState === "PRE" && meta.preMarketPrice) {
      price = meta.preMarketPrice;
      extended = true;
    } else if (
      (marketState === "POST" || marketState === "POSTPOST") &&
      meta.postMarketPrice
    ) {
      price = meta.postMarketPrice;
      extended = true;
    }

    return {
      price,
      currency: meta.currency ?? "USD",
      marketState,
      source: "yahoo",
      extended,
    };
  } catch {
    return null;
  }
}

async function fetchFinnhub(
  symbol: string,
  country?: string,
): Promise<ExtendedQuote | null> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.c || data.c <= 0) return null;
    return {
      price: data.c,
      currency: country?.toUpperCase() === "US" ? "USD" : "AUD",
      marketState: "REGULAR",
      source: "finnhub",
      extended: false,
    };
  } catch {
    return null;
  }
}

export async function fetchExtendedStockQuote(
  ticker: string,
  country?: string,
): Promise<ExtendedQuote | null> {
  const symbol = toYahooSymbol(ticker, country);

  const yahoo = await fetchYahoo(symbol);
  if (yahoo) return yahoo;

  return fetchFinnhub(symbol, country);
}
