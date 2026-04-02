"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Settings2,
  Eye,
  EyeOff,
} from "lucide-react";
import ReactECharts from "echarts-for-react";
import { InteractiveDonut } from "@/components/ui/interactive-donut";
import { motion, AnimatePresence } from "motion/react";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { formatAxisValue } from "@/lib/utils/echarts";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import { GoalSection } from "@/components/dashboard/goal-section";
import {
  parseAndComputeHoldings,
  getTotalCryptoValueUsd,
} from "@/lib/utils/crypto-csv";
import {
  getSydneyDateString,
  getLast6MonthKeys,
  monthKeyToLabel,
  formatDateString,
  computeOccurrences,
} from "@/lib/utils/timezone";
import {
  CHART_COLORS,
  INCOME_TYPE_LABELS,
  EXPENSE_TYPE_LABELS,
  FREQUENCY_LABELS,
} from "@/lib/utils/constants";
import type {
  IncomeEntry,
  ExpenseEntry,
  PortfolioHolding,
  DebtRecord,
  DebtTransaction,
  Currency,
  RecurringExpense,
  RecurringIncome,
} from "@/lib/utils/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Period = "W" | "M" | "Y";

function debtRemaining(
  debt: DebtRecord,
  transactions: DebtTransaction[]
): number {
  const payments = transactions
    .filter((t) => t.debtId === debt.id)
    .reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), 0);
  return Math.max(0, debt.originalAmount - payments);
}

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
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
      return {
        start: prevStart.toISOString().slice(0, 10),
        end: prevEnd.toISOString().slice(0, 10),
      };
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

const PERIOD_LABELS: Record<Period, string> = { W: "This Week", M: "This Month", Y: "This Year" };

