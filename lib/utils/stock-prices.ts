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
  source: "alpaca" | "yahoo" | "finnhub";
  extended: boolean;
}

/** Classify a trade timestamp into a US market session (ET). */
function classifyTradeTime(tradeIso: string): { state: MarketState; extended: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(tradeIso));
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (weekday === "Sat" || weekday === "Sun") return { state: "CLOSED", extended: false };
  const mins = h * 60 + m;
  if (mins >= 240 && mins < 570) return { state: "PRE", extended: true };
  if (mins >= 570 && mins < 960) return { state: "REGULAR", extended: false };
  if (mins >= 960 && mins < 1200) return { state: "POST", extended: true };
  return { state: "CLOSED", extended: false };
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

async function fetchAlpaca(ticker: string): Promise<ExtendedQuote | null> {
  const keyId = process.env.ALPACA_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secret) return null;

  try {
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(ticker.toUpperCase())}/snapshot?feed=iex`,
      {
        headers: {
          "APCA-API-KEY-ID": keyId,
          "APCA-API-SECRET-KEY": secret,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data?.latestTrade;
    if (!latest || typeof latest.p !== "number" || !latest.t) return null;
    const session = classifyTradeTime(latest.t);
    return {
      price: latest.p,
      currency: "USD",
      marketState: session.state,
      source: "alpaca",
      extended: session.extended,
    };
  } catch {
    return null;
  }
}

export async function fetchExtendedStockQuote(
  ticker: string,
  country?: string,
): Promise<ExtendedQuote | null> {
  const isAU = country?.toUpperCase() === "AU";

  // Alpaca covers pre+regular+post for US equities with millisecond-accurate trade
  // timestamps. ASX isn't available on Alpaca, so AU tickers skip straight to Yahoo.
  if (!isAU) {
    const alpaca = await fetchAlpaca(ticker);
    if (alpaca) return alpaca;
  }

  const symbol = toYahooSymbol(ticker, country);
  const yahoo = await fetchYahoo(symbol);
  if (yahoo) return yahoo;

  return fetchFinnhub(symbol, country);
}
