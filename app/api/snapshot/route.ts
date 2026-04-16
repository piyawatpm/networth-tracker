import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchExtendedStockQuote } from "@/lib/utils/stock-prices";
import { rowToCamel, rowToSnake } from "@/lib/supabase/tables";

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

    const [
      { data: holdingsRaw },
      { data: cryptoCsvRaw },
      { data: cryptoPricesRaw },
      { data: tickerMappingsRaw },
      { data: debtRecordsRaw },
      { data: debtTxRaw },
      { data: prefCurrencyRaw },
    ] = await Promise.all([
      supabase.from("portfolio_holdings").select("*"),
      supabase.from("app_data").select("value").eq("key", "crypto_csv_text").single(),
      supabase.from("app_data").select("value").eq("key", "crypto_prices").single(),
      supabase.from("app_data").select("value").eq("key", "crypto_ticker_mappings").single(),
      supabase.from("debt_records").select("id, direction, original_amount, currency"),
      supabase.from("debt_transactions").select("debt_id, amount"),
      supabase.from("app_data").select("value").eq("key", "preferred_currency").single(),
    ]);

    let holdings = (holdingsRaw ?? []).map((r) => rowToCamel(r)) as {
      id: string; ticker?: string; country?: string; units?: number;
      type: string; currentValue: number; currency: string; accountType: string;
    }[];
    const debtRecords = (debtRecordsRaw ?? []).map((r) => rowToCamel(r)) as {
      id: string; direction: string; originalAmount: number; currency: string;
    }[];
    const debtTransactions = (debtTxRaw ?? []).map((r) => rowToCamel(r)) as {
      debtId: string; amount: number;
    }[];

    // Parse KV values same as before
    const parse = <T>(raw: { value: string } | null, fallback: T): T => {
      try { return raw?.value ? JSON.parse(raw.value) : fallback; } catch { return fallback; }
    };

    const csvText: string = parse<string>(cryptoCsvRaw, "");
    const cachedPrices = parse<{ prices: Record<string, number> }>(cryptoPricesRaw, { prices: {} });
    const tickerMappings: Record<string, string> = parse<Record<string, string>>(tickerMappingsRaw, {});

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
    const changed = (manualUpdates && Object.keys(manualUpdates).length > 0) || stockUpdatedCount > 0;
    const modifiedHoldings = manualUpdates && Object.keys(manualUpdates).length > 0
      ? holdings.filter((h) => manualUpdates[h.id] !== undefined || stockHoldings.some((s) => s.id === h.id && stockUpdatedCount > 0))
      : stockHoldings;

    if (changed) {
      for (const h of modifiedHoldings) {
        await supabase.from("portfolio_holdings")
          .update(rowToSnake({ currentValue: h.currentValue, currency: h.currency }))
          .eq("id", h.id);
      }
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
    if (csvText) {
      try {
        const { parseAndComputeHoldings, getTotalCryptoValueUsd } = await import("@/lib/utils/crypto-csv");
        const cryptoHoldings = parseAndComputeHoldings(csvText);

        for (const h of cryptoHoldings) {
          const mappedTicker = tickerMappings[h.token] ?? h.token;
          const price = cachedPrices.prices[mappedTicker];
          if (price != null) h.currentValueUsd = price * h.amount;
        }
        cryptoTotalUsd = getTotalCryptoValueUsd(cryptoHoldings);
      } catch { /* silent */ }
    }
    const cryptoInUsd = toUsd(cryptoTotalUsd, "USD");

    // Debts — convert each to USD
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

    // Portfolio snapshot — just INSERT
    await supabase.from("snapshots").insert({
      type: "portfolio",
      date: today,
      value: portfolioNoSuper,
      value_with_super: portfolioTotal,
      currency: SNAPSHOT_CURRENCY,
    });

    // Net worth snapshot — just INSERT
    await supabase.from("snapshots").insert({
      type: "networth",
      date: today,
      value: netWorth,
      value_no_super: netWorthNoSuper,
      currency: SNAPSHOT_CURRENCY,
      portfolio: portfolioTotal,
      crypto: cryptoInUsd,
    });

    // Crypto snapshot — just INSERT
    if (cryptoInUsd > 0) {
      await supabase.from("snapshots").insert({
        type: "crypto",
        date: today,
        value: cryptoInUsd,
        currency: SNAPSHOT_CURRENCY,
      });
    }

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