function sumConverted(
  entries: { amount: number; currency: Currency }[],
  convert: (a: number, from: Currency) => number
): number {
  return entries.reduce((s, e) => s + convert(e.amount, e.currency), 0);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [incomeEntries] = useLocalStorage<IncomeEntry[]>("income_entries", []);
  const [expenseEntries] = useLocalStorage<ExpenseEntry[]>("expense_entries", []);
  const [cryptoCsvText] = useLocalStorage<string>("crypto_csv_text", "");
  const [portfolioHoldings] = useLocalStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [debtRecords] = useLocalStorage<DebtRecord[]>("debt_records", []);
  const [debtTransactions] = useLocalStorage<DebtTransaction[]>("debt_transactions", []);
  const [recurringExpenses] = useLocalStorage<RecurringExpense[]>("recurring_expense_templates", []);
  const [recurringIncomes] = useLocalStorage<RecurringIncome[]>("recurring_income_templates", []);

  const [nwSnapshots, setNwSnapshots] = useLocalStorage<{ date: string; value: number }[]>("networth_snapshots", []);

  const { convert, format, symbol } = useCurrency();
  const [period, setPeriod] = useState<Period>("M");

  // Dashboard section visibility (persisted)
  const [hiddenSections, setHiddenSections] = useLocalStorage<string[]>("dashboard_hidden_sections", []);
  const [showSectionSettings, setShowSectionSettings] = useState(false);
  const toggleSection = (key: string) => {
    setHiddenSections((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };
  const isVisible = (key: string) => !hiddenSections.includes(key);

  // ---- Derived data -------------------------------------------------------

  const cryptoHoldings = useMemo(() => {
    if (!cryptoCsvText) return [];
    return parseAndComputeHoldings(cryptoCsvText);
  }, [cryptoCsvText]);

  const last6Keys = getLast6MonthKeys();

  // Portfolio total
  const portfolioTotal = useMemo(
    () => portfolioHoldings.reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
    [portfolioHoldings, convert]
  );

  // Crypto total
  const cryptoTotal = useMemo(
    () => convert(getTotalCryptoValueUsd(cryptoHoldings), "USD"),
    [cryptoHoldings, convert]
  );

  // Debts
  const { owedToMe, iOwe } = useMemo(() => {
    let owedToMe = 0;
    let iOwe = 0;
    for (const d of debtRecords) {
      const remaining = debtRemaining(d, debtTransactions);
      const converted = convert(remaining, d.currency);
      if (d.direction === "owed_to_me") owedToMe += converted;
      else iOwe += converted;
    }
    return { owedToMe, iOwe };
  }, [debtRecords, debtTransactions, convert]);

  const totalAssets = portfolioTotal + cryptoTotal + owedToMe;
  const netWorth = totalAssets - iOwe;

  // ---- Net worth snapshots ------------------------------------------------
  useEffect(() => {
    const today = getSydneyDateString();
    if (nwSnapshots.some((s) => s.date === today)) return;
    setNwSnapshots((prev) => [...prev.slice(-89), { date: today, value: netWorth }]);
  }, [netWorth, nwSnapshots, setNwSnapshots]);

  const nwTrendData = useMemo(() => {
    return nwSnapshots.map((s) => ({ date: s.date.slice(5), value: s.value }));
  }, [nwSnapshots]);

  // ---- Period-filtered income/expenses ------------------------------------

  const periodIncome = useMemo(
    () => incomeEntries.filter((e) => isInPeriod(e.date ?? "", period)),
    [incomeEntries, period]
  );
  const periodExpenses = useMemo(
    () => expenseEntries.filter((e) => isInPeriod(e.date ?? "", period)),
    [expenseEntries, period]
  );
  const prevPeriodIncome = useMemo(
    () => incomeEntries.filter((e) => isInPrevPeriod(e.date ?? "", period)),
    [incomeEntries, period]
  );
  const prevPeriodExpenses = useMemo(
    () => expenseEntries.filter((e) => isInPrevPeriod(e.date ?? "", period)),
    [expenseEntries, period]
  );

  const periodIncomeTotal = useMemo(() => sumConverted(periodIncome, convert), [periodIncome, convert]);
  const periodExpenseTotal = useMemo(() => sumConverted(periodExpenses, convert), [periodExpenses, convert]);
  const prevIncomeTotal = useMemo(() => sumConverted(prevPeriodIncome, convert), [prevPeriodIncome, convert]);
  const prevExpenseTotal = useMemo(() => sumConverted(prevPeriodExpenses, convert), [prevPeriodExpenses, convert]);

  const netCashFlow = periodIncomeTotal - periodExpenseTotal;
  const savingsRate = periodIncomeTotal > 0 ? ((periodIncomeTotal - periodExpenseTotal) / periodIncomeTotal) * 100 : 0;
  const debtToAssetRatio = totalAssets > 0 ? (iOwe / totalAssets) * 100 : 0;

  // Change vs previous period
  const incomeChange = prevIncomeTotal > 0 ? ((periodIncomeTotal - prevIncomeTotal) / prevIncomeTotal) * 100 : 0;
  const expenseChange = prevExpenseTotal > 0 ? ((periodExpenseTotal - prevExpenseTotal) / prevExpenseTotal) * 100 : 0;

  // ---- Financial Health Indicators ----------------------------------------

  // Annualized income (extrapolate from period)
  const annualizedIncome = useMemo(() => {
    if (period === "Y") return periodIncomeTotal;
    if (period === "M") return periodIncomeTotal * 12;
    return periodIncomeTotal * 52; // W
  }, [periodIncomeTotal, period]);

  const monthlyIncome = annualizedIncome / 12;
  const monthlyExpenses = useMemo(() => {
    if (period === "Y") return periodExpenseTotal / 12;
    if (period === "M") return periodExpenseTotal;
    return periodExpenseTotal * (52 / 12); // W
  }, [periodExpenseTotal, period]);

  // Debt-to-Income Ratio: monthly debt payments / monthly income
  // Use iOwe as proxy for total debt obligation (simplified)
  const debtToIncomeRatio = monthlyIncome > 0 ? (iOwe / (annualizedIncome)) * 100 : 0;

  // Emergency Fund Ratio: liquid assets / monthly expenses
  // Liquid = cash in portfolio (type "bond" or "other") + crypto stablecoins
  const liquidAssets = useMemo(() => {
    const cashLikePortfolio = portfolioHoldings
      .filter((h) => h.type === "bond" || h.type === "other")
      .reduce((s, h) => s + convert(h.currentValue, h.currency), 0);
    // Include crypto stablecoins
    const stablecoinValue = cryptoHoldings
      .filter((h) => ["USDC", "USDT", "DAI", "BUSD", "FDUSD", "PYUSD", "TUSD", "USD1"].includes(h.token.toUpperCase()))
      .reduce((s, h) => s + convert(h.currentValueUsd, "USD"), 0);
    return cashLikePortfolio + stablecoinValue;
  }, [portfolioHoldings, cryptoHoldings, convert]);

  const emergencyFundMonths = monthlyExpenses > 0 ? liquidAssets / monthlyExpenses : 0;

  // Wealth-to-Income Ratio: net worth / annual income
  const wealthToIncomeRatio = annualizedIncome > 0 ? netWorth / annualizedIncome : 0;

  // Financial Independence Ratio: passive income / total expenses
  // Passive = dividends + interest + crypto_yield + rental
  const passiveIncome = useMemo(() => {
    const passiveTypes = ["dividend", "crypto_yield", "interest", "rental"];
    return periodIncome
      .filter((e) => passiveTypes.includes(e.type))
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

  // Investment Assets to Net Worth Ratio
  const investmentAssets = portfolioTotal + cryptoTotal;
  const investmentToNetWorthRatio = netWorth > 0 ? (investmentAssets / netWorth) * 100 : 0;

  // ---- Asset allocation ---------------------------------------------------

  const allocationData = useMemo(() => {
    const slices: { name: string; value: number; color: string }[] = [];
    let ci = 0;
    for (const h of portfolioHoldings) {
      slices.push({ name: h.ticker || h.name, value: convert(h.currentValue, h.currency), color: CHART_COLORS[ci++ % CHART_COLORS.length] });
    }
    for (const h of cryptoHoldings) {
      slices.push({ name: h.token, value: convert(h.currentValueUsd, "USD"), color: CHART_COLORS[ci++ % CHART_COLORS.length] });
    }
    return slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  }, [portfolioHoldings, cryptoHoldings, convert]);

  // ---- Income vs Expenses bar chart ---------------------------------------

  const barData = useMemo(() => {
    return last6Keys.map((key) => {
      let inc = 0, exp = 0;
      for (const e of incomeEntries) { if ((e.date ?? "").slice(0, 7) === key) inc += convert(e.amount, e.currency); }
      for (const e of expenseEntries) { if ((e.date ?? "").slice(0, 7) === key) exp += convert(e.amount, e.currency); }
      return { month: monthKeyToLabel(key), income: inc, expenses: exp, net: inc - exp };
    });
  }, [last6Keys, incomeEntries, expenseEntries, convert]);

  // ---- Portfolio Highlights (top 3 gainers / losers) ----------------------

  const portfolioHighlights = useMemo(() => {
    type Highlight = { name: string; pnl: number; pnlPct: number };
    const items: Highlight[] = [];

    for (const h of portfolioHoldings) {
      const currentConverted = convert(h.currentValue, h.currency);
      const costConverted = convert(h.amountInvested, h.currency);
      const pnl = currentConverted - costConverted;
      const pnlPct = costConverted > 0 ? (pnl / costConverted) * 100 : 0;
      items.push({ name: h.ticker || h.name, pnl, pnlPct });
    }

    for (const h of cryptoHoldings) {
      const currentConverted = convert(h.currentValueUsd, "USD");
      const costConverted = convert(h.totalCostUsd, "USD");
      const pnl = currentConverted - costConverted;
      const pnlPct = costConverted > 0 ? (pnl / costConverted) * 100 : 0;
      items.push({ name: h.token, pnl, pnlPct });
    }

    const sorted = [...items].sort((a, b) => b.pnl - a.pnl);
    const gainers = sorted.filter((i) => i.pnl > 0).slice(0, 3);
    const losers = sorted.filter((i) => i.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 3);

    return { gainers, losers };
  }, [portfolioHoldings, cryptoHoldings, convert]);

  // ---- Upcoming Recurring -------------------------------------------------

  const upcomingRecurring = useMemo(() => {
    type UpcomingItem = {
      description: string;
      amount: number;
      currency: Currency;
      kind: "income" | "expense";
      frequency: string;
      nextDate: string;
    };

    const todayStr = getSydneyDateString();
    const thirtyDaysLater = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();

    const items: UpcomingItem[] = [];

    for (const t of recurringExpenses) {
      if (!t.active) continue;
      const occurrences = computeOccurrences(t.startDate, t.frequency, todayStr, thirtyDaysLater);
      if (occurrences.length > 0) {
        items.push({
          description: t.description,
          amount: t.amount,
          currency: t.currency,
          kind: "expense",
          frequency: FREQUENCY_LABELS[t.frequency],
          nextDate: occurrences[0],
        });
      }
    }

    for (const t of recurringIncomes) {
      if (!t.active) continue;
      const occurrences = computeOccurrences(t.startDate, t.frequency, todayStr, thirtyDaysLater);
      if (occurrences.length > 0) {
        items.push({
          description: t.description,
          amount: t.amount,
          currency: t.currency,
          kind: "income",
          frequency: FREQUENCY_LABELS[t.frequency],
          nextDate: occurrences[0],
        });
      }
    }

    return items.sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 5);
  }, [recurringExpenses, recurringIncomes]);

  // ---- Financial Health Score ---------------------------------------------

  const healthScore = useMemo(() => {
    let score = 0;
    if (savingsRate > 0) score += Math.min(savingsRate, 30); // max 30 pts
    if (debtToAssetRatio < 50) score += Math.max(0, 30 - debtToAssetRatio * 0.6); // max 30 pts
    if (netWorth > 0) score += 20; // 20 pts for positive net worth
    if (periodIncomeTotal > 0 && periodExpenseTotal < periodIncomeTotal) score += 20; // 20 pts for positive cash flow
    return Math.round(Math.min(100, Math.max(0, score)));
  }, [savingsRate, debtToAssetRatio, netWorth, periodIncomeTotal, periodExpenseTotal]);

  const healthLabel = healthScore >= 80 ? "Excellent" : healthScore >= 60 ? "Good" : healthScore >= 40 ? "Fair" : "Needs Work";
  const healthColor = healthScore >= 80 ? "#2e8b57" : healthScore >= 60 ? "#2e8b57" : healthScore >= 40 ? "#2c251e" : "#cd5c5c";

  // ---- Recent activity feed -----------------------------------------------

  const recentActivity = useMemo(() => {
    type ActivityItem = {
      id: string; kind: "income" | "expense"; type: string; label: string;
      description: string; amount: number; currency: string; date: string;
    };
    const items: ActivityItem[] = [];
    for (const e of incomeEntries) {
      items.push({ id: e.id, kind: "income", type: e.type, label: INCOME_TYPE_LABELS[e.type], description: e.description, amount: e.amount, currency: e.currency, date: e.date });
    }
    for (const e of expenseEntries) {
      items.push({ id: e.id, kind: "expense", type: e.type, label: (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type, description: e.description, amount: e.amount, currency: e.currency, date: e.date });
    }
    return items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5);
  }, [incomeEntries, expenseEntries]);

  // ---- ECharts base -------------------------------------------------------

  // Hardcoded hex colors for ECharts (canvas can't use oklch/CSS vars)
  const CC = {
    accent: "#c95f3f",
    income: "#2e8b57",
    expense: "#cd5c5c",
    text: "#968360",
    border: "#c9c3a8",
    fg: "#2c251e",
    tooltipBg: "#f4f3ed",
  };

  // ---- ECharts options ----------------------------------------------------

  // 1. Net Worth Trend (Area)
  const nwTrendOption = {
    backgroundColor: "transparent",
    grid: { top: 12, right: 8, bottom: 28, left: 50, containLabel: false },
    xAxis: {
      type: "category" as const,
      data: nwTrendData.map((d) => d.date),
      boundaryGap: false,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: CC.text, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: CC.text, fontSize: 11, formatter: (v: number) => formatAxisValue(v) },
      splitLine: { lineStyle: { color: CC.border, type: "dashed" as const, opacity: 0.5 } },
    },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: CC.tooltipBg, borderColor: CC.border, borderWidth: 1,
      padding: [8, 12], textStyle: { color: CC.fg, fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);",
      formatter: "{b}: {c}",
    },
    series: [{
      type: "line" as const,
      data: nwTrendData.map((d) => d.value),
      smooth: true, showSymbol: false,
      lineStyle: { color: CC.accent, width: 2 },
      itemStyle: { color: CC.accent },
      areaStyle: {
        color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: CC.accent + "33" },
            { offset: 1, color: CC.accent + "00" },
          ],
        },
      },
    }],
  };

  // 2. Income vs Expenses (Bar - 6 months)
  const incExpBarOption = {
    backgroundColor: "transparent",
    grid: { top: 12, right: 8, bottom: 28, left: 48, containLabel: false },
    xAxis: {
      type: "category" as const, data: barData.map((d) => d.month),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: CC.text, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: CC.text, fontSize: 11, formatter: (v: number) => formatAxisValue(v) },
      splitLine: { lineStyle: { color: CC.border, type: "dashed" as const, opacity: 0.5 } },
    },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: CC.tooltipBg, borderColor: CC.border, borderWidth: 1,
      padding: [8, 12], textStyle: { color: CC.fg, fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);",
    },
    series: [
      { name: "Income", type: "bar" as const, data: barData.map((d) => d.income), itemStyle: { color: CC.income, borderRadius: [6, 6, 0, 0] }, barGap: "15%" },
      { name: "Expenses", type: "bar" as const, data: barData.map((d) => d.expenses), itemStyle: { color: CC.expense, borderRadius: [6, 6, 0, 0] } },
    ],
  };

  // Asset allocation chart moved to InteractiveDonut component

  // ---- Render -------------------------------------------------------------

  const D = 0.05;

  return (
    <div className="space-y-8 pb-12">
      {/* Floating period toggle — bottom right */}
      <div className="fixed bottom-20 md:bottom-6 right-4 lg:right-8 z-40">
        <div className="flex items-center rounded-full bg-card/90 backdrop-blur-md p-0.5 gap-0.5 shadow-lg ring-1 ring-border/40">
          {(["W", "M", "Y"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                period === p
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* 1. NET WORTH HERO */}
      <BlurFade delay={0}>
        <section>
          <p className="label-mono mb-2">Net Worth</p>
          <div className="display-number">
            <NumberTicker value={netWorth} prefix={symbol} decimalPlaces={0} className="display-number" />
          </div>
        </section>
      </BlurFade>

      {/* 2. QUICK ACTIONS */}
      <BlurFade delay={D * 0.3}>
        <div className="flex flex-wrap gap-2">
          <Link href="/income" className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors">
            + Add Income
          </Link>
          <Link href="/expenses" className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors">
            + Add Expense
          </Link>
          <Link href="/portfolio" className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors">
            Update Portfolio
          </Link>
          <Link href="/crypto" className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors">
            Upload CSV
          </Link>
        </div>
      </BlurFade>

      {/* 3. ASSET BREAKDOWN + NET WORTH TREND */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <BlurFade delay={D * 0.5} className="md:col-span-5">
          <div className="relative">
            {/* Settings toggle */}
            <button
              onClick={() => setShowSectionSettings(!showSectionSettings)}
              className="absolute -top-1 right-0 p-1 rounded-md text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>

            {/* Section visibility editor */}
            <AnimatePresence>
              {showSectionSettings && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden mb-3"
                >
                  <div className="rounded-lg bg-secondary/50 p-2.5 space-y-1">
                    <p className="label-mono mb-1.5">Show / Hide</p>
                    {[
                      { key: "portfolio", label: "Portfolio" },
                      { key: "crypto", label: "Crypto" },
                      { key: "owed_to_me", label: "Owed to Me" },
                      { key: "i_owe", label: "I Owe" },
                    ].map((item) => (
                      <button
                        key={item.key}
                        onClick={() => toggleSection(item.key)}
                        className="flex items-center justify-between w-full px-2 py-1 rounded text-xs hover:bg-secondary transition-colors"
                      >
                        <span className={cn(!isVisible(item.key) && "text-muted-foreground/50")}>{item.label}</span>
                        {isVisible(item.key) ? (
                          <Eye className="h-3 w-3 text-income" />
                        ) : (
                          <EyeOff className="h-3 w-3 text-muted-foreground/40" />
                        )}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="divide-y divide-border">
              {[
                { key: "portfolio", label: "Portfolio", value: portfolioTotal, negative: false },
                { key: "crypto", label: "Crypto", value: cryptoTotal, negative: false },
                { key: "owed_to_me", label: "Owed to Me", value: owedToMe, negative: false },
                { key: "i_owe", label: "I Owe", value: -iOwe, negative: true },
              ].filter((row) => isVisible(row.key)).map((row) => (
                <div key={row.key} className="flex items-center justify-between py-3">
                  <span className="label-mono">{row.label}</span>
                  <span className={cn("font-mono text-sm tabular-nums", row.negative ? "text-expense" : "text-foreground")}>
                    {row.negative ? "-" : ""}{format(Math.abs(row.value))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </BlurFade>

        <BlurFade delay={D} className="md:col-span-7">
          <div className="finance-card p-5">
            <p className="label-mono mb-3">Net Worth Trend</p>
            {nwTrendData.length > 1 ? (
              <ReactECharts
                option={nwTrendOption}
                style={{ height: 144, width: "100%" }}
              />
            ) : (
              <div className="flex h-36 items-center justify-center">
                <p className="text-sm text-muted-foreground/50">
                  {nwTrendData.length === 1 ? "Come back tomorrow for trend data" : "Trend will appear as data accumulates"}
                </p>
              </div>
            )}
          </div>
        </BlurFade>
      </div>

      {/* 4. GOAL SECTION */}
      <GoalSection netWorth={netWorth} symbol={symbol} format={format} />

      {/* 5. VITALS + FINANCIAL HEALTH SCORE */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <BlurFade delay={D} className="md:col-span-8">
          <div className="finance-card p-6 h-full flex flex-col justify-center">
            <p className="label-mono mb-4">{PERIOD_LABELS[period]}</p>
            <div className="grid grid-cols-3 divide-x divide-border">
              {/* Income */}
              <div className="pr-5">
                <p className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-income">
                  {format(periodIncomeTotal)}
                </p>
                <p className="label-mono mt-1">Income</p>
                {prevIncomeTotal > 0 && (
                  <div className={cn("flex items-center gap-1 mt-2 text-xs font-medium", incomeChange >= 0 ? "text-income" : "text-expense")}>
                    {incomeChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    <span>{incomeChange >= 0 ? "+" : ""}{incomeChange.toFixed(1)}% vs prev</span>
                  </div>
                )}
              </div>
              {/* Expenses */}
              <div className="px-5">
                <p className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-expense">
                  {format(periodExpenseTotal)}
                </p>
                <p className="label-mono mt-1">Expenses</p>
                {prevExpenseTotal > 0 && (
                  <div className={cn("flex items-center gap-1 mt-2 text-xs font-medium", expenseChange <= 0 ? "text-income" : "text-expense")}>
                    {expenseChange <= 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                    <span>{expenseChange >= 0 ? "+" : ""}{expenseChange.toFixed(1)}% vs prev</span>
                  </div>
                )}
              </div>
              {/* Net */}
              <div className="pl-5">
                <p className={cn("text-2xl md:text-3xl font-semibold tracking-tight tabular-nums", netCashFlow >= 0 ? "text-income" : "text-expense")}>
                  {netCashFlow >= 0 ? "+" : ""}{format(netCashFlow)}
                </p>
                <p className="label-mono mt-1">Net Cash Flow</p>
              </div>
            </div>
          </div>
        </BlurFade>

        {/* Financial Health Score */}
        <BlurFade delay={D * 2} className="md:col-span-4">
          <div className="finance-card p-6 h-full flex flex-col items-center justify-center">
            <p className="label-mono mb-4">Financial Health</p>
            <div className="relative flex items-center justify-center">
              <svg width="96" height="96" viewBox="0 0 96 96">
                <circle cx="48" cy="48" r="40" fill="none" stroke="#c9c3a8" strokeWidth="6" opacity="0.3" />
                <circle
                  cx="48" cy="48" r="40" fill="none"
                  stroke={healthColor} strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${(healthScore / 100) * 251.3} 251.3`}
                  transform="rotate(-90 48 48)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tabular-nums" style={{ color: healthColor }}>{healthScore}</span>
              </div>
            </div>
            <p className="text-sm font-medium mt-2" style={{ color: healthColor }}>{healthLabel}</p>
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <span>Savings {savingsRate.toFixed(0)}%</span>
              <span>Debt {debtToAssetRatio.toFixed(0)}%</span>
            </div>
          </div>
        </BlurFade>
      </div>

      {/* FINANCIAL HEALTH INDICATORS */}
      {isVisible("health-indicators") && (() => {
        // Gauge helper: renders a semi-circle arc gauge
        const Gauge = ({ value, max, thresholds, invert, suffix = "%" }: {
          value: number; max: number;
          thresholds: [number, number]; // [green→yellow, yellow→red]
          invert?: boolean; // true = lower is better
          suffix?: string;
        }) => {
          const pct = Math.min(1, Math.max(0, value / max));
          const angle = pct * 180;
          const r = 36;
          const cx = 44;
          const cy = 42;
          // Determine color
          let color: string;
          if (invert) {
            color = value <= thresholds[0] ? "oklch(0.723 0.219 149.579)" : value <= thresholds[1] ? "#d4a033" : "oklch(0.637 0.237 25.331)";
          } else {
            color = value >= thresholds[1] ? "oklch(0.723 0.219 149.579)" : value >= thresholds[0] ? "#d4a033" : "oklch(0.637 0.237 25.331)";
          }
          // Arc path
          const endAngle = (180 - angle) * (Math.PI / 180);
          const ex = cx + r * Math.cos(endAngle);
          const ey = cy - r * Math.sin(endAngle);
          const largeArc = angle > 180 ? 1 : 0;
          const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
          const fullPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
          return (
            <svg viewBox="0 0 88 50" className="w-full max-w-[88px]">
              <path d={fullPath} fill="none" stroke="currentColor" className="text-border" strokeWidth="6" strokeLinecap="round" />
              <path d={arcPath} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
              <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="14" fontWeight="700" fontFamily="var(--font-geist-mono), monospace">
                {typeof value === "number" && value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value < 10 ? value.toFixed(1) : Math.round(value)}
              </text>
              <text x={cx} y={cy + 8} textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize="8">
                {suffix}
              </text>
            </svg>
          );
        };

        const indicators = [
          { label: "Debt / Assets", value: debtToAssetRatio, max: 100, thresholds: [30, 60] as [number, number], invert: true, suffix: "%", status: debtToAssetRatio <= 30 ? "Healthy" : debtToAssetRatio <= 60 ? "Moderate" : "High" },
          { label: "Debt / Income", value: debtToIncomeRatio, max: 100, thresholds: [35, 50] as [number, number], invert: true, suffix: "%", status: debtToIncomeRatio <= 35 ? "Healthy" : debtToIncomeRatio <= 50 ? "Caution" : "High" },
          { label: "Savings Rate", value: savingsRate, max: 100, thresholds: [10, 20] as [number, number], invert: false, suffix: "%", status: savingsRate >= 20 ? "Excellent" : savingsRate >= 10 ? "Good" : "Low" },
          { label: "Emergency Fund", value: emergencyFundMonths, max: 12, thresholds: [3, 6] as [number, number], invert: false, suffix: "months", status: emergencyFundMonths >= 6 ? "Strong" : emergencyFundMonths >= 3 ? "Adequate" : "Build up" },
          { label: "Wealth / Income", value: wealthToIncomeRatio, max: 12, thresholds: [1, 5] as [number, number], invert: false, suffix: "x annual", status: wealthToIncomeRatio >= 5 ? "Strong" : wealthToIncomeRatio >= 1 ? "Growing" : "Early" },
          { label: "Invest / Net Worth", value: Math.min(investmentToNetWorthRatio, 100), max: 100, thresholds: [40, 70] as [number, number], invert: false, suffix: "%", status: investmentToNetWorthRatio >= 70 ? "Great" : investmentToNetWorthRatio >= 40 ? "Good" : "Grow" },
          { label: "FI Ratio", value: Math.min(fiRatio, 100), max: 100, thresholds: [25, 100] as [number, number], invert: false, suffix: "%", status: fiRatio >= 100 ? "Free!" : fiRatio >= 25 ? "On track" : "Building" },
          { label: "Net Cash Flow", value: Math.max(0, savingsRate), max: 100, thresholds: [0, 15] as [number, number], invert: false, suffix: format(netCashFlow).replace(/[A-Z$\s]/g, "").slice(0, 8), status: netCashFlow >= 0 ? "Surplus" : "Deficit" },
        ];

        return (
          <BlurFade delay={D * 2.5}>
            <div className="finance-card p-5">
              <p className="label-mono mb-5">Financial Health Indicators</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
                {indicators.map((ind) => {
                  const isGood = ind.invert
                    ? ind.value <= ind.thresholds[0]
                    : ind.value >= ind.thresholds[1];
                  const isBad = ind.invert
                    ? ind.value > ind.thresholds[1]
                    : ind.value < ind.thresholds[0];
                  return (
                    <div key={ind.label} className="flex flex-col items-center text-center">
                      <Gauge
                        value={ind.value}
                        max={ind.max}
                        thresholds={ind.thresholds}
                        invert={ind.invert}
                        suffix={ind.suffix}
                      />
                      <p className="text-[10px] font-medium mt-1 leading-tight">{ind.label}</p>
                      <p className={cn(
                        "text-[9px] mt-0.5 font-medium",
                        isGood ? "text-income" : isBad ? "text-expense" : "text-muted-foreground",
                      )}>
                        {ind.status}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </BlurFade>
        );
      })()}

      {/* 6. INCOME VS EXPENSES BAR + ASSET ALLOCATION DONUT */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <BlurFade delay={D * 3} className="md:col-span-7">
          <div className="finance-card p-6">
            <p className="label-mono mb-4">Income vs Expenses (6 months)</p>
            <ReactECharts
              option={incExpBarOption}
              style={{ height: 192, width: "100%" }}
            />
          </div>
        </BlurFade>

        <BlurFade delay={D * 4} className="md:col-span-5">
          <InteractiveDonut
            title="Asset Allocation"
            data={allocationData.map((d) => ({ name: d.name, value: d.value, color: d.color }))}
            format={format}
          />
        </BlurFade>
      </div>

      {/* 7. PORTFOLIO HIGHLIGHTS + UPCOMING RECURRING */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Portfolio Highlights */}
        <BlurFade delay={D * 5} className="md:col-span-6">
          <div className="finance-card p-6">
            <p className="label-mono mb-4">Portfolio Highlights</p>
            {portfolioHighlights.gainers.length === 0 && portfolioHighlights.losers.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-6">No holdings to show</p>
            ) : (
              <div className="space-y-4">
                {portfolioHighlights.gainers.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Gainers</p>
                    <div className="space-y-2">
                      {portfolioHighlights.gainers.map((h) => (
                        <div key={h.name} className="flex items-center justify-between">
                          <span className="text-sm font-medium truncate mr-3">{h.name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono tabular-nums text-sm text-income">
                              +{format(h.pnl)}
                            </span>
                            <span className="font-mono tabular-nums text-xs text-income">
                              +{h.pnlPct.toFixed(1)}%
                            </span>
                            <ArrowUpRight className="h-3.5 w-3.5 text-income" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {portfolioHighlights.losers.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Losers</p>
                    <div className="space-y-2">
                      {portfolioHighlights.losers.map((h) => (
                        <div key={h.name} className="flex items-center justify-between">
                          <span className="text-sm font-medium truncate mr-3">{h.name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono tabular-nums text-sm text-expense">
                              {format(h.pnl)}
                            </span>
                            <span className="font-mono tabular-nums text-xs text-expense">
                              {h.pnlPct.toFixed(1)}%
                            </span>
                            <ArrowDownRight className="h-3.5 w-3.5 text-expense" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </BlurFade>

        {/* Upcoming Recurring */}
        <BlurFade delay={D * 6} className="md:col-span-6">
          <div className="finance-card p-6">
            <p className="label-mono mb-4">Upcoming</p>
            {upcomingRecurring.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-6">No recurring transactions set up</p>
            ) : (
              <div className="space-y-3">
                {upcomingRecurring.map((item, idx) => {
                  const shortDate = (() => {
                    const [, m, d] = item.nextDate.split("-").map(Number);
                    const dt = new Date(2000, m - 1, d);
                    return dt.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
                  })();
                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums w-14 shrink-0">{shortDate}</span>
                      <span className="text-sm truncate flex-1">{item.description}</span>
                      <span className={cn("font-mono tabular-nums text-sm shrink-0", item.kind === "income" ? "text-income" : "text-expense")}>
                        {item.kind === "income" ? "+" : "-"}{format(item.amount, item.currency)}
                      </span>
                      <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full shrink-0">{item.frequency}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </BlurFade>
      </div>

      {/* 8. RECENT ACTIVITY */}
      <BlurFade delay={D * 7} className="md:col-span-12">
        <div className="max-w-3xl">
          <p className="label-mono mb-4">Recent Activity</p>
          {recentActivity.length > 0 ? (
            <div className="divide-y divide-border">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-3">
                  <span className={cn("inline-flex items-center justify-center h-8 w-8 rounded-full shrink-0", item.kind === "income" ? "bg-income/10 text-income" : "bg-expense/10 text-expense")}>
                    {item.kind === "income" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.description || item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn("text-sm font-mono tabular-nums font-medium", item.kind === "income" ? "text-income" : "text-expense")}>
                      {item.kind === "income" ? "+" : "-"}{format(item.amount, item.currency as Currency)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">{formatDateString(item.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/50 py-6">No transactions recorded yet</p>
          )}
        </div>
      </BlurFade>
    </div>
  );
}
