// lib/utils/analytics-derive.ts
//
// Shared helper: derive a fresh baseline from the earliest snapshot in
// portfolio_snapshots / crypto_snapshots and persist it to both the
// analytics_baseline table and the app_data KV mirror.
//
// Used by:
// - GET /api/analytics/baseline (when no current baseline exists)
// - POST /api/analytics/backfill-performance (always — wipes + re-derives)
// - app/api/cron/snapshot route (first-ever cron run)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsBaseline } from "./types";
import {
  deriveAnchorDate,
  anchorTotalsFromSnapshots,
  buildBaselineFromSnapshots,
  fetchBtcDailyCloses,
  fetchSpyDailyCloses,
  type SnapshotRow,
} from "./analytics-backfill";

export type DeriveResult =
  | { ok: true; baseline: AnalyticsBaseline }
  | { ok: false; status: number; error: string };

/**
 * Build a baseline anchored to the earliest snapshot in either stream,
 * fetch historical BTC + SPY for that day, persist to `analytics_baseline`
 * (replacing any existing current row) and mirror to `app_data` KV.
 *
 * Returns a discriminated union — caller decides whether to surface the
 * error as 4xx/5xx.
 */
export async function deriveAndPersistBaseline(params: {
  supabase: SupabaseClient;
  /** Optional in-flight snapshot updates (cron passes its updates[] array). */
  inflight?: { portfolioSnapshots?: SnapshotRow[]; cryptoSnapshots?: SnapshotRow[] };
}): Promise<DeriveResult> {
  const { supabase, inflight } = params;

  // 1. Read snapshot streams from KV (same place client + cron write them).
  const { data: rows, error: readErr } = await supabase
    .from("app_data")
    .select("key, value")
    .in("key", ["portfolio_snapshots", "crypto_snapshots"]);

  if (readErr) {
    return { ok: false, status: 500, error: readErr.message };
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

  // Merge in-flight (cron's pending writes) with KV.
  const portfolioSnapshots =
    inflight?.portfolioSnapshots ?? parse<SnapshotRow[]>("portfolio_snapshots", []);
  const cryptoSnapshots =
    inflight?.cryptoSnapshots ?? parse<SnapshotRow[]>("crypto_snapshots", []);

  const anchorDate = deriveAnchorDate(portfolioSnapshots, cryptoSnapshots);
  if (!anchorDate) {
    return { ok: false, status: 400, error: "No snapshots yet — wait for the cron to run." };
  }

  const totals = anchorTotalsFromSnapshots({
    portfolioSnapshots,
    cryptoSnapshots,
    anchorDate,
  });

  // 2. Fetch historical benchmark prices for the anchor day.
  const cgKey = process.env.COINGECKO_API_KEY;
  const apcaId = process.env.ALPACA_KEY_ID;
  const apcaSecret = process.env.ALPACA_SECRET_KEY;
  if (!cgKey || !apcaId || !apcaSecret) {
    return {
      ok: false,
      status: 500,
      error: "Missing COINGECKO_API_KEY or ALPACA_* env vars",
    };
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
    return { ok: false, status: 502, error: `Benchmark fetch failed: ${String(e)}` };
  }

  if (btcClose <= 0 || spyClose <= 0) {
    return {
      ok: false,
      status: 502,
      error: `No benchmark close found for anchor date ${anchorDate}`,
    };
  }

  // 3. Mark any prior current baseline non-current — the unique partial
  //    index on (is_current=true) requires this before insert. We don't
  //    delete, so analytics_baseline retains historical rows for audit.
  await supabase
    .from("analytics_baseline")
    .update({ is_current: false })
    .eq("is_current", true);

  // 4. Build + insert new baseline.
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
    return { ok: false, status: 500, error: insErr.message };
  }

  // 5. Mirror to KV (legacy contract — components/providers/data-provider.tsx
  //    reads this key on initial load).
  await supabase.from("app_data").upsert(
    {
      key: "analytics_baseline",
      value: JSON.stringify(baseline),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  return { ok: true, baseline };
}
