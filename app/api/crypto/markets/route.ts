import { NextResponse } from "next/server";

export const revalidate = 300;

/**
 * GET /api/crypto/markets?ids=bitcoin,ethereum&order=market_cap_desc
 * Proxies CoinGecko's /coins/markets endpoint to avoid browser CORS.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = searchParams.get("ids") ?? "";
  if (!ids) {
    return NextResponse.json([], { status: 200 });
  }

  const order = searchParams.get("order") ?? "";
  const perPage =
    searchParams.get("per_page") ?? String(ids.split(",").length || 1);
  const page = searchParams.get("page") ?? "1";

  const upstream = new URL("https://api.coingecko.com/api/v3/coins/markets");
  upstream.searchParams.set("vs_currency", "usd");
  upstream.searchParams.set("ids", ids);
  if (order) upstream.searchParams.set("order", order);
  upstream.searchParams.set("per_page", perPage);
  upstream.searchParams.set("page", page);
  upstream.searchParams.set("sparkline", "false");

  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

  try {
    const res = await fetch(upstream.toString(), {
      headers,
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return NextResponse.json([], { status: 200 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
