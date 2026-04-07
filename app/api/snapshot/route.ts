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

    // Use datetime for manual snapshots (allows multiple per day)
    const sydneyNow = new Date().toLocaleString("en-CA", {
      timeZone: "Australia/Sydney",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).replace(",", "");
    const today = sydneyNow;

    // Read all needed data
    const { data: rows } = await supabase
      .from("app_data")
      .select("key, value")
      .in("key", [
        "portfolio_holdings",
        "portfolio_snapshots",
        "networth_snapshots",
        "crypto_snapshots",
        "crypto_csv_text",
        "crypto_prices",
        "crypto_ticker_mappings",
        "debt_records",
        "debt_transactions",
      ]);

    const dataMap: Record<string, string> = {};
    for (const row of rows ?? []) dataMap[row.key] = row.value;

    const parse = <T>(key: string, fallback: T): T => {
      try { return dataMap[key] ? JSON.parse(dataMap[key]) : fallback; } catch { return fallback; }
    };

    let holdings = parse<{ id: string; type: string; currentValue: number; accountType: string }[]>("portfolio_holdings", []);
    const portfolioSnapshots = parse<{ date: string; value: number }[]>("portfolio_snapshots", []);
    const nwSnapshots = parse<{ date: string; value: number }[]>("networth_snapshots", []);
    const cryptoSnapshots = parse<{ date: string; value: number; currency: string }[]>("crypto_snapshots", []);

    // Apply manual value updates to holdings
    if (manualUpdates && Object.keys(manualUpdates).length > 0) {
      holdings = holdings.map((h) => {
        if (manualUpdates[h.id] !== undefined) {
          return { ...h, currentValue: manualUpdates[h.id] };
        }
        return h;
      });
      await supabase.from("app_data").upsert({
        key: "portfolio_holdings",
        value: JSON.stringify(holdings),
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    }

    // Portfolio total (excluding savings)
    const portfolioTotal = holdings
      .filter((h) => h.type !== "savings")
      .reduce((s, h) => s + (h.currentValue ?? 0), 0);

    const portfolioNoSuper = holdings
      .filter((h) => h.type !== "savings" && h.accountType !== "super")
      .reduce((s, h) => s + (h.currentValue ?? 0), 0);

    // Crypto total — parse CSV + apply cached prices
    let cryptoTotal = 0;
    const csvText = parse<string>("crypto_csv_text", "");
    if (csvText) {
      try {
        const { parseAndComputeHoldings, getTotalCryptoValueUsd } = await import("@/lib/utils/crypto-csv");
        const cryptoHoldings = parseAndComputeHoldings(csvText);

        // Apply cached prices
        const cachedPrices = parse<{ prices: Record<string, number> }>("crypto_prices", { prices: {} });
        const tickerMappings = parse<Record<string, string>>("crypto_ticker_mappings", {});

        for (const h of cryptoHoldings) {
          const mappedTicker = tickerMappings[h.token] ?? h.token;
          const price = cachedPrices.prices[mappedTicker];
          if (price != null) {
            h.currentValueUsd = price * h.amount;
          }
        }
        cryptoTotal = getTotalCryptoValueUsd(cryptoHoldings);
      } catch {
        // silent — crypto total stays 0
      }
    }

    // Debts
    const debtRecords = parse<{ id: string; direction: string; originalAmount: number; currency: string }[]>("debt_records", []);
    const debtTransactions = parse<{ debtId: string; amount: number }[]>("debt_transactions", []);
    let owedToMe = 0;
    let iOwe = 0;
    for (const d of debtRecords) {
      const paid = debtTransactions.filter((t) => t.debtId === d.id).reduce((s, t) => s + t.amount, 0);
      const remaining = Math.max(0, d.originalAmount - paid);
      if (d.direction === "owed_to_me") owedToMe += remaining;
      else iOwe += remaining;
    }

    // Net worth = portfolio + crypto + owed to me - I owe
    // Note: stored in raw currency (no FX conversion — server doesn't have FX rates)
    const netWorth = portfolioTotal + cryptoTotal + owedToMe - iOwe;
    const netWorthNoSuper = portfolioNoSuper + cryptoTotal + owedToMe - iOwe;

    const updates: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    // Portfolio snapshot
    updates.push({
      key: "portfolio_snapshots",
      value: JSON.stringify([...portfolioSnapshots.slice(-89), { date: today, value: portfolioNoSuper, valueWithSuper: portfolioTotal }]),
      updated_at: now,
    });

    // Net worth snapshot
    updates.push({
      key: "networth_snapshots",
      value: JSON.stringify([...nwSnapshots.slice(-89), { date: today, value: netWorth, valueNoSuper: netWorthNoSuper }]),
      updated_at: now,
    });

    // Crypto snapshot
    if (cryptoTotal > 0) {
      updates.push({
        key: "crypto_snapshots",
        value: JSON.stringify([...cryptoSnapshots.slice(-89), { date: today, value: cryptoTotal, currency: "USD" }]),
        updated_at: now,
      });
    }

    const { error } = await supabase.from("app_data").upsert(updates, { onConflict: "key" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      date: today,
      portfolioTotal,
      cryptoTotal,
      netWorth,
      owedToMe,
      iOwe,
      manualUpdatesApplied: manualUpdates ? Object.keys(manualUpdates).length : 0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
