import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

interface PerformanceSnapshotRow {
  timestamp: string;
  portfolio_pct: number | null;
  spy_pct: number | null;
  btc_pct: number | null;
  combined_usd: number;
  deposits_usd: number;
}

export async function GET() {
  // Fetch the active baseline first so we only return matching snapshots
  const { data: baselineRow, error: baselineErr } = await supabase
    .from("analytics_baseline")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();

  if (baselineErr) return NextResponse.json({ error: baselineErr.message }, { status: 500 });
  if (!baselineRow) return NextResponse.json({ snapshots: [] });

  const { data, error } = await supabase
    .from("performance_snapshots")
    .select("timestamp, portfolio_pct, spy_pct, btc_pct, combined_usd, deposits_usd")
    .eq("baseline_id", baselineRow.id)
    .order("timestamp", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const snapshots = (data ?? []).map((r) => {
    const row = r as PerformanceSnapshotRow;
    return {
      timestamp: row.timestamp,
      portfolioPct: row.portfolio_pct,
      spyPct: row.spy_pct,
      btcPct: row.btc_pct,
      combinedUsd: Number(row.combined_usd),
      depositsUsd: Number(row.deposits_usd),
    };
  });

  return NextResponse.json({ snapshots });
}
