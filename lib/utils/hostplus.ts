// Hostplus publishes daily unit prices for every investment option behind the
// public "investment returns" page. There is no official developer API — these
// are the same endpoints the page's own client calls, and they work without a
// member login. The flow the page uses:
//
//   1. GET  …investment-returns.irm.auth.json
//        → a short-lived Bearer token (a JWT, ~20 min TTL)
//   2. GET  …investment-returns.irm.returns.json?ProductId=13&frequencyType=1
//        → 5 business days of unit prices per option, as "$1.2345" strings
//   3. GET  …investment-returns.irm.options.json?InvestmentProduct=13
//        → option name → OptionCode map (e.g. "International Shares - Indexed"
//          → "HC21A")
//
// ProductId / InvestmentProduct 13 = Superannuation; frequencyType 1 = daily
// unit pricing. Prices are calculated once per business day (published to the
// site by ~6pm Sydney), so a once-daily fetch is all this ever needs.

const BASE =
  "https://hostplus.com.au/content/hostplus-program/home/members/our-products-and-services/investment-options/investment-returns";

const REQUEST_HEADERS = {
  // The endpoints 403 without a browser-ish UA. Referer is not strictly
  // required but keeps us looking like the page that legitimately calls them.
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer:
    "https://hostplus.com.au/members/our-products-and-services/investment-options/investment-returns",
};

// Product IDs as used by the Hostplus endpoints. Only Superannuation (13) is
// verified/needed here; the others are listed for future use.
export const HOSTPLUS_PRODUCT_IDS = {
  Superannuation: 13,
  Pension: 14,
  TTR: 15,
} as const;

export type HostplusProduct = keyof typeof HOSTPLUS_PRODUCT_IDS;

// Maps a portfolio holding's `ticker` to the Hostplus OptionCode it tracks.
// The user's super sits in International Shares - Indexed (HC21A) — confirmed
// by transaction prices (~$2.9/unit) matching that option's published prices.
export const HOSTPLUS_OPTION_BY_TICKER: Record<string, string> = {
  HOSTPLUS: "HC21A",
};

export interface HostplusOptionPrice {
  /** Display name, e.g. "International Shares - Indexed" (trimmed). */
  name: string;
  /** OptionCode, e.g. "HC21A"; empty string if no match in the options list. */
  code: string;
  /** Latest daily unit price in AUD. */
  price: number;
  /** Up to 5 most-recent daily prices, oldest → newest. */
  history: number[];
  /** The Hostplus-supplied grouping, e.g. "Diversified options". */
  group: string;
}

export interface HostplusPrices {
  product: HostplusProduct;
  options: HostplusOptionPrice[];
  /** DateHeaders from Hostplus, oldest → newest, aligned to each `history`. */
  dates: string[];
  /** Free-text "last updated" stamp from Hostplus. */
  lastUpdated: string;
}

// Raw response shapes (only the fields we read).
interface ReturnsResponse {
  msg?: {
    DailyData?: {
      Key?: string;
      Items?: { currentOptionName?: string; price?: string[] }[];
    }[];
    DateHeaders?: string[];
    LastUpdatedDate?: string;
  };
}

interface OptionsResponse {
  msg?: { OptionCode?: string; OptionName?: string }[];
}

function parsePrice(raw: string): number {
  // "$1,234.5678" → 1234.5678
  const n = Number.parseFloat(raw.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Pure parser — combines the returns + options payloads into a clean list.
 * Kept free of I/O so it can be unit-tested against captured fixtures.
 */
export function parseHostplusPrices(
  returns: ReturnsResponse,
  options: OptionsResponse,
  product: HostplusProduct,
): HostplusPrices {
  const codeByName = new Map<string, string>();
  for (const o of options.msg ?? []) {
    if (o.OptionName && o.OptionCode) {
      codeByName.set(o.OptionName.trim(), o.OptionCode.trim());
    }
  }

  const parsed: HostplusOptionPrice[] = [];
  for (const section of returns.msg?.DailyData ?? []) {
    const group = section.Key ?? "";
    for (const item of section.Items ?? []) {
      const name = (item.currentOptionName ?? "").trim();
      if (!name) continue;
      const history = (item.price ?? [])
        .map(parsePrice)
        .filter((n) => Number.isFinite(n));
      if (history.length === 0) continue;
      parsed.push({
        name,
        code: codeByName.get(name) ?? "",
        price: history[history.length - 1], // last element = most recent
        history,
        group,
      });
    }
  }

  return {
    product,
    options: parsed,
    dates: returns.msg?.DateHeaders ?? [],
    lastUpdated: returns.msg?.LastUpdatedDate ?? "",
  };
}

/**
 * Reprice a Hostplus holding to `units × price`, calibrating the unit count on
 * first use. Shared by the daily cron and the manual refresh so both agree.
 *
 * The web app historically hand-edited the *total* value, leaving `units` on a
 * wrong scale. When `units × price` diverges from the stored value by more than
 * 20% we treat the units as untrustworthy and back-solve them from the value
 * (`units = currentValue / price`), keeping the displayed balance. Normal daily
 * moves (<5%) never trip the guard, so calibration effectively runs once; a
 * large manual value correction re-anchors units to the new truth.
 */
export function repriceHostplusHolding(
  holding: { units: number; currentValue: number },
  price: number,
): { units: number; currentValue: number } {
  let units = holding.units;
  const implied = units * price;
  if (
    holding.currentValue > 0 &&
    Math.abs(implied - holding.currentValue) / holding.currentValue > 0.2
  ) {
    units = holding.currentValue / price;
  }
  return { units, currentValue: units * price };
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, {
    headers: token
      ? { ...REQUEST_HEADERS, "irm-authorization": `Bearer ${token}` }
      : REQUEST_HEADERS,
    signal: AbortSignal.timeout(8000),
    // These are public daily figures; let the platform cache briefly.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Hostplus ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetch the latest daily unit prices for a Hostplus product (default: super).
 * Performs the token → returns → options handshake and returns parsed data.
 */
export async function fetchHostplusUnitPrices(
  product: HostplusProduct = "Superannuation",
): Promise<HostplusPrices> {
  const productId = HOSTPLUS_PRODUCT_IDS[product];

  // 1. Bearer token — the endpoint returns a bare JSON string (the JWT).
  const token = String(await getJson<string>(`${BASE}.irm.auth.json`)).replace(
    /^"|"$/g,
    "",
  );

  // 2 + 3. Prices and the name→code map, in parallel.
  const [returns, options] = await Promise.all([
    getJson<ReturnsResponse>(
      `${BASE}.irm.returns.json?ProductId=${productId}&frequencyType=1`,
      token,
    ),
    getJson<OptionsResponse>(
      `${BASE}.irm.options.json?InvestmentProduct=${productId}`,
      token,
    ),
  ]);

  return parseHostplusPrices(returns, options, product);
}
