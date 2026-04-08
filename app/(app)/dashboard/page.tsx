"use client";

import { useState, useMemo } from "react";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import { GoalSection } from "@/components/dashboard/goal-section";
import {
  parseAndComputeHoldings,
  getTotalCryptoValueUsd,
  applyStablecoinTags,
} from "@/lib/utils/crypto-csv";
import {
  getSydneyDateString,
  getLast6MonthKeys,
  computeOccurrences,
  formatDateString,
} from "@/lib/utils/timezone";
import {
  INCOME_TYPE_LABELS,
  EXPENSE_TYPE_LABELS,
  FREQUENCY_LABELS,
} from "@/lib/utils/constants";
import type {
  IncomeEntry,
  ExpenseEntry,
  PortfolioHolding,
  PortfolioTransaction,
  DebtRecord,
  DebtTransaction,
  Currency,
  RecurringExpense,
  RecurringIncome,
} from "@/lib/utils/types";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

// Sub-components
import { NetWorthChart } from "./_components/net-worth-chart";
import { TopMovers } from "./_components/top-movers";
import {
  UpcomingRecurring,
  type UpcomingItem,
} from "./_components/upcoming-recurring";
import { AssetBreakdown } from "./_components/asset-breakdown";
import { WorldDistributionChart } from "./_components/world-distribution-chart";
import { MoneyFlowCard } from "./_components/money-flow-card";
import { EmergencyFundCard } from "./_components/emergency-fund-card";
import { KeyNumbersCard } from "./_components/key-numbers-card";
import { totalInvestedInRange } from "@/lib/utils/portfolio-transactions";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Period = "W" | "M" | "Y";

function debtRemaining(
  debt: DebtRecord,
  transactions: DebtTransaction[],
): number {
  const payments = transactions
    .filter((t) => t.debtId === debt.id)
    .reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), 0);
  return Math.max(0, debt.originalAmount - payments);
}

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

function isInPeriod(dateStr: string, period: Period): boolean {
  if (!dateStr) return false;
  const today = getSydneyDateString();
  switch (period) {
    case "W":
      return dateStr >= getWeekStart();
    case "M":
      return dateStr.slice(0, 7) === today.slice(0, 7);
    case "Y":
      return dateStr.slice(0, 4) === today.slice(0, 4);
  }
}

function getPreviousPeriodRange(period: Period): { start: string; end: string } {
  const today = getSydneyDateString();
  const [y, m] = today.split("-").map(Number);
  switch (period) {
    case "W": {
      const ws = getWeekStart();
      const prevEnd = new Date(ws);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - 6);
      return { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) };
    }
    case "M": {
      const lastMonth = m === 1 ? 12 : m - 1;
      const lastYear = m === 1 ? y - 1 : y;
      const prefix = `${lastYear}-${String(lastMonth).padStart(2, "0")}`;
      return { start: `${prefix}-01`, end: `${prefix}-31` };
    }
    case "Y": {
      const prefix = `${y - 1}`;
      return { start: `${prefix}-01-01`, end: `${prefix}-12-31` };
    }
  }
}

function isInPrevPeriod(dateStr: string, period: Period): boolean {
  if (!dateStr) return false;
  const { start, end } = getPreviousPeriodRange(period);
  return dateStr >= start && dateStr <= end;
}

