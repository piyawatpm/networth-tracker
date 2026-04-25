// app/api/analytics/baseline/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { AnalyticsBaseline } from "@/lib/utils/types";
import {
  deriveAnchorDate,
  anchorTotalsFromSnapshots,
  buildBaselineFromSnapshots,
  fetchBtcDailyCloses,
  fetchSpyDailyCloses,
  type SnapshotRow,
} from "@/lib/utils/analytics-backfill";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

/**
 * GET — returns the active baseline. If none exists yet, auto-derives one from
 * the earliest snapshot in portfolio_snapshots/crypto_snapshots and persists it.
 * If both tables are empty (brand-new install), returns `{ baseline: null }`.
 */
export async function GET() {
  // 1. Look up existing current baseline first.
  const existing = await supabase
    .from("analytics_baseline")
    .select("snapshot")
    .eq("is_current", true)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }
  if (existing.data) {
    return NextResponse.json({
      baseline: existing.data.snapshot as AnalyticsBaseline,
    });
  }

  // 2. Auto-derive. Read snapshot streams from the KV `app_data` table since
  //    that's where the client + cron currently store them.
  const { data: rows, error: readErr } = await supabase
    .from("app_data")
    .select("key, value")
    .in("key", ["portfolio_snapshots", "crypto_snapshots"]);

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const kv: Record<string, string> = {};
  for (const r of rows ?? []) kv[r.key] = r.value;
  const parse = <T,>(k: string, fb: T): T => {
    try {
      return kv[k] ? (JSON.parse(kv[k]) as T) : fb;
    } catch {
      return fb;
    }
  };

  const portfolioSnapshots = parse<SnapshotRow[]>("portfolio_snapshots", []);
  const cryptoSnapshots = parse<SnapshotRow[]>("crypto_snapshots", []);

  const anchorDate = deriveAnchorDate(portfolioSnapshots, cryptoSnapshots);
  if (!anchorDate) {
    return NextResponse.json({ baseline: null });
  }

  const totals = anchorTotalsFromSnapshots({
    portfolioSnapshots,
    cryptoSnapshots,
    anchorDate,
  });

  // 3. Fetch historical benchmark prices for the anchor day (single-day fetch).
  const cgKey = process.env.COINGECKO_API_KEY;
  const apcaId = process.env.ALPACA_KEY_ID;
  const apcaSecret = process.env.ALPACA_SECRET_KEY;
  if (!cgKey || !apcaId || !apcaSecret) {
    return NextResponse.json(
      { error: "Missing COINGECKO_API_KEY or ALPACA_* env vars" },
      { status: 500 },
    );
  }

  let btcClose = 0;
  let spyClose = 0;
  try {
    const [btcBars, spyBars] = await Promise.all([
      fetchBtcDailyCloses({ fromDay: anchorDate, toDay: anchorDate, apiKey: cgKey }),
      fetchSpyDailyCloses({
        fromDay: anchorDate,
        toDay: anchorDate,
        apcaKeyId: apcaId,
        apcaSecret,
      }),
    ]);
    btcClose = btcBars[0]?.close ?? 0;
    spyClose = spyBars[0]?.close ?? 0;
  } catch (e) {
    return NextResponse.json(
      { error: `Benchmark fetch failed: ${String(e)}` },
      { status: 502 },
    );
  }

  if (btcClose <= 0 || spyClose <= 0) {
    return NextResponse.json(
      { error: `No benchmark close found for anchor date ${anchorDate}` },
      { status: 502 },
    );
  }

  // 4. Persist.
  const baseline = buildBaselineFromSnapshots({
    anchorDate,
    totals,
    btcClose,
    spyClose,
  });

  const { error: insErr } = await supabase.from("analytics_baseline").insert({
    date: anchorDate,
    snapshot: baseline,
    is_current: true,
  });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Mirror to KV (existing contract — some client code reads this key).
  await supabase.from("app_data").upsert(
    {
      key: "analytics_baseline",
      value: JSON.stringify(baseline),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  return NextResponse.json({ baseline });
}
