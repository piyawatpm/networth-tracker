import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeOccurrences } from "@/lib/utils/timezone";
import { fetchExtendedStockQuote } from "@/lib/utils/stock-prices";

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
  const sydneyTime = new Date().toLocaleString("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).replace(",", "");
  log.push(`Cron started at ${new Date().toISOString()}, Sydney: ${sydneyTime}`);

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

    const holdings = parse<{ id: string; ticker: string; country: string; units: number; currentValue: number; currency: string; type: string; accountType: string }[]>("portfolio_holdings", []);
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

    // ── 0. Update stock prices (Yahoo primary — includes pre/post, Finnhub fallback) ──
    const stockHoldings = holdings.filter((h) => h.ticker && h.units > 0 && h.type !== "savings");
    if (stockHoldings.length > 0) {
      let updatedCount = 0;
      let extendedCount = 0;
      const stateCounts: Record<string, number> = {};
      // Sequential to respect rate limits (Finnhub 30/sec, Yahoo soft-limited)
      for (const h of stockHoldings) {
        const quote = await fetchExtendedStockQuote(h.ticker, h.country);
        if (quote) {
          h.currentValue = h.units * quote.price;
          if (quote.currency) h.currency = quote.currency;
          updatedCount++;
          if (quote.extended) extendedCount++;
          stateCounts[quote.marketState] = (stateCounts[quote.marketState] ?? 0) + 1;
        }
      }
      if (updatedCount > 0) {
        updates.push({ key: "portfolio_holdings", value: JSON.stringify(holdings), updated_at: now });
        const stateSummary = Object.entries(stateCounts).map(([k, v]) => `${k}:${v}`).join(" ");
        log.push(`Stock prices: ${updatedCount}/${stockHoldings.length} updated (${extendedCount} from pre/post; ${stateSummary})`);
      } else {
        log.push(`Stock prices: no updates (yahoo+finnhub both failed)`);
      }
    }

    // ── 1. Portfolio snapshot (converted to USD) ──
    const portfolioTotal = holdings
      .filter((h) => h.type !== "savings")
      .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency ?? "AUD"), 0);
    const portfolioNoSuper = holdings
      .filter((h) => h.type !== "savings" && h.accountType !== "super")
      .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency ?? "AUD"), 0);

    if (portfolioTotal > 0) {
      const newSnapshots = [...portfolioSnapshots, { date: sydneyTime, value: portfolioNoSuper, valueWithSuper: portfolioTotal, currency: "USD" }];
      updates.push({ key: "portfolio_snapshots", value: JSON.stringify(newSnapshots), updated_at: now });
      log.push(`Portfolio snapshot: w/super=$${portfolioTotal.toFixed(0)} no-super=$${portfolioNoSuper.toFixed(0)} USD`);
    } else {
      log.push(`Portfolio snapshot: no holdings`);
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

    // ── 5. Crypto price update via CoinGecko ──
    // Binance blocks Vercel server IPs, so we use CoinGecko as primary source.
    // Client-side (browser) still uses Binance WS for real-time streaming.
    const cryptoCsvText = parse<string>("crypto_csv_text", "");

    if (cryptoCsvText) {
      try {
        const { parseAndComputeHoldings } = await import("@/lib/utils/crypto-csv");
        const { STABLECOINS, YIELD_PREFIXES, COINGECKO_IDS } = await import("@/lib/utils/constants");

        const holdings = parseAndComputeHoldings(cryptoCsvText);

        // Filter non-stable tokens — use ticker mapping to detect stablecoins by mapped symbol too
        const nonStableTokens = holdings.filter((h) => {
          const upper = h.token.toUpperCase();
          const mapped = (tickerMappings[h.token] ?? h.token).toUpperCase();
          if (STABLECOINS.has(upper) || STABLECOINS.has(mapped)) return false;
          if (upper === "STABLECOIN" || upper === "CASH") return false;
          if (YIELD_PREFIXES.some((p) => upper.toLowerCase().startsWith(p))) return false;
          return h.amount > 0;
        });

        log.push(`Holdings: ${holdings.length} total, ${nonStableTokens.length} to price`);

        if (nonStableTokens.length > 0 && process.env.COINGECKO_API_KEY) {
          // Map tokens to CoinGecko IDs via ticker mappings
          const cgMap: { token: string; cgId: string }[] = [];
          const unmapped: string[] = [];

          for (const h of nonStableTokens) {
            const mapped = (tickerMappings[h.token] ?? h.token).toUpperCase();
            const cgId = COINGECKO_IDS[mapped] ?? COINGECKO_IDS[h.token];
            if (cgId) {
              cgMap.push({ token: h.token, cgId });
            } else {
              unmapped.push(`${h.token}(${mapped})`);
            }
          }

          if (unmapped.length > 0) {
            log.push(`No CoinGecko ID: ${unmapped.join(", ")} — add to COINGECKO_IDS in constants.ts`);
          }

          if (cgMap.length > 0) {
            const ids = cgMap.map((c) => c.cgId).join(",");
            const cgRes = await fetch(
              `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
              { headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } },
            );

            if (cgRes.ok) {
              const cgData = await cgRes.json();
              const prices: Record<string, number> = {};
              for (const { token, cgId } of cgMap) {
                const price = cgData[cgId]?.usd;
                if (price != null) prices[token] = price;
              }

              const fetched = Object.keys(prices).length;
              if (fetched > 0) {
                updates.push({
                  key: "crypto_prices",
                  value: JSON.stringify({ prices, fetchedAt: Date.now() }),
                  updated_at: now,
                });
                log.push(`CoinGecko: ${fetched}/${cgMap.length} — ${Object.entries(prices).map(([t, p]) => `${t}=$${p.toFixed(2)}`).join(", ")}`);
              } else {
                log.push(`CoinGecko: returned no prices`);
              }
            } else {
              log.push(`CoinGecko: HTTP ${cgRes.status}`);
            }
          }
        } else if (nonStableTokens.length > 0) {
          log.push(`CoinGecko API key: MISSING — add COINGECKO_API_KEY to Vercel env vars`);
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
          const price = mergedPrices[h.token] ?? mergedPrices[tickerMappings[h.token] ?? h.token];
          if (price != null) h.currentValueUsd = price * h.amount;
        }
        cryptoTotalUsd = getTotalCryptoValueUsd(cryptoHoldings);
      } catch { /* silent */ }
    }

    // Crypto snapshot — append new entry each run
    if (cryptoTotalUsd > 0) {
      updates.push({
        key: "crypto_snapshots",
        value: JSON.stringify([...cryptoSnapshots, { date: sydneyTime, value: cryptoTotalUsd, currency: "USD" }]),
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

    // Net worth snapshot — append new entry each run
    updates.push({
      key: "networth_snapshots",
      value: JSON.stringify([...nwSnapshots, { date: sydneyTime, value: netWorth, valueNoSuper: netWorthNoSuper, currency: "USD", portfolio: portfolioTotal, crypto: cryptoTotalUsd }]),
      updated_at: now,
    });
    log.push(`Net worth: $${netWorth.toFixed(0)} (portfolio=$${portfolioTotal.toFixed(0)} crypto=$${cryptoTotalUsd.toFixed(0)} owed=$${owedToMe.toFixed(0)} debt=$${iOwe.toFixed(0)}) USD`);

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
