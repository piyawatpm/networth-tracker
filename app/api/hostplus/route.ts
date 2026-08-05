import { NextRequest, NextResponse } from "next/server";
import {
  fetchHostplusUnitPrices,
  type HostplusProduct,
} from "@/lib/utils/hostplus";

// Latest Hostplus daily unit prices, straight from Hostplus's public feed.
// GET /api/hostplus                → all Superannuation options
// GET /api/hostplus?code=HC21A     → just International Shares - Indexed
// GET /api/hostplus?product=Pension
//
// Prices refresh once per business day (~6pm Sydney), so cache generously.

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const product = (searchParams.get("product") ?? "Superannuation") as HostplusProduct;
  const code = searchParams.get("code")?.trim().toUpperCase();

  try {
    const data = await fetchHostplusUnitPrices(product);

    if (code) {
      const option = data.options.find((o) => o.code.toUpperCase() === code);
      if (!option) {
        return NextResponse.json(
          { error: `No option with code ${code}`, availableCodes: data.options.map((o) => o.code) },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { option, dates: data.dates, lastUpdated: data.lastUpdated },
        { headers: CACHE_HEADERS },
      );
    }

    return NextResponse.json(data, { headers: CACHE_HEADERS });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch Hostplus prices: ${String(e)}` },
      { status: 502 },
    );
  }
}
