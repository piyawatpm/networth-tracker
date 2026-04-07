import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeOccurrences } from "@/lib/utils/timezone";

// Use secret key for server-side cron (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface RecurringTemplate {
  id: string;
  frequency: "weekly" | "fortnightly" | "monthly" | "yearly";
  startDate: string;
  endDate?: string;
  lastGeneratedDate?: string;
  active: boolean;
  [key: string]: unknown;
}

function generateRecurringEntries<T extends RecurringTemplate>(
  templates: T[],
  existingEntries: { date: string; recurringId?: string }[],
  today: string,
  createEntry: (template: T, date: string) => Record<string, unknown>,
): { newEntries: Record<string, unknown>[]; updatedTemplates: T[] } {
  const newEntries: Record<string, unknown>[] = [];
  const updatedTemplates = templates.map((t) => ({ ...t }));

  for (const template of updatedTemplates) {
    if (!template.active) continue;
    if (template.endDate && template.endDate < today) continue;

    const fromDate = template.lastGeneratedDate
      ? nextDay(template.lastGeneratedDate)
      : template.startDate;

    if (fromDate > today) continue;

    const occurrences = computeOccurrences(
      template.startDate,
      template.frequency,
      fromDate,
      today,
    );

    const existingDates = new Set(
      existingEntries
        .filter((e) => e.recurringId === template.id)
        .map((e) => e.date),
    );

    for (const date of occurrences) {
      if (existingDates.has(date)) continue;
      newEntries.push(createEntry(template, date));
    }

    if (occurrences.length > 0) {
      template.lastGeneratedDate = occurrences[occurrences.length - 1];
    }
  }

  return { newEntries, updatedTemplates };
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // Verify cron secret — check multiple headers for compatibility
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const vercelHeader = request.headers.get("x-vercel-cron-secret");

  const isAuthed =
    (authHeader === `Bearer ${secret}`) ||
    (vercelHeader === secret) ||
    !secret; // allow if no secret is configured

  if (!isAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  log.push(`Cron started at ${new Date().toISOString()}, Sydney date: ${today}`);

  try {
    // Read all needed data from Supabase
    const keys = [
      "portfolio_holdings",
      "portfolio_snapshots",
      "networth_snapshots",
      "income_entries",
      "expense_entries",
      "recurring_income_templates",
      "recurring_expense_templates",
      "crypto_csv_text",
      "crypto_prices",
      "crypto_snapshots",
      "crypto_ticker_mappings",
      "debt_records",
      "debt_transactions",
    ];

    const { data: rows } = await supabase
      .from("app_data")
      .select("key, value")
      .in("key", keys);

    const dataMap: Record<string, string> = {};
    for (const row of rows ?? []) {
      dataMap[row.key] = row.value;
    }

    const parse = <T>(key: string, fallback: T): T => {
      try {
        return dataMap[key] ? JSON.parse(dataMap[key]) : fallback;
      } catch {
        return fallback;
      }
    };

    const holdings = parse<{ currentValue: number; currency: string; type: string; accountType: string }[]>("portfolio_holdings", []);
    const portfolioSnapshots = parse<{ date: string }[]>("portfolio_snapshots", []);
    const nwSnapshots = parse<{ date: string; value: number }[]>("networth_snapshots", []);
    const cryptoSnapshots = parse<{ date: string; value: number }[]>("crypto_snapshots", []);
    const incomeEntries = parse<{ id: string; date: string; recurringId?: string }[]>("income_entries", []);
    const expenseEntries = parse<{ id: string; date: string; recurringId?: string }[]>("expense_entries", []);
    const incomeTemplates = parse<RecurringTemplate[]>("recurring_income_templates", []);
    const expenseTemplates = parse<RecurringTemplate[]>("recurring_expense_templates", []);
    const tickerMappings = parse<Record<string, string>>("crypto_ticker_mappings", {});

    // ── Fetch FX rates live (same as manual snapshot API) ──
    let rates: Record<string, number> = {};
    try {
      const fxRes = await fetch("https://open.er-api.com/v6/latest/USD");
      if (fxRes.ok) {
        const fxData = await fxRes.json();
        rates = fxData.rates ?? {};
      }
      log.push(`FX rates: loaded ${Object.keys(rates).length} currencies`);
    } catch {
      log.push(`FX rates: fetch failed — conversions will be 1:1`);
    }

    const toUsd = (amount: number, fromCurrency: string): number => {
      if (fromCurrency === "USD" || !rates[fromCurrency]) return amount;
      return amount / rates[fromCurrency];
    };

    const updates: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    // ── 1. Portfolio snapshot (converted to USD) ──
    const portfolioTotal = holdings
      .filter((h) => h.type !== "savings")
      .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency ?? "AUD"), 0);
    const portfolioNoSuper = holdings
      .filter((h) => h.type !== "savings" && h.accountType !== "super")
      .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency ?? "AUD"), 0);
    const hasPortfolioToday = portfolioSnapshots.some((s) => s.date === today);

    if (!hasPortfolioToday && portfolioTotal > 0) {
      const newSnapshots = [...portfolioSnapshots.slice(-89), { date: today, value: portfolioNoSuper, valueWithSuper: portfolioTotal, currency: "USD" }];
      updates.push({ key: "portfolio_snapshots", value: JSON.stringify(newSnapshots), updated_at: now });
      log.push(`Portfolio snapshot: w/super=$${portfolioTotal.toFixed(0)} no-super=$${portfolioNoSuper.toFixed(0)} USD`);
    } else {
      log.push(`Portfolio snapshot: ${hasPortfolioToday ? "already exists" : "no holdings"}`);
    }

    // ── 2. Net worth snapshot ──
    // Net worth snapshot — deferred until after crypto prices are fetched

    // ── 3. Recurring income entries ──
    if (incomeTemplates.length > 0) {
      const { newEntries, updatedTemplates } = generateRecurringEntries(
        incomeTemplates,
        incomeEntries,
        today,
        (template, date) => ({
          id: crypto.randomUUID(),
          type: template.type ?? "other",
          description: template.description ?? "",
          amount: template.amount ?? 0,
          currency: template.currency ?? "AUD",
          source: (template as Record<string, unknown>).source ?? "",
          date,
          notes: template.notes ?? "",
          isPassive: (template as Record<string, unknown>).isPassive,
          isRecurring: true,
          recurringId: template.id,
          createdAt: Date.now(),
        }),
      );

      if (newEntries.length > 0) {
        const allIncome = [...incomeEntries, ...newEntries];
        updates.push({ key: "income_entries", value: JSON.stringify(allIncome), updated_at: now });
        updates.push({ key: "recurring_income_templates", value: JSON.stringify(updatedTemplates), updated_at: now });
        log.push(`Recurring income: generated ${newEntries.length} entries`);
      } else {
        log.push(`Recurring income: no new entries needed`);
      }
    } else {
      log.push(`Recurring income: no templates`);
    }

    // ── 4. Recurring expense entries ──
    if (expenseTemplates.length > 0) {
      const { newEntries, updatedTemplates } = generateRecurringEntries(
        expenseTemplates,
        expenseEntries,
        today,
        (template, date) => ({
          id: crypto.randomUUID(),
          type: template.type ?? "other",
          description: template.description ?? "",
          amount: template.amount ?? 0,
          currency: template.currency ?? "AUD",
          vendor: (template as Record<string, unknown>).vendor ?? "",
          paymentMethod: (template as Record<string, unknown>).paymentMethod ?? "other",
          date,
          notes: template.notes ?? "",
          images: [],
          isRecurring: true,
          recurringId: template.id,
          createdAt: Date.now(),
        }),
      );

      if (newEntries.length > 0) {
        const allExpenses = [...expenseEntries, ...newEntries];
        updates.push({ key: "expense_entries", value: JSON.stringify(allExpenses), updated_at: now });
        updates.push({ key: "recurring_expense_templates", value: JSON.stringify(updatedTemplates), updated_at: now });
        log.push(`Recurring expenses: generated ${newEntries.length} entries`);
      } else {
        log.push(`Recurring expenses: no new entries needed`);
      }
    } else {
      log.push(`Recurring expenses: no templates`);
    }

    // ── 5. Crypto price update via Binance ──
    const cryptoCsvText = parse<string>("crypto_csv_text", "");
    if (cryptoCsvText) {
      try {
        // Parse CSV to get holdings with token + amount
        // We import dynamically to keep the function pure
        const { parseAndComputeHoldings } = await import("@/lib/utils/crypto-csv");
        const { STABLECOINS, YIELD_PREFIXES } = await import("@/lib/utils/constants");

        const holdings = parseAndComputeHoldings(cryptoCsvText);
        const nonStableTokens = holdings.filter((h) => {
          const upper = h.token.toUpperCase();
          if (STABLECOINS.has(upper)) return false;
          if (upper === "STABLECOIN" || upper === "CASH") return false;
          if (YIELD_PREFIXES.some((p) => upper.toLowerCase().startsWith(p))) return false;
          return h.amount > 0;
        });

        if (nonStableTokens.length > 0) {
          // Fetch all prices from Binance using ticker mappings
          const pricePromises = nonStableTokens.map(async (h) => {
            const mappedTicker = (tickerMappings[h.token] ?? h.token).toUpperCase();
            const symbol = `${mappedTicker}USDT`;
            try {
              const res = await fetch(
                `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
              );
              if (!res.ok) return { token: h.token, mappedTicker, price: null };
              const data = await res.json();
              return { token: h.token, mappedTicker, price: parseFloat(data.price) };
            } catch {
              return { token: h.token, mappedTicker, price: null };
            }
          });

          const results = await Promise.all(pricePromises);
          const prices: Record<string, number> = {};
          let fetchedCount = 0;

          for (const r of results) {
            if (r.price !== null && !isNaN(r.price)) {
              prices[r.token] = r.price;
              fetchedCount++;
            }
          }

          // Save prices to Supabase
          if (fetchedCount > 0) {
            updates.push({
              key: "crypto_prices",
              value: JSON.stringify({ prices, fetchedAt: Date.now() }),
              updated_at: now,
            });
            log.push(`Crypto prices: fetched ${fetchedCount}/${nonStableTokens.length} from Binance — ${Object.entries(prices).map(([t, p]) => `${t}=$${p.toFixed(2)}`).join(", ")}`);
          } else {
            log.push(`Crypto prices: all fetches failed`);
          }
        } else {
          log.push(`Crypto prices: no non-stable tokens to fetch`);
        }
      } catch (e) {
        log.push(`Crypto prices error: ${String(e)}`);
      }
    } else {
      log.push(`Crypto prices: no CSV data`);
    }

    // ── 6. Crypto snapshot + Net worth snapshot ──
    // Compute crypto total from CSV + live prices
    let cryptoTotalUsd = 0;
    if (cryptoCsvText) {
      try {
        const { parseAndComputeHoldings: parseCrypto, getTotalCryptoValueUsd } = await import("@/lib/utils/crypto-csv");
        const cryptoHoldings = parseCrypto(cryptoCsvText);
        // Apply prices we just fetched (stored in updates)
        const latestPrices = parse<{ prices: Record<string, number> }>("crypto_prices", { prices: {} });
        // Merge with any just-fetched prices
        const priceUpdate = updates.find((u) => u.key === "crypto_prices");
        const mergedPrices = priceUpdate ? { ...latestPrices.prices, ...JSON.parse(priceUpdate.value).prices } : latestPrices.prices;

        for (const h of cryptoHoldings) {
          const mappedTicker = tickerMappings[h.token] ?? h.token;
          const price = mergedPrices[mappedTicker];
          if (price != null) h.currentValueUsd = price * h.amount;
        }
        cryptoTotalUsd = getTotalCryptoValueUsd(cryptoHoldings);
      } catch { /* silent */ }
    }

    // Crypto snapshot
    const hasCryptoToday = cryptoSnapshots.some((s) => s.date === today);
    if (!hasCryptoToday && cryptoTotalUsd > 0) {
      updates.push({
        key: "crypto_snapshots",
        value: JSON.stringify([...cryptoSnapshots.slice(-89), { date: today, value: cryptoTotalUsd, currency: "USD" }]),
        updated_at: now,
      });
      log.push(`Crypto snapshot: $${cryptoTotalUsd.toFixed(0)} USD`);
    }

    // Debts (converted to USD)
    const debtRecords = parse<{ id: string; direction: string; originalAmount: number; currency: string }[]>("debt_records", []);
    const debtTransactions = parse<{ debtId: string; amount: number }[]>("debt_transactions", []);
    let owedToMe = 0;
    let iOwe = 0;
    for (const d of debtRecords) {
      const paid = debtTransactions.filter((t) => t.debtId === d.id).reduce((s, t) => s + t.amount, 0);
      const remaining = Math.max(0, d.originalAmount - paid);
      const inUsd = toUsd(remaining, d.currency ?? "AUD");
      if (d.direction === "owed_to_me") owedToMe += inUsd;
      else iOwe += inUsd;
    }

    // Net worth = portfolio + crypto + owed - owe (all in USD)
    const netWorth = portfolioTotal + cryptoTotalUsd + owedToMe - iOwe;
    const netWorthNoSuper = portfolioNoSuper + cryptoTotalUsd + owedToMe - iOwe;

    const hasNwToday = nwSnapshots.some((s) => s.date === today);
    if (!hasNwToday) {
      updates.push({
        key: "networth_snapshots",
        value: JSON.stringify([...nwSnapshots.slice(-89), { date: today, value: netWorth, valueNoSuper: netWorthNoSuper, currency: "USD", portfolio: portfolioTotal, crypto: cryptoTotalUsd }]),
        updated_at: now,
      });
      log.push(`Net worth: $${netWorth.toFixed(0)} (portfolio=$${portfolioTotal.toFixed(0)} crypto=$${cryptoTotalUsd.toFixed(0)} owed=$${owedToMe.toFixed(0)} debt=$${iOwe.toFixed(0)}) USD`);
    }

    // ── Write updates ──
    if (updates.length > 0) {
      const { error } = await supabase.from("app_data").upsert(updates, { onConflict: "key" });
      if (error) {
        log.push(`Supabase error: ${error.message}`);
        // Still save the log
        await saveCronLog(today, log, false);
        return NextResponse.json({ error: error.message, log }, { status: 500 });
      }
    }

    log.push(`Done. ${updates.length} keys updated.`);
    await saveCronLog(today, log, true);

    return NextResponse.json({
      ok: true,
      date: today,
      keysUpdated: updates.length,
      log,
    });
  } catch (e) {
    log.push(`Error: ${String(e)}`);
    await saveCronLog(today, log, false);
    return NextResponse.json({ error: String(e), log }, { status: 500 });
  }
}

async function saveCronLog(date: string, log: string[], success: boolean) {
  try {
    const existing = await supabase
      .from("app_data")
      .select("value")
      .eq("key", "cron_log")
      .single();

    const logs = existing.data ? JSON.parse(existing.data.value) : [];
    logs.unshift({ date, timestamp: new Date().toISOString(), success, log });
    // Keep last 30 runs
    const trimmed = logs.slice(0, 30);

    await supabase.from("app_data").upsert({
      key: "cron_log",
      value: JSON.stringify(trimmed),
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  } catch {
    // silently fail — log is best-effort
  }
}
