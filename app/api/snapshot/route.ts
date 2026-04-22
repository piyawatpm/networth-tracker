import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchExtendedStockQuote } from "@/lib/utils/stock-prices";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const dynamic = "force-dynamic";

/**
 * Convert amount from one currency to target using USD-based cross rates.
 * rates = { AUD: 1.58, THB: 33.5, EUR: 0.92, ... } (all vs USD)
 */
function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  if (from === to || !rates) return amount;
  // Convert to USD first, then to target
  const fromRate = rates[from] ?? 1; // 1 USD = X from-currency
  const toRate = rates[to] ?? 1;     // 1 USD = X to-currency
  const amountInUsd = amount / fromRate;
  return amountInUsd * toRate;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const manualUpdates: Record<string, number> | undefined = body.manualUpdates;

    const sydneyNow = new Date().toLocaleString("en-CA", {
      timeZone: "Australia/Sydney",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).replace(",", "");
    const today = sydneyNow;

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
        "fx_rates_cache",
        "preferred_currency",
      ]);

    const dataMap: Record<string, string> = {};
    for (const row of rows ?? []) dataMap[row.key] = row.value;

    const parse = <T>(key: string, fallback: T): T => {
      try { return dataMap[key] ? JSON.parse(dataMap[key]) : fallback; } catch { return fallback; }
    };

    // FX rates — fetch live from open.er-api.com (same source as client)
    let rates: Record<string, number> = {};
    try {
      const fxRes = await fetch("https://open.er-api.com/v6/latest/USD");
      if (fxRes.ok) {
        const fxData = await fxRes.json();
        rates = fxData.rates ?? {};
      }
    } catch { /* rates stays empty — conversion will be 1:1 as fallback */ }

    // Always store snapshots in USD — the universal base currency.
    // Charts convert from USD to display currency at render time.
    const SNAPSHOT_CURRENCY = "USD";
    const toUsd = (amount: number, fromCurrency: string) =>
      Math.round(convertCurrency(amount, fromCurrency, "USD", rates) * 100) / 100;

    let holdings = parse<{ id: string; ticker?: string; country?: string; units?: number; type: string; currentValue: number; currency: string; accountType: string }[]>("portfolio_holdings", []);
    const portfolioSnapshots = parse<{ date: string; value: number }[]>("portfolio_snapshots", []);
    const nwSnapshots = parse<{ date: string; value: number }[]>("networth_snapshots", []);
    const cryptoSnapshots = parse<{ date: string; value: number; currency: string }[]>("crypto_snapshots", []);

    // Apply manual value updates
    if (manualUpdates && Object.keys(manualUpdates).length > 0) {
      holdings = holdings.map((h) => {
        if (manualUpdates[h.id] !== undefined) {
          return { ...h, currentValue: manualUpdates[h.id] };
        }
        return h;
      });
    }

    // Refresh stock prices — Yahoo primary (pre/post), Finnhub fallback (mirrors cron)
    let stockUpdatedCount = 0;
    let stockExtendedCount = 0;
    const stockHoldings = holdings.filter((h) => h.ticker && (h.units ?? 0) > 0 && h.type !== "savings");
    for (const h of stockHoldings) {
      const quote = await fetchExtendedStockQuote(h.ticker!, h.country);
      if (quote) {
        h.currentValue = (h.units ?? 0) * quote.price;
        if (quote.currency) h.currency = quote.currency;
        stockUpdatedCount++;
        if (quote.extended) stockExtendedCount++;
      }
    }

    // Persist holdings if anything changed (manual updates or stock refresh)
    if ((manualUpdates && Object.keys(manualUpdates).length > 0) || stockUpdatedCount > 0) {
      await supabase.from("app_data").upsert({
        key: "portfolio_holdings",
        value: JSON.stringify(holdings),
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    }

    // Portfolio totals — convert each holding to display currency
    const portfolioTotal = holdings
      .filter((h) => h.type !== "savings")
      .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency ?? "AUD"), 0);

    const portfolioNoSuper = holdings
      .filter((h) => h.type !== "savings" && h.accountType !== "super")
      .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency ?? "AUD"), 0);

    // Crypto total
    let cryptoTotalUsd = 0;
    const csvText = parse<string>("crypto_csv_text", "");
    if (csvText) {
      try {
        const { parseAndComputeHoldings, getTotalCryptoValueUsd } = await import("@/lib/utils/crypto-csv");
        const cryptoHoldings = parseAndComputeHoldings(csvText);
        const cachedPrices = parse<{ prices: Record<string, number> }>("crypto_prices", { prices: {} });
        const tickerMappings = parse<Record<string, string>>("crypto_ticker_mappings", {});

        for (const h of cryptoHoldings) {
          const mappedTicker = tickerMappings[h.token] ?? h.token;
          const price = cachedPrices.prices[mappedTicker];
          if (price != null) h.currentValueUsd = price * h.amount;
        }
        cryptoTotalUsd = getTotalCryptoValueUsd(cryptoHoldings);
      } catch { /* silent */ }
    }
    const cryptoInUsd = toUsd(cryptoTotalUsd, "USD");

    // Debts — convert each to display currency
    const debtRecords = parse<{ id: string; direction: string; originalAmount: number; currency: string }[]>("debt_records", []);
    const debtTransactions = parse<{ debtId: string; amount: number }[]>("debt_transactions", []);
    let owedToMe = 0;
    let iOwe = 0;
    for (const d of debtRecords) {
      const paid = debtTransactions.filter((t) => t.debtId === d.id).reduce((s, t) => s + t.amount, 0);
      const remaining = Math.max(0, d.originalAmount - paid);
      const converted = toUsd(remaining, d.currency ?? "AUD");
      if (d.direction === "owed_to_me") owedToMe += converted;
      else iOwe += converted;
    }

    const netWorth = portfolioTotal + cryptoInUsd + owedToMe - iOwe;
    const netWorthNoSuper = portfolioNoSuper + cryptoInUsd + owedToMe - iOwe;

    const updates: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    // Portfolio snapshot
    updates.push({
      key: "portfolio_snapshots",
      value: JSON.stringify([...portfolioSnapshots.slice(-89), { date: today, value: portfolioNoSuper, valueWithSuper: portfolioTotal, currency: SNAPSHOT_CURRENCY }]),
      updated_at: now,
    });

    // Net worth snapshot
    updates.push({
      key: "networth_snapshots",
      value: JSON.stringify([...nwSnapshots.slice(-89), { date: today, value: netWorth, valueNoSuper: netWorthNoSuper, currency: SNAPSHOT_CURRENCY, portfolio: portfolioTotal, crypto: cryptoInUsd }]),
      updated_at: now,
    });

    // Crypto snapshot
    if (cryptoInUsd > 0) {
      updates.push({
        key: "crypto_snapshots",
        value: JSON.stringify([...cryptoSnapshots.slice(-89), { date: today, value: cryptoInUsd, currency: SNAPSHOT_CURRENCY }]),
        updated_at: now,
      });
    }

    const { error } = await supabase.from("app_data").upsert(updates, { onConflict: "key" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Also mirror to relational tables (graceful — tables may not exist)
    try {
      const snapshotInserts: Record<string, unknown>[] = [];
      snapshotInserts.push({ type: "portfolio", date: today, value: portfolioNoSuper, value_with_super: portfolioTotal, currency: SNAPSHOT_CURRENCY });
      snapshotInserts.push({ type: "networth", date: today, value: netWorth, value_no_super: netWorthNoSuper, currency: SNAPSHOT_CURRENCY, portfolio: portfolioTotal, crypto: cryptoInUsd });
      if (cryptoInUsd > 0) {
        snapshotInserts.push({ type: "crypto", date: today, value: cryptoInUsd, currency: SNAPSHOT_CURRENCY });
      }
      await supabase.from("snapshots").insert(snapshotInserts);

      // Update holdings that changed
      for (const h of holdings) {
        if (manualUpdates?.[h.id] !== undefined || stockHoldings.find((s) => s.id === h.id)) {
          await supabase.from("portfolio_holdings")
            .update({ current_value: h.currentValue, currency: h.currency })
            .eq("id", h.id);
        }
      }
    } catch { /* tables may not exist — KV write already succeeded */ }

    // Debug: list each holding for verification
    const holdingsDebug = holdings
      .filter((h) => h.type !== "savings")
      .map((h) => ({
        name: (h as { name?: string }).name ?? h.id,
        type: h.type,
        accountType: h.accountType,
        currency: h.currency,
        currentValue: h.currentValue,
        inUsd: toUsd(h.currentValue ?? 0, h.currency ?? "AUD"),
      }));

    return NextResponse.json({
      ok: true,
      date: today,
      currency: SNAPSHOT_CURRENCY,
      fxRatesLoaded: Object.keys(rates).length,
      fxRates: rates,
      portfolioTotal: Math.round(portfolioTotal * 100) / 100,
      portfolioNoSuper: Math.round(portfolioNoSuper * 100) / 100,
      cryptoTotal: Math.round(cryptoInUsd * 100) / 100,
      netWorth: Math.round(netWorth * 100) / 100,
      netWorthNoSuper: Math.round(netWorthNoSuper * 100) / 100,
      owedToMe: Math.round(owedToMe * 100) / 100,
      iOwe: Math.round(iOwe * 100) / 100,
      manualUpdatesApplied: manualUpdates ? Object.keys(manualUpdates).length : 0,
      stockPricesUpdated: stockUpdatedCount,
      stockExtendedHours: stockExtendedCount,
      holdingsBreakdown: holdingsDebug,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
