import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Use secret key for server-side cron (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Verify cron secret (Vercel sets this automatically)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

    // Read current portfolio holdings from Supabase
    const { data: holdingsRow } = await supabase
      .from("app_data")
      .select("value")
      .eq("key", "portfolio_holdings")
      .single();

    // Read current snapshots
    const { data: snapshotsRow } = await supabase
      .from("app_data")
      .select("value")
      .eq("key", "portfolio_snapshots")
      .single();

    // Read networth snapshots
    const { data: nwRow } = await supabase
      .from("app_data")
      .select("value")
      .eq("key", "networth_snapshots")
      .single();

    const holdings = holdingsRow ? JSON.parse(holdingsRow.value) : [];
    const portfolioSnapshots = snapshotsRow ? JSON.parse(snapshotsRow.value) : [];
    const nwSnapshots = nwRow ? JSON.parse(nwRow.value) : [];

    // Calculate portfolio total (in original currencies — no FX conversion in cron)
    const portfolioTotal = holdings.reduce(
      (s: number, h: { currentValue: number }) => s + (h.currentValue ?? 0),
      0,
    );

    // Check if we already have a snapshot for today
    const hasPortfolioToday = portfolioSnapshots.some(
      (s: { date: string }) => s.date === today,
    );

    const updates: { key: string; value: string; updated_at: string }[] = [];

    if (!hasPortfolioToday && portfolioTotal > 0) {
      const newSnapshots = [
        ...portfolioSnapshots.slice(-89),
        { date: today, value: portfolioTotal },
      ];
      updates.push({
        key: "portfolio_snapshots",
        value: JSON.stringify(newSnapshots),
        updated_at: new Date().toISOString(),
      });
    }

    // Net worth snapshot (portfolio total as approximation — full calculation needs FX + crypto)
    const hasNwToday = nwSnapshots.some((s: { date: string }) => s.date === today);
    if (!hasNwToday && portfolioTotal > 0) {
      const newNw = [
        ...nwSnapshots.slice(-89),
        { date: today, value: portfolioTotal },
      ];
      updates.push({
        key: "networth_snapshots",
        value: JSON.stringify(newNw),
        updated_at: new Date().toISOString(),
      });
    }

    if (updates.length > 0) {
      const { error } = await supabase.from("app_data").upsert(updates, { onConflict: "key" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      date: today,
      snapshotsUpdated: updates.length,
      portfolioTotal,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
