import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeOccurrences } from "@/lib/utils/timezone";
import { fetchExtendedStockQuote } from "@/lib/utils/stock-prices";
import { rowToCamel, rowToSnake } from "@/lib/supabase/tables";

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
    // ── Load data from relational tables + KV for settings/cache ──
    const [
      { data: holdingsRaw },
      { data: incomeEntriesRaw },
      { data: expenseEntriesRaw },
      { data: incomeTemplatesRaw },
      { data: expenseTemplatesRaw },
      { data: tickerMappingsRaw },
      { data: cryptoCsvRaw },
      { data: cryptoPricesRaw },
    ] = await Promise.all([
      supabase.from("portfolio_holdings").select("*"),
      supabase.from("income_entries").select("id, date, recurring_id"),
      supabase.from("expense_entries").select("id, date, recurring_id"),
      supabase.from("recurring_income_templates").select("*"),
      supabase.from("recurring_expense_templates").select("*"),
      supabase.from("app_data").select("value").eq("key", "crypto_ticker_mappings").single(),
      supabase.from("app_data").select("value").eq("key", "crypto_csv_text").single(),
      supabase.from("app_data").select("value").eq("key", "crypto_prices").single(),
    ]);

    // Convert to camelCase for internal logic
    const holdings = (holdingsRaw ?? []).map((r) => rowToCamel(r)) as {
      id: string; ticker: string; country: string; units: number;
      currentValue: number; currency: string; type: string; accountType: string;
    }[];
    const incomeEntries = (incomeEntriesRaw ?? []).map((r) => rowToCamel(r)) as {
      id: string; date: string; recurringId?: string;
    }[];
    const expenseEntries = (expenseEntriesRaw ?? []).map((r) => rowToCamel(r)) as {
      id: string; date: string; recurringId?: string;
    }[];
    const incomeTemplates = (incomeTemplatesRaw ?? []).map((r) => rowToCamel(r)) as RecurringTemplate[];
    const expenseTemplates = (expenseTemplatesRaw ?? []).map((r) => rowToCamel(r)) as RecurringTemplate[];
    const tickerMappings: Record<string, string> = tickerMappingsRaw?.value
      ? JSON.parse(tickerMappingsRaw.value)
      : {};
    const cryptoCsvText: string = cryptoCsvRaw?.value
      ? JSON.parse(cryptoCsvRaw.value)
      : "";
    const storedCryptoPrices: { prices: Record<string, number> } = cryptoPricesRaw?.value
      ? JSON.parse(cryptoPricesRaw.value)
      : { prices: {} };

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
        // Write updated holdings directly to their table
        for (const h of stockHoldings) {
          await supabase.from("portfolio_holdings")
            .update(rowToSnake({ currentValue: h.currentValue, currency: h.currency }))
            .eq("id", h.id);
        }
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
      await supabase.from("snapshots").insert({
        type: "portfolio",
        date: sydneyTime,
        value: portfolioNoSuper,
        value_with_super: portfolioTotal,
        currency: "USD",
      });
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
        const snakeEntries = newEntries.map((e) => rowToSnake(e));
        const { error: insertErr } = await supabase.from("income_entries").insert(snakeEntries);
        if (insertErr) log.push(`Recurring income insert error: ${insertErr.message}`);

        // Update templates with lastGeneratedDate
        for (const t of updatedTemplates) {
          if (t.lastGeneratedDate) {
            await supabase.from("recurring_income_templates")
              .update({ last_generated_date: t.lastGeneratedDate })
              .eq("id", t.id);
          }
        }
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
        const snakeEntries = newEntries.map((e) => rowToSnake(e));
        const { error: insertErr } = await supabase.from("expense_entries").insert(snakeEntries);
        if (insertErr) log.push(`Recurring expense insert error: ${insertErr.message}`);

        // Update templates with lastGeneratedDate
        for (const t of updatedTemplates) {
          if (t.lastGeneratedDate) {
            await supabase.from("recurring_expense_templates")
              .update({ last_generated_date: t.lastGeneratedDate })
              .eq("id", t.id);
          }
        }
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
    let freshCryptoPrices: Record<string, number> | null = null;

    if (cryptoCsvText) {
      try {
        const { parseAndComputeHoldings } = await import("@/lib/utils/crypto-csv");
        const { STABLECOINS, YIELD_PREFIXES, COINGECKO_IDS } = await import("@/lib/utils/constants");

        const cryptoHoldingsParsed = parseAndComputeHoldings(cryptoCsvText);

        // Filter non-stable tokens — use ticker mapping to detect stablecoins by mapped symbol too
        const nonStableTokens = cryptoHoldingsParsed.filter((h) => {
          const upper = h.token.toUpperCase();
          const mapped = (tickerMappings[h.token] ?? h.token).toUpperCase();
          if (STABLECOINS.has(upper) || STABLECOINS.has(mapped)) return false;
          if (upper === "STABLECOIN" || upper === "CASH") return false;
          if (YIELD_PREFIXES.some((p) => upper.toLowerCase().startsWith(p))) return false;
          return h.amount > 0;
        });

        log.push(`Holdings: ${cryptoHoldingsParsed.length} total, ${nonStableTokens.length} to price`);

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
                freshCryptoPrices = prices;
                // Write crypto prices to app_data KV (it's a cache)
                await supabase.from("app_data").upsert({
                  key: "crypto_prices",
                  value: JSON.stringify({ prices, fetchedAt: Date.now() }),
                  updated_at: new Date().toISOString(),
                }, { onConflict: "key" });
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
        // Merge stored prices with any just-fetched prices
        const mergedPrices = freshCryptoPrices
          ? { ...storedCryptoPrices.prices, ...freshCryptoPrices }
          : storedCryptoPrices.prices;

        for (const h of cryptoHoldings) {
          const price = mergedPrices[h.token] ?? mergedPrices[tickerMappings[h.token] ?? h.token];
          if (price != null) h.currentValueUsd = price * h.amount;
        }
        cryptoTotalUsd = getTotalCryptoValueUsd(cryptoHoldings);
      } catch { /* silent */ }
    }

    // Crypto snapshot — INSERT one row
    if (cryptoTotalUsd > 0) {
      await supabase.from("snapshots").insert({
        type: "crypto",
        date: sydneyTime,
        value: cryptoTotalUsd,
        currency: "USD",
      });
      log.push(`Crypto snapshot: $${cryptoTotalUsd.toFixed(0)} USD`);
    }

    // Debts (converted to USD) — read from relational tables
    const [{ data: debtRecordsRaw }, { data: debtTxRaw }] = await Promise.all([
      supabase.from("debt_records").select("id, direction, original_amount, currency"),
      supabase.from("debt_transactions").select("debt_id, amount"),
    ]);
    const debtRecords = (debtRecordsRaw ?? []).map((r) => rowToCamel(r)) as {
      id: string; direction: string; originalAmount: number; currency: string;
    }[];
    const debtTransactions = (debtTxRaw ?? []).map((r) => rowToCamel(r)) as {
      debtId: string; amount: number;
    }[];

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

    // Net worth snapshot — INSERT one row
    await supabase.from("snapshots").insert({
      type: "networth",
      date: sydneyTime,
      value: netWorth,
      value_no_super: netWorthNoSuper,
      currency: "USD",
      portfolio: portfolioTotal,
      crypto: cryptoTotalUsd,
    });
    log.push(`Net worth: $${netWorth.toFixed(0)} (portfolio=$${portfolioTotal.toFixed(0)} crypto=$${cryptoTotalUsd.toFixed(0)} owed=$${owedToMe.toFixed(0)} debt=$${iOwe.toFixed(0)}) USD`);

    log.push(`Done.`);
    await saveCronLog(today, log, true);

    return NextResponse.json({
      ok: true,
      date: today,
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
    await supabase.from("cron_logs").insert({
      date,
      success,
      log: JSON.stringify(log),
    });

    // Trim old logs (keep last 30)
    const { data: old } = await supabase.from("cron_logs")
      .select("id")
      .order("created_at", { ascending: false })
      .range(30, 99999);
    if (old && old.length > 0) {
      await supabase.from("cron_logs").delete().in("id", old.map((r) => r.id));
    }
  } catch {
    // silently fail — log is best-effort
  }
}