function sumConverted(
  entries: { amount: number; currency: Currency }[],
  convert: (a: number, from: Currency) => number,
): number {
  return entries.reduce((s, e) => s + convert(e.amount, e.currency), 0);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  // ---- Data sources -------------------------------------------------------
  const [incomeEntries] = useCloudStorage<IncomeEntry[]>("income_entries", []);
  const [expenseEntries] = useCloudStorage<ExpenseEntry[]>("expense_entries", []);
  const [cryptoCsvText] = useCloudStorage<string>("crypto_csv_text", "");
  const [portfolioHoldings] = useCloudStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [debtRecords] = useCloudStorage<DebtRecord[]>("debt_records", []);
  const [debtTransactions] = useCloudStorage<DebtTransaction[]>("debt_transactions", []);
  const [recurringExpenses] = useCloudStorage<RecurringExpense[]>("recurring_expense_templates", []);
  const [recurringIncomes] = useCloudStorage<RecurringIncome[]>("recurring_income_templates", []);
  const [portfolioTransactions] = useCloudStorage<PortfolioTransaction[]>("portfolio_transactions", []);
  const [nwSnapshots] = useCloudStorage<{ date: string; value: number }[]>("networth_snapshots", []);
  const [stablecoinTags] = useCloudStorage<Record<string, boolean>>("crypto_stablecoin_tags", {});
  const [cryptoEmergencyTags] = useCloudStorage<Record<string, boolean>>("crypto_emergency_tags", {});
  const [efTargetMonths] = useCloudStorage<number>("emergency_fund_target_months", 6);

  const { convert, format, symbol, currency } = useCurrency();
  const [period, setPeriod] = useState<Period>("M");
  const [includeSuper, setIncludeSuper] = useState(true);

  // Section visibility
  const [hiddenSections, setHiddenSections] = useCloudStorage<string[]>("dashboard_hidden_sections", []);
  const toggleSection = (key: string) => {
    setHiddenSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  // ---- Derived data -------------------------------------------------------

  const rawCryptoHoldings = useMemo(() => (cryptoCsvText ? parseAndComputeHoldings(cryptoCsvText) : []), [cryptoCsvText]);
  const cryptoHoldings = useMemo(() => applyStablecoinTags(rawCryptoHoldings, stablecoinTags), [rawCryptoHoldings, stablecoinTags]);
  const last6Keys = getLast6MonthKeys();

  const portfolioTotal = useMemo(() => portfolioHoldings.reduce((s, h) => s + convert(h.currentValue, h.currency), 0), [portfolioHoldings, convert]);
  const cryptoTotal = useMemo(() => convert(getTotalCryptoValueUsd(cryptoHoldings), "USD"), [cryptoHoldings, convert]);

  const normalTotal = useMemo(
    () => portfolioHoldings.filter((h) => h.accountType === "normal").reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
    [portfolioHoldings, convert],
  );

  const superTotal = useMemo(
    () => portfolioHoldings.filter((h) => h.accountType === "super").reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
    [portfolioHoldings, convert],
  );

  const { owedToMe, iOwe } = useMemo(() => {
    let owedToMe = 0, iOwe = 0;
    for (const d of debtRecords) {
      const remaining = debtRemaining(d, debtTransactions);
      const converted = convert(remaining, d.currency);
      if (d.direction === "owed_to_me") owedToMe += converted;
      else iOwe += converted;
    }
    return { owedToMe, iOwe };
  }, [debtRecords, debtTransactions, convert]);

  const netWorthWithSuper = portfolioTotal + cryptoTotal + owedToMe - iOwe;
  const netWorthNoSuper = normalTotal + cryptoTotal + owedToMe - iOwe;
  const netWorth = includeSuper ? netWorthWithSuper : netWorthNoSuper;

  // Net worth trend — convert snapshots to display currency at render time
  const nwTrendData = useMemo(() => {
    return nwSnapshots.map((s) => {
      const ext = s as { valueNoSuper?: number; currency?: string; portfolio?: number; crypto?: number };
      const snapCur = ext.currency ?? "AUD";
      const fx = (v: number) => snapCur !== currency ? Math.round(convert(v, snapCur) * 100) / 100 : v;
      const rawNw = includeSuper ? s.value : (ext.valueNoSuper ?? s.value);
      return {
        date: s.date.slice(5),
        value: fx(rawNw),
        portfolio: ext.portfolio != null ? fx(ext.portfolio) : undefined,
        crypto: ext.crypto != null ? fx(ext.crypto) : undefined,
      };
    });
  }, [nwSnapshots, includeSuper, currency, convert]);

  // ---- Period-filtered income/expenses ------------------------------------

  const periodIncome = useMemo(() => incomeEntries.filter((e) => isInPeriod(e.date ?? "", period)), [incomeEntries, period]);
  const periodExpenses = useMemo(() => expenseEntries.filter((e) => isInPeriod(e.date ?? "", period)), [expenseEntries, period]);

  const periodIncomeTotal = useMemo(() => sumConverted(periodIncome, convert), [periodIncome, convert]);
  const periodExpenseTotal = useMemo(() => sumConverted(periodExpenses, convert), [periodExpenses, convert]);

  const periodInvested = useMemo(() => {
    const today = getSydneyDateString();
    let from: string;
    if (period === "W") from = getWeekStart();
    else if (period === "M") from = today.slice(0, 7) + "-01";
    else from = today.slice(0, 4) + "-01-01";
    return totalInvestedInRange(portfolioTransactions, from, today, convert);
  }, [period, convert, portfolioTransactions]);

  const savingsRate = periodIncomeTotal > 0 ? ((periodIncomeTotal - periodExpenseTotal) / periodIncomeTotal) * 100 : 0;

  // Emergency fund = savings-type + tagged holdings + tagged crypto
  const { emergencyFundTotal, efAllocations } = useMemo(() => {
    const allocs: { label: string; value: number; color: string }[] = [];
    const colors = ["#4d7cc7", "#2e8b57", "#d4a033", "#9e5e8e", "#2ea598", "#708090", "#cd5c5c", "#5b8a72"];
    let ci = 0;
    // Portfolio
    for (const h of portfolioHoldings) {
      if (h.type === "savings" || h.isEmergencyFund) {
        allocs.push({ label: h.name, value: convert(h.currentValue, h.currency), color: colors[ci++ % colors.length] });
      }
    }
    // Crypto
    for (const h of cryptoHoldings) {
      if (cryptoEmergencyTags[h.token]) {
        allocs.push({ label: h.token, value: convert(h.currentValueUsd, "USD"), color: colors[ci++ % colors.length] });
      }
    }
    allocs.sort((a, b) => b.value - a.value);
    return { emergencyFundTotal: allocs.reduce((s, a) => s + a.value, 0), efAllocations: allocs };
  }, [portfolioHoldings, cryptoHoldings, cryptoEmergencyTags, convert]);

  // Weighted average monthly expenses (recent 3mo × 2 + older 3mo × 1)
  const weightedMonthlyExpenses = useMemo(() => {
    const monthlyTotals = last6Keys.map((mk) =>
      expenseEntries.filter((e) => (e.date ?? "").startsWith(mk)).reduce((s, e) => s + convert(e.amount, e.currency), 0),
    );
    const recent3 = monthlyTotals.slice(-3);
    const older3 = monthlyTotals.slice(0, 3);
    const recent3Avg = recent3.filter((v) => v > 0).length > 0
      ? recent3.reduce((s, v) => s + v, 0) / Math.max(1, recent3.filter((v) => v > 0).length) : 0;
    const older3Avg = older3.filter((v) => v > 0).length > 0
      ? older3.reduce((s, v) => s + v, 0) / Math.max(1, older3.filter((v) => v > 0).length) : 0;
    return older3Avg > 0 ? (recent3Avg * 2 + older3Avg) / 3 : recent3Avg;
  }, [expenseEntries, convert, last6Keys]);

  const emergencyFundMonths = weightedMonthlyExpenses > 0 ? emergencyFundTotal / weightedMonthlyExpenses : 0;

  // Passive income for FI ratio
  const passiveIncome = useMemo(() => {
    const defaultPassive = ["dividend", "crypto_yield", "interest", "rental"];
    return periodIncome
      .filter((e) => e.isPassive === true || (e.isPassive === undefined && defaultPassive.includes(e.type)))
      .reduce((s, e) => s + convert(e.amount, e.currency), 0);
  }, [periodIncome, convert]);

  const passiveAnnualized = useMemo(() => {
    if (period === "Y") return passiveIncome;
    if (period === "M") return passiveIncome * 12;
    return passiveIncome * 52;
  }, [passiveIncome, period]);

  const annualizedExpenses = useMemo(() => {
    if (period === "Y") return periodExpenseTotal;
    if (period === "M") return periodExpenseTotal * 12;
    return periodExpenseTotal * 52;
  }, [periodExpenseTotal, period]);

  const fiRatio = annualizedExpenses > 0 ? (passiveAnnualized / annualizedExpenses) * 100 : 0;

  // Investment rate: (portfolio + crypto) / net worth
  const investmentAssets = portfolioTotal + cryptoTotal;
  const investRate = netWorth > 0 ? (investmentAssets / netWorth) * 100 : 0;

  // Runway: all liquid assets / monthly burn
  const liquidAssets = normalTotal + cryptoTotal + emergencyFundTotal;
  const runwayMonths = weightedMonthlyExpenses > 0 ? liquidAssets / weightedMonthlyExpenses : 99;

  // ---- Asset breakdown rows -----------------------------------------------

  const portfolioDisplayTotal = (includeSuper ? portfolioTotal : normalTotal) - emergencyFundTotal;

  const assetRows = useMemo(() => [
    { key: "portfolio", label: "Portfolio", value: portfolioDisplayTotal, negative: false },
    { key: "crypto", label: "Crypto", value: cryptoTotal, negative: false },
    { key: "emergency", label: "Emergency Fund", value: emergencyFundTotal, negative: false },
    { key: "owed_to_me", label: "Owed to Me", value: owedToMe, negative: false },
    { key: "i_owe", label: "I Owe", value: -iOwe, negative: true },
  ], [portfolioDisplayTotal, cryptoTotal, emergencyFundTotal, owedToMe, iOwe]);

  // ---- Portfolio Highlights -----------------------------------------------

  const portfolioHighlights = useMemo(() => {
    type HL = { name: string; pnl: number; pnlPct: number };
    const items: HL[] = [];
    for (const h of portfolioHoldings) {
      const cur = convert(h.currentValue, h.currency), cost = convert(h.amountInvested, h.currency);
      items.push({ name: h.ticker || h.name, pnl: cur - cost, pnlPct: cost > 0 ? ((cur - cost) / cost) * 100 : 0 });
    }
    for (const h of cryptoHoldings) {
      const cur = convert(h.currentValueUsd, "USD"), cost = convert(h.totalCostUsd, "USD");
      items.push({ name: h.token, pnl: cur - cost, pnlPct: cost > 0 ? ((cur - cost) / cost) * 100 : 0 });
    }
    const sorted = [...items].sort((a, b) => b.pnl - a.pnl);
    return { gainers: sorted.filter((i) => i.pnl > 0).slice(0, 3), losers: sorted.filter((i) => i.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 3) };
  }, [portfolioHoldings, cryptoHoldings, convert]);

  // ---- Upcoming Recurring -------------------------------------------------

  const upcomingRecurring = useMemo(() => {
    const todayStr = getSydneyDateString();
    const d30 = new Date(); d30.setDate(d30.getDate() + 30);
    const thirtyDaysLater = `${d30.getFullYear()}-${String(d30.getMonth() + 1).padStart(2, "0")}-${String(d30.getDate()).padStart(2, "0")}`;
    const items: UpcomingItem[] = [];
    for (const t of recurringExpenses) {
      if (!t.active) continue;
      const occ = computeOccurrences(t.startDate, t.frequency, todayStr, thirtyDaysLater);
      if (occ.length > 0) items.push({ description: t.description, amount: t.amount, currency: t.currency, kind: "expense", frequency: FREQUENCY_LABELS[t.frequency], nextDate: occ[0] });
    }
    for (const t of recurringIncomes) {
      if (!t.active) continue;
      const occ = computeOccurrences(t.startDate, t.frequency, todayStr, thirtyDaysLater);
      if (occ.length > 0) items.push({ description: t.description, amount: t.amount, currency: t.currency, kind: "income", frequency: FREQUENCY_LABELS[t.frequency], nextDate: occ[0] });
    }
    return items.sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 5);
  }, [recurringExpenses, recurringIncomes]);

  // ---- Recent activity feed -----------------------------------------------

  const recentActivity = useMemo(() => {
    const items: { id: string; kind: "income" | "expense"; label: string; description: string; amount: number; currency: string; date: string }[] = [];
    for (const e of incomeEntries) {
      items.push({ id: e.id, kind: "income", label: (INCOME_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type, description: e.description, amount: e.amount, currency: e.currency, date: e.date });
    }
    for (const e of expenseEntries) {
      items.push({ id: e.id, kind: "expense", label: (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type, description: e.description, amount: e.amount, currency: e.currency, date: e.date });
    }
    return items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 6);
  }, [incomeEntries, expenseEntries]);

  // ---- Render -------------------------------------------------------------

  const D = 0.05;

  return (
    <div className="space-y-6 pb-12">
      {/* Floating period toggle (Liquid Glass) */}
      <div
        className="fixed right-4 lg:right-8 z-40 md:bottom-6"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}
      >
        <div className="liquid-glass flex items-center rounded-full p-[3px] gap-[2px]">
          {(["W", "M", "Y"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "relative z-10 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200",
                period === p
                  ? "liquid-glass-pill text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* 1. NET WORTH HERO */}
      <BlurFade delay={0}>
        <section className="flex items-start justify-between gap-4">
          <div>
            <p className="label-mono mb-2">Net Worth</p>
            <div className="display-number">
              <NumberTicker value={netWorth} prefix={symbol} decimalPlaces={0} className="display-number" />
            </div>
          </div>
          <button
            onClick={() => setIncludeSuper(!includeSuper)}
            className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground mt-1"
          >
            <span className="hidden sm:inline">Include Super</span>
            <span className="sm:hidden">Super</span>
            <span className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors", includeSuper ? "bg-income" : "bg-border")}>
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform", includeSuper ? "translate-x-[18px]" : "translate-x-[3px]")} />
            </span>
          </button>
        </section>
      </BlurFade>

      {/* 2. NET WORTH TREND */}
      <NetWorthChart nwTrendData={nwTrendData} format={format} includeSuper={includeSuper} delay={D} />

      {/* 3. ASSET BREAKDOWN + WORLD DISTRIBUTION + MONEY FLOW */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <AssetBreakdown rows={assetRows} hiddenSections={hiddenSections} onToggleSection={toggleSection} format={format} delay={D * 0.5} />
        <div className="md:col-span-3">
          <WorldDistributionChart
            normalTotal={normalTotal}
            cryptoTotal={cryptoTotal}
            superTotal={superTotal}
            format={format}
            delay={0.15}
          />
        </div>
        <div className="md:col-span-5">
          <MoneyFlowCard
            periodLabel={period === "W" ? "This Week" : period === "M" ? "This Month" : "This Year"}
            periodIncome={periodIncomeTotal}
            periodExpenses={periodExpenseTotal}
            periodInvested={periodInvested}
            incomeEntries={periodIncome}
            expenseEntries={periodExpenses}
            convert={convert}
            format={format}
            delay={0.2}
          />
        </div>
      </div>

      {/* 4. EMERGENCY FUND + KEY NUMBERS */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <EmergencyFundCard
          fundTotal={emergencyFundTotal}
          monthlyBurn={weightedMonthlyExpenses}
          coverageMonths={emergencyFundMonths}
          targetMonths={efTargetMonths}
          allocations={efAllocations}
          format={format}
          delay={D * 2}
        />
        <KeyNumbersCard
          savingsRate={savingsRate}
          runwayMonths={runwayMonths}
          fiRatio={fiRatio}
          investRate={investRate}
          format={format}
          delay={D * 2.5}
        />
      </div>

      {/* 5. GOAL SECTION */}
      <GoalSection netWorth={netWorth} symbol={symbol} format={format} />

      {/* 6. TOP MOVERS + UPCOMING RECURRING */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <TopMovers gainers={portfolioHighlights.gainers} losers={portfolioHighlights.losers} format={format} delay={D * 3} />
        <UpcomingRecurring items={upcomingRecurring} format={format} delay={D * 3.5} />
      </div>

      {/* 7. RECENT ACTIVITY */}
      <BlurFade delay={D * 4}>
        <div className="finance-card px-3 py-4 sm:p-5">
          <p className="label-mono mb-3">Recent Activity</p>
          {recentActivity.length > 0 ? (
            <div className="divide-y divide-border/50">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-2.5">
                  <span className={cn(
                    "inline-flex items-center justify-center h-7 w-7 rounded-full shrink-0",
                    item.kind === "income" ? "bg-income/10 text-income" : "bg-expense/10 text-expense",
                  )}>
                    {item.kind === "income" ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.description || item.label}</p>
                    <p className="text-[11px] text-muted-foreground">{item.label} · {formatDateString(item.date)}</p>
                  </div>
                  <p className={cn(
                    "text-sm font-mono tabular-nums font-medium shrink-0",
                    item.kind === "income" ? "text-income" : "text-expense",
                  )}>
                    {item.kind === "income" ? "+" : "-"}{format(item.amount, item.currency as Currency)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/50 py-6 text-center">No transactions recorded yet</p>
          )}
        </div>
      </BlurFade>
    </div>
  );
}
