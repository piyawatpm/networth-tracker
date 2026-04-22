import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { captureBaseline } from "@/lib/utils/analytics-baseline";
import { parseAndComputeHoldings, applyStablecoinTags } from "@/lib/utils/crypto-csv";
import type { AnalyticsBaseline, PortfolioHolding } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

async function getFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (!res.ok) return {};
    const data = await res.json();
    return data.rates ?? {};
  } catch {
    return {};
  }
}

async function fetchBtcClose(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data.price);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

async function fetchSpyClose(): Promise<number | null> {
  const keyId = process.env.ALPACA_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secret) return null;
  try {
    const res = await fetch(
      "https://data.alpaca.markets/v2/stocks/SPY/bars/latest?feed=iex",
      { cache: "no-store", headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { bar?: { c: number } };
    return data.bar?.c ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from("analytics_baseline")
    .select("snapshot")
    .eq("is_current", true)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ baseline: (data?.snapshot ?? null) as AnalyticsBaseline | null });
}

export async function POST() {
  // Pull current state from app_data KV
  const { data: rows, error: readErr } = await supabase
    .from("app_data")
    .select("key, value")
    .in("key", ["portfolio_holdings", "crypto_csv_text", "crypto_stablecoin_tags", "crypto_prices"]);
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const kv: Record<string, string> = {};
  for (const r of rows ?? []) kv[r.key] = r.value;
  const parse = <T,>(k: string, fb: T): T => { try { return kv[k] ? JSON.parse(kv[k]) : fb; } catch { return fb; } };

  const holdings = parse<PortfolioHolding[]>("portfolio_holdings", []);
  const csvText = parse<string>("crypto_csv_text", "");
  const tags = parse<Record<string, boolean>>("crypto_stablecoin_tags", {});
  const cachedPrices = parse<{ prices: Record<string, number> }>("crypto_prices", { prices: {} });

  // Build crypto holdings with live prices applied
  let cryptoHoldings = csvText ? parseAndComputeHoldings(csvText) : [];
  for (const h of cryptoHoldings) {
    const p = cachedPrices.prices?.[h.token];
    if (p != null && h.amount > 0) h.currentValueUsd = p * h.amount;
  }
  cryptoHoldings = applyStablecoinTags(cryptoHoldings, tags);

  // Benchmarks + FX
  const [spy, btc, rates] = await Promise.all([fetchSpyClose(), fetchBtcClose(), getFxRates()]);
  if (spy == null || btc == null) {
    return NextResponse.json(
      { error: "Could not fetch SPY or BTC price; baseline not written" },
      { status: 502 },
    );
  }

  const fxToUsd = (amount: number, currency: string) => {
    if (currency === "USD" || !rates[currency]) return amount;
    return amount / rates[currency];
  };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  const baseline = captureBaseline({ date: today, holdings, cryptoHoldings, spy, btc, fxToUsd });

  // Write — mark previous as inactive, insert new as current
  await supabase.from("analytics_baseline").update({ is_current: false }).eq("is_current", true);
  const { error: insErr } = await supabase.from("analytics_baseline").insert({
    date: today,
    snapshot: baseline,
    is_current: true,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Mirror to KV for client reads
  await supabase.from("app_data").upsert(
    { key: "analytics_baseline", value: JSON.stringify(baseline), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  return NextResponse.json({ baseline });
}
