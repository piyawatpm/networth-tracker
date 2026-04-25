// app/api/analytics/backfill-performance/route.ts
//
// One-shot backfill of `performance_snapshots` for the current baseline.
// Wipes existing rows for baseline_id, fetches daily BTC/SPY history from
// anchor_date → yesterday, and re-inserts one row per day. Cron continues
// writing 15-min rows for today going forward.
//
// Idempotent — running twice produces the same end state.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type {
  AnalyticsBaseline,
  CryptoDeposit,
  PortfolioTransaction,
} from "@/lib/utils/types";
import {
  dailyCombinedUsd,
  depositsPerDay,
  benchmarkByDay,
  computeDailyPerfRows,
  fetchBtcDailyCloses,
  fetchSpyDailyCloses,
  type SnapshotRow,
  type BenchmarkBar,
} from "@/lib/utils/analytics-backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

async function getFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { rates?: Record<string, number> };
    return data.rates ?? {};
  } catch {
    return {};
  }
}

function yesterdaySydney(): string {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Australia/Sydney",
  });
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export async function POST() {
  // 1. Fetch current baseline + id (need id for cascade scoping).
  const { data: baselineRow, error: baselineErr } = await supabase
    .from("analytics_baseline")
    .select("id, date, snapshot")
    .eq("is_current", true)
    .maybeSingle();

  if (baselineErr) {
    return NextResponse.json({ error: baselineErr.message }, { status: 500 });
  }
  if (!baselineRow) {
    return NextResponse.json(
      { error: "No active baseline. Wait for cron to run once, then retry." },
      { status: 400 },
    );
  }
  const baseline = baselineRow.snapshot as AnalyticsBaseline;
  const anchorDate = baseline.date;
  const toDay = yesterdaySydney();
  if (anchorDate > toDay) {
    return NextResponse.json(
      { error: `Baseline date ${anchorDate} is in the future.` },
      { status: 400 },
    );
  }

  // 2. Wipe existing rows for this baseline (idempotency).
  const { error: delErr } = await supabase
    .from("performance_snapshots")
    .delete()
    .eq("baseline_id", baselineRow.id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // 3. Read snapshots + txns + crypto deposits.
  const { data: kvRows, error: kvErr } = await supabase
    .from("app_data")
    .select("key, value")
    .in("key", ["portfolio_snapshots", "crypto_snapshots", "portfolio_transactions"]);
  if (kvErr) {
    return NextResponse.json({ error: kvErr.message }, { status: 500 });
  }

  const kv: Record<string, string> = {};
  for (const r of kvRows ?? []) kv[r.key] = r.value;
  const parse = <T,>(k: string, fb: T): T => {
    try {
      return kv[k] ? (JSON.parse(kv[k]) as T) : fb;
    } catch {
      return fb;
    }
  };

  const portfolioSnapshots = parse<SnapshotRow[]>("portfolio_snapshots", []);
  const cryptoSnapshots = parse<SnapshotRow[]>("crypto_snapshots", []);
  const portfolioTxns = parse<PortfolioTransaction[]>("portfolio_transactions", []);

  const { data: depositRows, error: depErr } = await supabase
    .from("crypto_deposits")
    .select("id, date, token, amount, usd_value_at_deposit, kind");
  if (depErr) {
    return NextResponse.json({ error: depErr.message }, { status: 500 });
  }
  const cryptoDeposits: CryptoDeposit[] = (depositRows ?? []).map((r) => ({
    id: r.id as string,
    date: r.date as string,
    token: r.token as string,
    amount: Number(r.amount),
    usdValueAtDeposit: Number(r.usd_value_at_deposit),
    kind: r.kind as "stablecoin" | "crypto",
    createdAt: 0,
  }));

  // 4. FX rates for txn currency → USD conversion.
  const rates = await getFxRates();
  const fxToUsd = (amount: number, currency: string) => {
    if (currency === "USD" || !rates[currency]) return amount;
    return amount / rates[currency];
  };

  // 5. Fetch historical benchmarks for [anchorDate, toDay].
  const cgKey = process.env.COINGECKO_API_KEY;
  const apcaId = process.env.ALPACA_KEY_ID;
  const apcaSecret = process.env.ALPACA_SECRET_KEY;
  if (!cgKey || !apcaId || !apcaSecret) {
    return NextResponse.json(
      { error: "Missing COINGECKO_API_KEY or ALPACA_* env vars" },
      { status: 500 },
    );
  }

  let btcBars: BenchmarkBar[];
  let spyBars: BenchmarkBar[];
  try {
    [btcBars, spyBars] = await Promise.all([
      fetchBtcDailyCloses({ fromDay: anchorDate, toDay, apiKey: cgKey }),
      fetchSpyDailyCloses({
        fromDay: anchorDate,
        toDay,
        apcaKeyId: apcaId,
        apcaSecret,
      }),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: `Benchmark fetch failed: ${String(e)}` },
      { status: 502 },
    );
  }

  // 6. Compute per-day rows.
  const dailyCombined = dailyCombinedUsd({
    portfolioSnapshots,
    cryptoSnapshots,
    fromDay: anchorDate,
    toDay,
  });
  const deposits = depositsPerDay({
    portfolioTxns,
    cryptoDeposits,
    anchorDate,
    fxToUsd,
  });
  const btcByDay = benchmarkByDay(btcBars);
  const spyByDay = benchmarkByDay(spyBars);

  const rows = computeDailyPerfRows({
    anchorDate,
    toDay,
    anchorTotals: baseline.totals,
    anchorBenchmarks: baseline.benchmarks,
    dailyCombined,
    deposits,
    btcByDay,
    spyByDay,
  });

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, daysWritten: 0, from: anchorDate, to: toDay });
  }

  // 7. Insert in chunks (Supabase limit = 1000 per insert).
  const snakeRows = rows.map((r) => ({
    baseline_id: baselineRow.id,
    baseline_date: baseline.date,
    timestamp: r.timestamp,
    portfolio_usd: r.portfolioUsd,
    crypto_usd: r.cryptoUsd,
    combined_usd: r.combinedUsd,
    deposits_usd: r.depositsUsd,
    spy_price_usd: r.spyPriceUsd,
    btc_price_usd: r.btcPriceUsd,
    portfolio_pct: r.portfolioPct,
    spy_pct: r.spyPct,
    btc_pct: r.btcPct,
  }));

  for (let i = 0; i < snakeRows.length; i += 500) {
    const chunk = snakeRows.slice(i, i + 500);
    const { error: insErr } = await supabase
      .from("performance_snapshots")
      .insert(chunk);
    if (insErr) {
      return NextResponse.json(
        { error: `Insert failed at chunk ${i}: ${insErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    daysWritten: rows.length,
    from: anchorDate,
    to: toDay,
  });
}
