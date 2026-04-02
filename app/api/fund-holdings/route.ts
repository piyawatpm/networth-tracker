import { NextRequest, NextResponse } from "next/server";

// Yahoo Finance quoteSummary — topHoldings module
const YAHOO_BASE = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";

function toYahooTicker(ticker: string, country: string): string {
  const t = ticker.toUpperCase();
  if (t.includes(".")) return t;
  if (country.toUpperCase() === "AU") return `${t}.AX`;
  return t;
}

interface FundHolding {
  symbol: string;
  name: string;
  weight: number; // 0-100 percentage
}

interface FundHoldingsResult {
  ticker: string;
  holdings: FundHolding[];
  sectorWeightings: { sector: string; weight: number }[];
  error?: string;
}

async function fetchFundHoldings(
  ticker: string,
  country: string,
): Promise<FundHoldingsResult> {
  const yahooTicker = toYahooTicker(ticker, country);
  try {
    const res = await fetch(
      `${YAHOO_BASE}/${encodeURIComponent(yahooTicker)}?modules=topHoldings`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 86400 }, // cache 24 hours
      },
    );

    if (!res.ok) {
      return { ticker, holdings: [], sectorWeightings: [], error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const topHoldings =
      data?.quoteSummary?.result?.[0]?.topHoldings;

    if (!topHoldings) {
      return {
        ticker,
        holdings: [],
        sectorWeightings: [],
        error: "No holdings data available",
      };
    }

    // Extract top holdings
    const holdings: FundHolding[] = (topHoldings.holdings ?? []).map(
      (h: { symbol?: { raw?: string }; holdingName?: string; holdingPercent?: { raw?: number } }) => ({
        symbol: h.symbol?.raw ?? h.symbol ?? "",
        name: h.holdingName ?? "",
        weight: ((h.holdingPercent?.raw ?? 0) * 100),
      }),
    );

    // Extract sector weightings
    const sectorWeightings: { sector: string; weight: number }[] = (
      topHoldings.sectorWeightings ?? []
    ).flatMap(
      (sw: Record<string, { raw?: number }>) =>
        Object.entries(sw)
          .filter(([, v]) => typeof v === "object" && v?.raw !== undefined)
          .map(([sector, v]) => ({
            sector: sector.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            weight: ((v as { raw: number }).raw ?? 0) * 100,
          })),
    );

    return { ticker, holdings, sectorWeightings };
  } catch (e) {
    return {
      ticker,
      holdings: [],
      sectorWeightings: [],
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, country } = body;

    if (!ticker) {
      return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    }

    const result = await fetchFundHoldings(ticker, country ?? "US");
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch fund holdings" },
      { status: 500 },
    );
  }
}
