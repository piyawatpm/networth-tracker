import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const manualUpdates: Record<string, number> | undefined = body.manualUpdates;

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

    const { data: rows } = await supabase
      .from("app_data")
      .select("key, value")
      .in("key", ["portfolio_holdings", "portfolio_snapshots", "networth_snapshots"]);

    const dataMap: Record<string, string> = {};
    for (const row of rows ?? []) dataMap[row.key] = row.value;

    const parse = <T>(key: string, fallback: T): T => {
      try { return dataMap[key] ? JSON.parse(dataMap[key]) : fallback; } catch { return fallback; }
    };

    let holdings = parse<{ id: string; currentValue: number }[]>("portfolio_holdings", []);
    const portfolioSnapshots = parse<{ date: string; value: number }[]>("portfolio_snapshots", []);
    const nwSnapshots = parse<{ date: string; value: number }[]>("networth_snapshots", []);

    // Apply manual value updates to holdings
    if (manualUpdates && Object.keys(manualUpdates).length > 0) {
      holdings = holdings.map((h) => {
        if (manualUpdates[h.id] !== undefined) {
          return { ...h, currentValue: manualUpdates[h.id] };
        }
        return h;
      });
      // Save updated holdings back
      await supabase.from("app_data").upsert({
        key: "portfolio_holdings",
        value: JSON.stringify(holdings),
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    }

    const portfolioTotal = holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);

    const updates: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    const newPortfolio = [
      ...portfolioSnapshots.filter((s) => s.date !== today).slice(-89),
      { date: today, value: portfolioTotal },
    ];
    updates.push({ key: "portfolio_snapshots", value: JSON.stringify(newPortfolio), updated_at: now });

    const newNw = [
      ...nwSnapshots.filter((s) => s.date !== today).slice(-89),
      { date: today, value: portfolioTotal },
    ];
    updates.push({ key: "networth_snapshots", value: JSON.stringify(newNw), updated_at: now });

    const { error } = await supabase.from("app_data").upsert(updates, { onConflict: "key" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      date: today,
      portfolioTotal,
      manualUpdatesApplied: manualUpdates ? Object.keys(manualUpdates).length : 0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
