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
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta?.regularMarketPrice) return null;

    const reportedState: MarketState = meta.marketState ?? "CLOSED";
    const currency: string = meta.currency ?? "USD";

    // Yahoo clears meta.postMarketPrice/preMarketPrice after the session ends,
    // but the raw 1-minute bars (indicators.quote[0]) still contain every trade.
    // Walk the bars from the end to find the newest non-null close, then classify
    // against currentTradingPeriod to decide regular vs pre vs post.
    const timestamps: number[] | undefined = result?.timestamp;
    const closes: (number | null)[] | undefined =
      result?.indicators?.quote?.[0]?.close;

    let bestTime: number | null = null;
    let bestPrice: number | null = null;
    if (Array.isArray(timestamps) && Array.isArray(closes)) {
      for (let i = timestamps.length - 1; i >= 0; i--) {
        const c = closes[i];
        if (typeof c === "number" && isFinite(c)) {
          bestTime = timestamps[i];
          bestPrice = c;
          break;
        }
      }
    }

    const period = meta.currentTradingPeriod;
    const regEnd: number | undefined = period?.regular?.end;
    const regStart: number | undefined = period?.regular?.start;
    const preStart: number | undefined = period?.pre?.start;
    const postEnd: number | undefined = period?.post?.end;

    let price: number = meta.regularMarketPrice;
    let kind: "regular" | "pre" | "post" = "regular";

    if (bestTime != null && bestPrice != null) {
      if (regEnd && bestTime >= regEnd && (!postEnd || bestTime <= postEnd + 60)) {
        price = bestPrice;
        kind = "post";
      } else if (
        regStart &&
        preStart &&
        bestTime < regStart &&
        bestTime >= preStart
      ) {
        price = bestPrice;
        kind = "pre";
      } else if (regStart && regEnd && bestTime >= regStart && bestTime < regEnd) {
        // Latest bar is intraday regular — use it so we track intraday moves.
        price = bestPrice;
        kind = "regular";
      }
    }

    return {
      price,
      currency,
      marketState: reportedState,
      source: "yahoo",
      extended: kind !== "regular",
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
