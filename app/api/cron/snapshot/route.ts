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
  // Verify cron secret (Vercel sets this automatically)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    const holdings = parse<{ currentValue: number }[]>("portfolio_holdings", []);
    const portfolioSnapshots = parse<{ date: string }[]>("portfolio_snapshots", []);
    const nwSnapshots = parse<{ date: string; value: number }[]>("networth_snapshots", []);
    const incomeEntries = parse<{ id: string; date: string; recurringId?: string }[]>("income_entries", []);
    const expenseEntries = parse<{ id: string; date: string; recurringId?: string }[]>("expense_entries", []);
    const incomeTemplates = parse<RecurringTemplate[]>("recurring_income_templates", []);
    const expenseTemplates = parse<RecurringTemplate[]>("recurring_expense_templates", []);

    const updates: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    // ── 1. Portfolio snapshot ──
    const portfolioTotal = holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
    const hasPortfolioToday = portfolioSnapshots.some((s) => s.date === today);

    if (!hasPortfolioToday && portfolioTotal > 0) {
      const newSnapshots = [...portfolioSnapshots.slice(-89), { date: today, value: portfolioTotal }];
      updates.push({ key: "portfolio_snapshots", value: JSON.stringify(newSnapshots), updated_at: now });
      log.push(`Portfolio snapshot added: ${portfolioTotal}`);
    } else {
      log.push(`Portfolio snapshot: ${hasPortfolioToday ? "already exists" : "no holdings"}`);
    }

    // ── 2. Net worth snapshot ──
    const hasNwToday = nwSnapshots.some((s) => s.date === today);
    if (!hasNwToday && portfolioTotal > 0) {
      const newNw = [...nwSnapshots.slice(-89), { date: today, value: portfolioTotal }];
      updates.push({ key: "networth_snapshots", value: JSON.stringify(newNw), updated_at: now });
      log.push(`Net worth snapshot added: ${portfolioTotal}`);
    } else {
      log.push(`Net worth snapshot: ${hasNwToday ? "already exists" : "no data"}`);
    }

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
