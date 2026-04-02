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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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

function getPreviousPeriodRange(period: Period): {
  start: string;
  end: string;
} {
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

const PERIOD_LABELS: Record<Period, string> = {
  W: "This Week",
  M: "This Month",
  Y: "This Year",
};

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
  const [incomeEntries] = useLocalStorage<IncomeEntry[]>("income_entries", []);
  const [expenseEntries] = useLocalStorage<ExpenseEntry[]>(
    "expense_entries",
    [],
  );
  const [cryptoCsvText] = useLocalStorage<string>("crypto_csv_text", "");
  const [portfolioHoldings] = useLocalStorage<PortfolioHolding[]>(
    "portfolio_holdings",
    [],
  );
  const [debtRecords] = useLocalStorage<DebtRecord[]>("debt_records", []);
  const [debtTransactions] = useLocalStorage<DebtTransaction[]>(
    "debt_transactions",
    [],
  );
  const [recurringExpenses] = useLocalStorage<RecurringExpense[]>(
    "recurring_expense_templates",
    [],
  );
  const [recurringIncomes] = useLocalStorage<RecurringIncome[]>(
    "recurring_income_templates",
    [],
  );

  const [nwSnapshots, setNwSnapshots] = useLocalStorage<
    { date: string; value: number }[]
  >("networth_snapshots", []);

  const { convert, format, symbol } = useCurrency();
  const [period, setPeriod] = useState<Period>("M");

  // Dashboard section visibility (persisted)
  const [hiddenSections, setHiddenSections] = useLocalStorage<string[]>(
    "dashboard_hidden_sections",
    [],
  );
  const [emergencyFundTarget, setEmergencyFundTarget] = useLocalStorage<number>(
    "emergency_fund_target_months",
    6,
  );
  const [showSectionSettings, setShowSectionSettings] = useState(false);
  const toggleSection = (key: string) => {
    setHiddenSections((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
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
    () =>
      portfolioHoldings.reduce(
        (s, h) => s + convert(h.currentValue, h.currency),
        0,
      ),
    [portfolioHoldings, convert],
  );

  // Crypto total
  const cryptoTotal = useMemo(
    () => convert(getTotalCryptoValueUsd(cryptoHoldings), "USD"),
    [cryptoHoldings, convert],
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
    setNwSnapshots((prev) => [
      ...prev.slice(-89),
      { date: today, value: netWorth },
    ]);
  }, [netWorth, nwSnapshots, setNwSnapshots]);

  const nwTrendData = useMemo(() => {
    return nwSnapshots.map((s) => ({ date: s.date.slice(5), value: s.value }));
  }, [nwSnapshots]);

  // ---- Period-filtered income/expenses ------------------------------------

  const periodIncome = useMemo(
    () => incomeEntries.filter((e) => isInPeriod(e.date ?? "", period)),
    [incomeEntries, period],
  );
  const periodExpenses = useMemo(
    () => expenseEntries.filter((e) => isInPeriod(e.date ?? "", period)),
    [expenseEntries, period],
  );
  const prevPeriodIncome = useMemo(
    () => incomeEntries.filter((e) => isInPrevPeriod(e.date ?? "", period)),
    [incomeEntries, period],
  );
  const prevPeriodExpenses = useMemo(
    () => expenseEntries.filter((e) => isInPrevPeriod(e.date ?? "", period)),
    [expenseEntries, period],
  );

  const periodIncomeTotal = useMemo(
    () => sumConverted(periodIncome, convert),
    [periodIncome, convert],
  );
  const periodExpenseTotal = useMemo(
    () => sumConverted(periodExpenses, convert),
    [periodExpenses, convert],
  );
  const prevIncomeTotal = useMemo(
    () => sumConverted(prevPeriodIncome, convert),
    [prevPeriodIncome, convert],
  );
  const prevExpenseTotal = useMemo(
    () => sumConverted(prevPeriodExpenses, convert),
    [prevPeriodExpenses, convert],
  );

  const netCashFlow = periodIncomeTotal - periodExpenseTotal;
  const savingsRate =
    periodIncomeTotal > 0
      ? ((periodIncomeTotal - periodExpenseTotal) / periodIncomeTotal) * 100
      : 0;
  const debtToAssetRatio = totalAssets > 0 ? (iOwe / totalAssets) * 100 : 0;

  // Change vs previous period
  const incomeChange =
    prevIncomeTotal > 0
      ? ((periodIncomeTotal - prevIncomeTotal) / prevIncomeTotal) * 100
      : 0;
  const expenseChange =
    prevExpenseTotal > 0
      ? ((periodExpenseTotal - prevExpenseTotal) / prevExpenseTotal) * 100
      : 0;

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
  const debtToIncomeRatio =
    monthlyIncome > 0 ? (iOwe / annualizedIncome) * 100 : 0;

  // Emergency Fund Ratio: liquid assets / monthly expenses
  // Liquid = cash in portfolio (type "bond" or "other") + crypto stablecoins
  const liquidAssets = useMemo(() => {
    const cashLikePortfolio = portfolioHoldings
      .filter((h) => h.type === "bond" || h.type === "other")
      .reduce((s, h) => s + convert(h.currentValue, h.currency), 0);
    // Include crypto stablecoins
    const stablecoinValue = cryptoHoldings
      .filter((h) =>
        [
          "USDC",
          "USDT",
          "DAI",
          "BUSD",
          "FDUSD",
          "PYUSD",
          "TUSD",
          "USD1",
        ].includes(h.token.toUpperCase()),
      )
      .reduce((s, h) => s + convert(h.currentValueUsd, "USD"), 0);
    return cashLikePortfolio + stablecoinValue;
  }, [portfolioHoldings, cryptoHoldings, convert]);

  const emergencyFundMonths =
    monthlyExpenses > 0 ? liquidAssets / monthlyExpenses : 0;

  // Wealth-to-Income Ratio: net worth / annual income
  const wealthToIncomeRatio =
    annualizedIncome > 0 ? netWorth / annualizedIncome : 0;

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

  const fiRatio =
    annualizedExpenses > 0 ? (passiveAnnualized / annualizedExpenses) * 100 : 0;

  // Investment Assets to Net Worth Ratio
  const investmentAssets = portfolioTotal + cryptoTotal;
  const investmentToNetWorthRatio =
    netWorth > 0 ? (investmentAssets / netWorth) * 100 : 0;

  // ---- Asset allocation ---------------------------------------------------

  const allocationData = useMemo(() => {
    const slices: { name: string; value: number; color: string }[] = [];
    let ci = 0;
    for (const h of portfolioHoldings) {
      slices.push({
        name: h.ticker || h.name,
        value: convert(h.currentValue, h.currency),
        color: CHART_COLORS[ci++ % CHART_COLORS.length],
      });
    }
    for (const h of cryptoHoldings) {
      slices.push({
        name: h.token,
        value: convert(h.currentValueUsd, "USD"),
        color: CHART_COLORS[ci++ % CHART_COLORS.length],
      });
    }
    return slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  }, [portfolioHoldings, cryptoHoldings, convert]);

  // ---- Income vs Expenses bar chart ---------------------------------------

  const barData = useMemo(() => {
    return last6Keys.map((key) => {
      let inc = 0,
        exp = 0;
      for (const e of incomeEntries) {
        if ((e.date ?? "").slice(0, 7) === key)
          inc += convert(e.amount, e.currency);
      }
      for (const e of expenseEntries) {
        if ((e.date ?? "").slice(0, 7) === key)
          exp += convert(e.amount, e.currency);
      }
      return {
        month: monthKeyToLabel(key),
        income: inc,
        expenses: exp,
        net: inc - exp,
      };
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
    const losers = sorted
      .filter((i) => i.pnl < 0)
      .sort((a, b) => a.pnl - b.pnl)
      .slice(0, 3);

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
      const occurrences = computeOccurrences(
        t.startDate,
        t.frequency,
        todayStr,
        thirtyDaysLater,
      );
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
      const occurrences = computeOccurrences(
        t.startDate,
        t.frequency,
        todayStr,
        thirtyDaysLater,
      );
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

    return items
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
      .slice(0, 5);
  }, [recurringExpenses, recurringIncomes]);

  // ---- Financial Health Score ---------------------------------------------

  const healthScore = useMemo(() => {
    let score = 0;
    if (savingsRate > 0) score += Math.min(savingsRate, 30); // max 30 pts
    if (debtToAssetRatio < 50)
      score += Math.max(0, 30 - debtToAssetRatio * 0.6); // max 30 pts
    if (netWorth > 0) score += 20; // 20 pts for positive net worth
    if (periodIncomeTotal > 0 && periodExpenseTotal < periodIncomeTotal)
      score += 20; // 20 pts for positive cash flow
    return Math.round(Math.min(100, Math.max(0, score)));
  }, [
    savingsRate,
    debtToAssetRatio,
    netWorth,
    periodIncomeTotal,
    periodExpenseTotal,
  ]);

  const healthLabel =
    healthScore >= 80
      ? "Excellent"
      : healthScore >= 60
        ? "Good"
        : healthScore >= 40
          ? "Fair"
          : "Needs Work";
  const healthColor =
    healthScore >= 80
      ? "#2e8b57"
      : healthScore >= 60
        ? "#2e8b57"
        : healthScore >= 40
          ? "#2c251e"
          : "#cd5c5c";

  // ---- Recent activity feed -----------------------------------------------

  const recentActivity = useMemo(() => {
    type ActivityItem = {
      id: string;
      kind: "income" | "expense";
      type: string;
      label: string;
      description: string;
      amount: number;
      currency: string;
      date: string;
    };
    const items: ActivityItem[] = [];
    for (const e of incomeEntries) {
      items.push({
        id: e.id,
        kind: "income",
        type: e.type,
        label: (INCOME_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type,
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        date: e.date,
      });
    }
    for (const e of expenseEntries) {
      items.push({
        id: e.id,
        kind: "expense",
        type: e.type,
        label:
          (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type,
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        date: e.date,
      });
    }
    return items
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, 5);
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
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: CC.text, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: CC.text,
        fontSize: 11,
        formatter: (v: number) => formatAxisValue(v),
      },
      splitLine: {
        lineStyle: { color: CC.border, type: "dashed" as const, opacity: 0.5 },
      },
    },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: CC.tooltipBg,
      borderColor: CC.border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: CC.fg, fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);",
      formatter: "{b}: {c}",
    },
    series: [
      {
        type: "line" as const,
        data: nwTrendData.map((d) => d.value),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: CC.accent, width: 2 },
        itemStyle: { color: CC.accent },
        areaStyle: {
          color: {
            type: "linear" as const,
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: CC.accent + "33" },
              { offset: 1, color: CC.accent + "00" },
            ],
          },
        },
      },
    ],
  };

  // 2. Income vs Expenses (Bar - 6 months)
  const incExpBarOption = {
    backgroundColor: "transparent",
    grid: { top: 12, right: 8, bottom: 28, left: 48, containLabel: false },
    xAxis: {
      type: "category" as const,
      data: barData.map((d) => d.month),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: CC.text, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: CC.text,
        fontSize: 11,
        formatter: (v: number) => formatAxisValue(v),
      },
      splitLine: {
        lineStyle: { color: CC.border, type: "dashed" as const, opacity: 0.5 },
      },
    },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: CC.tooltipBg,
      borderColor: CC.border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: CC.fg, fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);",
    },
    series: [
      {
        name: "Income",
        type: "bar" as const,
        data: barData.map((d) => d.income),
        itemStyle: { color: CC.income, borderRadius: [6, 6, 0, 0] },
        barGap: "15%",
      },
      {
        name: "Expenses",
        type: "bar" as const,
        data: barData.map((d) => d.expenses),
        itemStyle: { color: CC.expense, borderRadius: [6, 6, 0, 0] },
      },
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
                  : "text-muted-foreground hover:text-foreground",
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
            <NumberTicker
              value={netWorth}
              prefix={symbol}
              decimalPlaces={0}
              className="display-number"
            />
          </div>
        </section>
      </BlurFade>

      {/* 2. QUICK ACTIONS */}
      <BlurFade delay={D * 0.3}>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/income"
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
          >
            + Add Income
          </Link>
          <Link
            href="/expenses"
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
          >
            + Add Expense
          </Link>
          <Link
            href="/portfolio"
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
          >
            Update Portfolio
          </Link>
          <Link
            href="/crypto"
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
          >
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
                        <span
                          className={cn(
                            !isVisible(item.key) && "text-muted-foreground/50",
                          )}
                        >
                          {item.label}
                        </span>
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
                {
                  key: "portfolio",
                  label: "Portfolio",
                  value: portfolioTotal,
                  negative: false,
                },
                {
                  key: "crypto",
                  label: "Crypto",
                  value: cryptoTotal,
                  negative: false,
                },
                {
                  key: "owed_to_me",
                  label: "Owed to Me",
                  value: owedToMe,
                  negative: false,
                },
                { key: "i_owe", label: "I Owe", value: -iOwe, negative: true },
              ]
                .filter((row) => isVisible(row.key))
                .map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center justify-between py-3"
                  >
                    <span className="label-mono">{row.label}</span>
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        row.negative ? "text-expense" : "text-foreground",
                      )}
                    >
                      {row.negative ? "-" : ""}
                      {format(Math.abs(row.value))}
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
                  {nwTrendData.length === 1
                    ? "Come back tomorrow for trend data"
                    : "Trend will appear as data accumulates"}
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
                  <div
                    className={cn(
                      "flex items-center gap-1 mt-2 text-xs font-medium",
                      incomeChange >= 0 ? "text-income" : "text-expense",
                    )}
                  >
                    {incomeChange >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    <span>
                      {incomeChange >= 0 ? "+" : ""}
                      {incomeChange.toFixed(1)}% vs prev
                    </span>
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
                  <div
                    className={cn(
                      "flex items-center gap-1 mt-2 text-xs font-medium",
                      expenseChange <= 0 ? "text-income" : "text-expense",
                    )}
                  >
                    {expenseChange <= 0 ? (
                      <TrendingDown className="h-3 w-3" />
                    ) : (
                      <TrendingUp className="h-3 w-3" />
                    )}
                    <span>
                      {expenseChange >= 0 ? "+" : ""}
                      {expenseChange.toFixed(1)}% vs prev
                    </span>
                  </div>
                )}
              </div>
              {/* Net */}
              <div className="pl-5">
                <p
                  className={cn(
                    "text-2xl md:text-3xl font-semibold tracking-tight tabular-nums",
                    netCashFlow >= 0 ? "text-income" : "text-expense",
                  )}
                >
                  {netCashFlow >= 0 ? "+" : ""}
                  {format(netCashFlow)}
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
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  fill="none"
                  stroke="#c9c3a8"
                  strokeWidth="6"
                  opacity="0.3"
                />
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  fill="none"
                  stroke={healthColor}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${(healthScore / 100) * 251.3} 251.3`}
                  transform="rotate(-90 48 48)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="text-2xl font-bold tabular-nums"
                  style={{ color: healthColor }}
                >
                  {healthScore}
                </span>
              </div>
            </div>
            <p
              className="text-sm font-medium mt-2"
              style={{ color: healthColor }}
            >
              {healthLabel}
            </p>
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <span>Savings {savingsRate.toFixed(0)}%</span>
              <span>Debt {debtToAssetRatio.toFixed(0)}%</span>
            </div>
          </div>
        </BlurFade>
      </div>

      {/* FINANCIAL HEALTH INDICATORS */}
      {isVisible("health-indicators") &&
        (() => {
          // Gauge helper: renders a semi-circle arc gauge
          const Gauge = ({
            value,
            max,
            thresholds,
            invert,
            suffix = "%",
          }: {
            value: number;
            max: number;
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
              color =
                value <= thresholds[0]
                  ? "oklch(0.723 0.219 149.579)"
                  : value <= thresholds[1]
                    ? "#d4a033"
                    : "oklch(0.637 0.237 25.331)";
            } else {
              color =
                value >= thresholds[1]
                  ? "oklch(0.723 0.219 149.579)"
                  : value >= thresholds[0]
                    ? "#d4a033"
                    : "oklch(0.637 0.237 25.331)";
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
                <path
                  d={fullPath}
                  fill="none"
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <path
                  d={arcPath}
                  fill="none"
                  stroke={color}
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <text
                  x={cx}
                  y={cy - 4}
                  textAnchor="middle"
                  fill={color}
                  fontSize="14"
                  fontWeight="700"
                  fontFamily="var(--font-geist-mono), monospace"
                >
                  {typeof value === "number" && value >= 1000
                    ? `${(value / 1000).toFixed(1)}k`
                    : value < 10
                      ? value.toFixed(1)
                      : Math.round(value)}
                </text>
                <text
                  x={cx}
                  y={cy + 8}
                  textAnchor="middle"
                  fill="currentColor"
                  className="text-muted-foreground"
                  fontSize="8"
                >
                  {suffix}
                </text>
              </svg>
            );
          };

          const [selectedIndicator, setSelectedIndicator] = useState<string | null>(null);

          const indicators = [
            { label: "Debt / Assets", value: debtToAssetRatio, max: 100, thresholds: [30, 60] as [number, number], invert: true, suffix: "%",
              status: debtToAssetRatio <= 30 ? "Healthy" : debtToAssetRatio <= 60 ? "Moderate" : "High",
              formula: "Total Liabilities ÷ Total Assets",
              detail: `${format(iOwe)} ÷ ${format(totalAssets)}`,
              desc: "Measures how much of your assets are financed by debt. Lower is better — means you truly own more of what you have.",
              tip: debtToAssetRatio <= 30 ? "You're in great shape. Keep debt low as you grow assets." : debtToAssetRatio <= 60 ? "Consider paying down debt before taking on more." : "Focus on debt reduction — pay off highest-interest debt first.",
            },
            { label: "Debt / Income", value: debtToIncomeRatio, max: 100, thresholds: [35, 50] as [number, number], invert: true, suffix: "%",
              status: debtToIncomeRatio <= 35 ? "Healthy" : debtToIncomeRatio <= 50 ? "Caution" : "High",
              formula: "Total Debt ÷ Annual Income",
              detail: `${format(iOwe)} ÷ ${format(annualizedIncome)}`,
              desc: "Shows your total debt burden relative to what you earn. Banks use this to assess lending risk — under 35% is ideal.",
              tip: debtToIncomeRatio <= 35 ? "Lenders see you as low risk. Good position for future borrowing if needed." : "Avoid new debt until this ratio drops. Focus on increasing income or paying down principal.",
            },
            { label: "Savings Rate", value: savingsRate, max: 100, thresholds: [10, 20] as [number, number], invert: false, suffix: "%",
              status: savingsRate >= 20 ? "Excellent" : savingsRate >= 10 ? "Good" : "Low",
              formula: "(Income − Expenses) ÷ Income",
              detail: `(${format(periodIncomeTotal)} − ${format(periodExpenseTotal)}) ÷ ${format(periodIncomeTotal)}`,
              desc: "The percentage of income you keep. The single most important habit for building wealth. 20%+ puts you ahead of most people.",
              tip: savingsRate >= 20 ? "Outstanding! Consider directing extra savings into investments." : savingsRate >= 10 ? "Good start. Try automating an extra 5% into savings." : "Track your top 3 expense categories and find one to cut by 10%.",
            },
            { label: "Emergency Fund", value: emergencyFundMonths, max: 12, thresholds: [3, 6] as [number, number], invert: false, suffix: "months",
              status: emergencyFundMonths >= 6 ? "Strong" : emergencyFundMonths >= 3 ? "Adequate" : "Build up",
              formula: "Liquid Assets ÷ Monthly Expenses",
              detail: `${format(liquidAssets)} ÷ ${format(monthlyExpenses)}/mo`,
              desc: "How many months you could survive without income. Includes cash, bonds, and stablecoins. 3-6 months is the standard target.",
              tip: emergencyFundMonths >= 6 ? "Well protected! Anything above 6 months could be invested for growth." : emergencyFundMonths >= 3 ? "You have a basic safety net. Build to 6 months for full protection." : "This is your #1 priority. Set up auto-transfers to build this up.",
            },
            { label: "Wealth / Income", value: wealthToIncomeRatio, max: 12, thresholds: [1, 5] as [number, number], invert: false, suffix: "x annual",
              status: wealthToIncomeRatio >= 5 ? "Strong" : wealthToIncomeRatio >= 1 ? "Growing" : "Early",
              formula: "Net Worth ÷ Annual Income",
              detail: `${format(netWorth)} ÷ ${format(annualizedIncome)}`,
              desc: "How many years of income you've accumulated. A rule of thumb: aim for 1x by 30, 3x by 40, 6x by 50, 10-12x by retirement.",
              tip: wealthToIncomeRatio >= 5 ? "You're building real wealth. Stay the course." : wealthToIncomeRatio >= 1 ? "Good progress! Focus on increasing both savings rate and investment returns." : "You're in the accumulation phase. Every dollar saved now has the most compounding time.",
            },
            { label: "Invest / Net Worth", value: Math.min(investmentToNetWorthRatio, 100), max: 100, thresholds: [40, 70] as [number, number], invert: false, suffix: "%",
              status: investmentToNetWorthRatio >= 70 ? "Great" : investmentToNetWorthRatio >= 40 ? "Good" : "Grow",
              formula: "Investment Assets ÷ Net Worth",
              detail: `${format(investmentAssets)} ÷ ${format(netWorth)}`,
              desc: "What portion of your wealth is actively invested (portfolio + crypto). Higher means more of your money is working for you, generating returns.",
              tip: investmentToNetWorthRatio >= 70 ? "Your money is working hard. Ensure you're diversified across asset classes." : "Consider moving idle cash into diversified investments for long-term growth.",
            },
            { label: "FI Ratio", value: Math.min(fiRatio, 100), max: 100, thresholds: [25, 100] as [number, number], invert: false, suffix: "%",
              status: fiRatio >= 100 ? "Free!" : fiRatio >= 25 ? "On track" : "Building",
              formula: "Passive Income ÷ Total Expenses",
              detail: `${format(passiveAnnualized)}/yr ÷ ${format(annualizedExpenses)}/yr`,
              desc: "The holy grail — when passive income (dividends, interest, rental, crypto yield) covers 100% of expenses, you're financially independent.",
              tip: fiRatio >= 100 ? "Congratulations! You could live entirely on passive income." : fiRatio >= 25 ? "Great progress toward FI. Keep growing passive income sources." : "Focus on building dividend stocks, rental income, or yield-generating assets.",
            },
            { label: "Net Cash Flow", value: Math.max(0, savingsRate), max: 100, thresholds: [0, 15] as [number, number], invert: false,
              suffix: format(netCashFlow).replace(/[A-Z$\s]/g, "").slice(0, 8),
              status: netCashFlow >= 0 ? "Surplus" : "Deficit",
              formula: "Income − Expenses",
              detail: `${format(periodIncomeTotal)} − ${format(periodExpenseTotal)}`,
              desc: "Simple: are you earning more than you spend? A positive cash flow is the foundation of all wealth building.",
              tip: netCashFlow >= 0 ? "You're cash-flow positive. Direct the surplus to savings and investments." : "You're spending more than you earn. Review expenses immediately and find cuts.",
            },
          ];

          const selected = indicators.find((i) => i.label === selectedIndicator);

          return (
            <BlurFade delay={D * 2.5}>
              <div className="finance-card p-5">
                <p className="label-mono mb-5">Financial Health Indicators</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {indicators.map((ind) => {
                    const isGood = ind.invert ? ind.value <= ind.thresholds[0] : ind.value >= ind.thresholds[1];
                    const isBad = ind.invert ? ind.value > ind.thresholds[1] : ind.value < ind.thresholds[0];
                    return (
                      <button
                        key={ind.label}
                        onClick={() => setSelectedIndicator(ind.label)}
                        className="flex flex-col items-center text-center rounded-lg p-2 -m-2 transition-all hover:bg-secondary/50 cursor-pointer group"
                      >
                        <Gauge
                          value={ind.value}
                          max={ind.max}
                          thresholds={ind.thresholds}
                          invert={ind.invert}
                          suffix={ind.suffix}
                        />
                        <p className="text-[10px] font-medium mt-1 leading-tight">
                          {ind.label}
                        </p>
                        <p className={cn(
                          "text-[9px] mt-0.5 font-medium",
                          isGood ? "text-income" : isBad ? "text-expense" : "text-muted-foreground",
                        )}>
                          {ind.status}
                        </p>
                        <p className="text-[8px] text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors mt-0.5">
                          tap for details
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Indicator Detail Modal */}
                <Dialog open={selectedIndicator !== null} onOpenChange={(open) => { if (!open) setSelectedIndicator(null); }}>
                  <DialogContent className="sm:max-w-sm">
                    {selected && (() => {
                      const isGood = selected.invert ? selected.value <= selected.thresholds[0] : selected.value >= selected.thresholds[1];
                      const isBad = selected.invert ? selected.value > selected.thresholds[1] : selected.value < selected.thresholds[0];
                      const color = isGood ? "oklch(0.723 0.219 149.579)" : isBad ? "oklch(0.637 0.237 25.331)" : "#d4a033";
                      return (
                        <>
                          <DialogHeader>
                            <DialogTitle>{selected.label}</DialogTitle>
                            <DialogDescription>{selected.desc}</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            {/* Large gauge */}
                            <div className="flex justify-center">
                              <svg viewBox="0 0 120 70" className="w-32">
                                {(() => {
                                  const pct = Math.min(1, Math.max(0, selected.value / selected.max));
                                  const angle = pct * 180;
                                  const r = 48;
                                  const cx = 60;
                                  const cy = 56;
                                  const endAngle = (180 - angle) * (Math.PI / 180);
                                  const ex = cx + r * Math.cos(endAngle);
                                  const ey = cy - r * Math.sin(endAngle);
                                  const largeArc = angle > 180 ? 1 : 0;
                                  return (
                                    <>
                                      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="currentColor" className="text-border" strokeWidth="8" strokeLinecap="round" />
                                      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
                                      <text x={cx} y={cy - 10} textAnchor="middle" fill={color} fontSize="22" fontWeight="700" fontFamily="var(--font-geist-mono), monospace">
                                        {selected.value < 10 ? selected.value.toFixed(1) : Math.round(selected.value)}
                                      </text>
                                      <text x={cx} y={cy + 4} textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize="10">{selected.suffix}</text>
                                    </>
                                  );
                                })()}
                              </svg>
                            </div>

                            {/* Status */}
                            <div className="text-center">
                              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                                isGood ? "bg-income/10 text-income" : isBad ? "bg-expense/10 text-expense" : "bg-secondary text-secondary-foreground",
                              )}>
                                {selected.status}
                              </span>
                            </div>

                            {/* Formula + Calculation */}
                            <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Formula</p>
                              <p className="text-sm font-mono">{selected.formula}</p>
                              <p className="text-xs text-muted-foreground font-mono">{selected.detail}</p>
                            </div>

                            {/* Zone bar */}
                            <div className="space-y-1">
                              <div className="flex h-2 rounded-full overflow-hidden">
                                <div className={cn("transition-all", selected.invert ? "bg-income/60" : "bg-expense/60")} style={{ width: `${(selected.thresholds[0] / selected.max) * 100}%` }} />
                                <div className="bg-[#d4a033]/50 flex-1" style={{ width: `${((selected.thresholds[1] - selected.thresholds[0]) / selected.max) * 100}%` }} />
                                <div className={cn("transition-all flex-1", selected.invert ? "bg-expense/60" : "bg-income/60")} />
                              </div>
                              <div className="flex justify-between text-[9px] text-muted-foreground/50">
                                <span>0</span>
                                <span>{selected.thresholds[0]}</span>
                                <span>{selected.thresholds[1]}</span>
                                <span>{selected.max}</span>
                              </div>
                            </div>

                            {/* Recommendation */}
                            <div className="rounded-lg border border-border/50 p-3">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">Recommendation</p>
                              <p className="text-xs text-muted-foreground leading-relaxed">{selected.tip}</p>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </DialogContent>
                </Dialog>
              </div>
            </BlurFade>
          );
        })()}

      {/* EMERGENCY FUND SECTION — REMOVED, info available via Emergency Fund gauge indicator */}
      {false &&
        (() => {
          const recommendedAmount = monthlyExpenses * emergencyFundTarget;
          const currentAmount = liquidAssets;
          const progressPct =
            recommendedAmount > 0
              ? Math.min(100, (currentAmount / recommendedAmount) * 100)
              : 0;
          const shortfall = Math.max(0, recommendedAmount - currentAmount);
          const isOnTrack = currentAmount >= recommendedAmount;
          const [editingTarget, setEditingTarget] = useState(false);

          return (
            <BlurFade delay={D * 2.7}>
              <div className="finance-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="label-mono">Emergency Fund</p>
                  <div className="flex items-center gap-2">
                    {editingTarget ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          Target:
                        </span>
                        {[3, 6, 9, 12].map((m) => (
                          <button
                            key={m}
                            onClick={() => {
                              setEmergencyFundTarget(m);
                              setEditingTarget(false);
                            }}
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                              emergencyFundTarget === m
                                ? "bg-foreground text-background"
                                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                            )}
                          >
                            {m}mo
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingTarget(true)}
                        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Target: {emergencyFundTarget} months
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center">
                  {/* Progress section */}
                  <div className="space-y-3">
                    {/* Progress bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="tabular-nums font-medium">
                          {format(currentAmount)}
                          <span className="text-muted-foreground font-normal ml-1">
                            of {format(recommendedAmount)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "text-xs font-semibold tabular-nums",
                            isOnTrack
                              ? "text-income"
                              : progressPct >= 50
                                ? "text-foreground"
                                : "text-expense",
                          )}
                        >
                          {progressPct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                        {/* Zone markers */}
                        <div className="relative h-full">
                          <div
                            className={cn(
                              "absolute inset-y-0 left-0 rounded-full transition-all duration-700",
                              isOnTrack
                                ? "bg-income"
                                : progressPct >= 50
                                  ? "bg-[#d4a033]"
                                  : "bg-expense",
                            )}
                            style={{ width: `${progressPct}%` }}
                          />
                          {/* 3-month marker */}
                          {emergencyFundTarget > 3 && (
                            <div
                              className="absolute inset-y-0 w-px bg-foreground/20"
                              style={{
                                left: `${(3 / emergencyFundTarget) * 100}%`,
                              }}
                            />
                          )}
                          {/* 6-month marker */}
                          {emergencyFundTarget > 6 && (
                            <div
                              className="absolute inset-y-0 w-px bg-foreground/20"
                              style={{
                                left: `${(6 / emergencyFundTarget) * 100}%`,
                              }}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-muted-foreground/50">
                        <span>0</span>
                        {emergencyFundTarget > 3 && (
                          <span
                            style={{
                              position: "relative",
                              left: `${(3 / emergencyFundTarget) * 100 - 50}%`,
                            }}
                          >
                            3mo
                          </span>
                        )}
                        {emergencyFundTarget > 6 && (
                          <span
                            style={{
                              position: "relative",
                              left: `${(6 / emergencyFundTarget) * 100 - 50}%`,
                            }}
                          >
                            6mo
                          </span>
                        )}
                        <span>{emergencyFundTarget}mo</span>
                      </div>
                    </div>

                    {/* Details row */}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                      <div>
                        <span className="text-muted-foreground">
                          Avg Monthly Expenses:{" "}
                        </span>
                        <span className="tabular-nums font-medium">
                          {format(monthlyExpenses)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Liquid Assets:{" "}
                        </span>
                        <span className="tabular-nums font-medium">
                          {format(currentAmount)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Coverage:{" "}
                        </span>
                        <span className="tabular-nums font-medium">
                          {emergencyFundMonths.toFixed(1)} months
                        </span>
                      </div>
                      {shortfall > 0 && (
                        <div>
                          <span className="text-muted-foreground">
                            Shortfall:{" "}
                          </span>
                          <span className="tabular-nums font-medium text-expense">
                            {format(shortfall)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Radial gauge */}
                  <div className="flex flex-col items-center shrink-0">
                    <svg viewBox="0 0 80 80" className="w-20 h-20">
                      <circle
                        cx="40"
                        cy="40"
                        r="32"
                        fill="none"
                        stroke="currentColor"
                        className="text-border"
                        strokeWidth="5"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="32"
                        fill="none"
                        stroke={
                          isOnTrack
                            ? "oklch(0.723 0.219 149.579)"
                            : progressPct >= 50
                              ? "#d4a033"
                              : "oklch(0.637 0.237 25.331)"
                        }
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeDasharray={`${(Math.min(progressPct, 100) / 100) * 201} 201`}
                        transform="rotate(-90 40 40)"
                      />
                      <text
                        x="40"
                        y="37"
                        textAnchor="middle"
                        fontSize="14"
                        fontWeight="700"
                        fontFamily="var(--font-geist-mono), monospace"
                        fill={
                          isOnTrack
                            ? "oklch(0.723 0.219 149.579)"
                            : progressPct >= 50
                              ? "#d4a033"
                              : "oklch(0.637 0.237 25.331)"
                        }
                      >
                        {emergencyFundMonths.toFixed(1)}
                      </text>
                      <text
                        x="40"
                        y="50"
                        textAnchor="middle"
                        fontSize="8"
                        fill="currentColor"
                        className="text-muted-foreground"
                      >
                        months
                      </text>
                    </svg>
                    <p
                      className={cn(
                        "text-[10px] font-medium mt-1",
                        isOnTrack ? "text-income" : "text-expense",
                      )}
                    >
                      {isOnTrack
                        ? "Fully funded"
                        : `Need ${shortfall > 0 ? format(shortfall) : ""} more`}
                    </p>
                  </div>
                </div>
              </div>
            </BlurFade>
          );
        })()}

      {/* 6. INCOME VS EXPENSES BAR + ASSET ALLOCATION DONUT */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <BlurFade delay={D * 3} className="md:col-span-7">
          <div className="finance-card p-6 h-full">
            <p className="label-mono mb-4">Income vs Expenses (6 months)</p>
            <ReactECharts
              option={incExpBarOption}
              style={{ height: "100%", width: "100%" }}
            />
          </div>
        </BlurFade>

        <BlurFade delay={D * 4} className="md:col-span-5">
          <InteractiveDonut
            title="Asset Allocation"
            data={allocationData.map((d) => ({
              name: d.name,
              value: d.value,
              color: d.color,
            }))}
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
            {portfolioHighlights.gainers.length === 0 &&
            portfolioHighlights.losers.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-6">
                No holdings to show
              </p>
            ) : (
              <div className="space-y-4">
                {portfolioHighlights.gainers.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Gainers
                    </p>
                    <div className="space-y-2">
                      {portfolioHighlights.gainers.map((h) => (
                        <div
                          key={h.name}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm font-medium truncate mr-3">
                            {h.name}
                          </span>
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
                        <div
                          key={h.name}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm font-medium truncate mr-3">
                            {h.name}
                          </span>
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
          <div className="finance-card p-6 h-full">
            <p className="label-mono mb-4">Upcoming</p>
            {upcomingRecurring.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-6">
                No recurring transactions set up
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingRecurring.map((item, idx) => {
                  const shortDate = (() => {
                    const [, m, d] = item.nextDate.split("-").map(Number);
                    const dt = new Date(2000, m - 1, d);
                    return dt.toLocaleDateString("en-AU", {
                      month: "short",
                      day: "numeric",
                    });
                  })();
                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums w-14 shrink-0">
                        {shortDate}
                      </span>
                      <span className="text-sm truncate flex-1">
                        {item.description}
                      </span>
                      <span
                        className={cn(
                          "font-mono tabular-nums text-sm shrink-0",
                          item.kind === "income"
                            ? "text-income"
                            : "text-expense",
                        )}
                      >
                        {item.kind === "income" ? "+" : "-"}
                        {format(item.amount, item.currency)}
                      </span>
                      <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full shrink-0">
                        {item.frequency}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </BlurFade>
      </div>

      {/* 8. WEEKLY GLANCE + RECENT ACTIVITY */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Weekly Cash Flow Mini Chart + Insights */}
        <BlurFade delay={D * 7} className="md:col-span-5">
          <div className="finance-card p-5 h-full">
            <p className="label-mono mb-4">This Week</p>
            {(() => {
              // Build last 7 days of cash flow
              const today = new Date();
              const days: { label: string; date: string; income: number; expense: number }[] = [];
              for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                const dayLabel = d.toLocaleDateString("en-AU", { weekday: "short" });
                const dayIncome = incomeEntries
                  .filter((e) => e.date === dateStr)
                  .reduce((s, e) => s + convert(e.amount, e.currency), 0);
                const dayExpense = expenseEntries
                  .filter((e) => e.date === dateStr)
                  .reduce((s, e) => s + convert(e.amount, e.currency), 0);
                days.push({ label: dayLabel, date: dateStr, income: dayIncome, expense: dayExpense });
              }
              const weekIncome = days.reduce((s, d) => s + d.income, 0);
              const weekExpense = days.reduce((s, d) => s + d.expense, 0);
              const weekNet = weekIncome - weekExpense;
              const maxVal = Math.max(...days.map((d) => Math.max(d.income, d.expense)), 1);

              // Top expense category this week
              const weekExpEntries = expenseEntries.filter((e) => days.some((d) => d.date === e.date));
              const catMap: Record<string, number> = {};
              for (const e of weekExpEntries) {
                const label = (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type;
                catMap[label] = (catMap[label] ?? 0) + convert(e.amount, e.currency);
              }
              const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];

              const daysWithSpending = days.filter((d) => d.expense > 0).length;
              const noSpendDays = 7 - daysWithSpending;

              return (
                <div className="space-y-4">
                  {/* Summary row */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">In</p>
                      <p className="text-sm font-semibold tabular-nums text-income">{format(weekIncome)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Out</p>
                      <p className="text-sm font-semibold tabular-nums text-expense">{format(weekExpense)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Net</p>
                      <p className={cn("text-sm font-semibold tabular-nums", weekNet >= 0 ? "text-income" : "text-expense")}>
                        {weekNet >= 0 ? "+" : ""}{format(weekNet)}
                      </p>
                    </div>
                  </div>

                  {/* Mini daily bar chart */}
                  <div className="flex items-end gap-1.5 h-20">
                    {days.map((d) => {
                      const incH = maxVal > 0 ? (d.income / maxVal) * 100 : 0;
                      const expH = maxVal > 0 ? (d.expense / maxVal) * 100 : 0;
                      const isToday = d.date === days[days.length - 1].date;
                      return (
                        <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                          <div className="w-full flex gap-px justify-center" style={{ height: 64 }}>
                            <div className="flex flex-col justify-end w-2.5">
                              <div
                                className="bg-income/70 rounded-t-sm transition-all"
                                style={{ height: `${incH}%` }}
                              />
                            </div>
                            <div className="flex flex-col justify-end w-2.5">
                              <div
                                className="bg-expense/70 rounded-t-sm transition-all"
                                style={{ height: `${expH}%` }}
                              />
                            </div>
                          </div>
                          <span className={cn("text-[9px]", isToday ? "font-semibold text-foreground" : "text-muted-foreground/50")}>
                            {d.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Insights */}
                  <div className="space-y-1.5 border-t border-border/50 pt-3">
                    {topCat && (
                      <p className="text-xs text-muted-foreground">
                        Top spend: <span className="font-medium text-foreground">{topCat[0]}</span> — {format(topCat[1])}
                      </p>
                    )}
                    {noSpendDays > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <span className="text-income font-medium">{noSpendDays}</span> no-spend day{noSpendDays !== 1 ? "s" : ""} this week
                      </p>
                    )}
                    {weekExpense > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Daily avg: <span className="font-medium text-foreground">{format(weekExpense / 7)}</span>/day
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </BlurFade>

        {/* Recent Activity */}
        <BlurFade delay={D * 7.5} className="md:col-span-7">
          <div className="finance-card p-5 h-full">
            <p className="label-mono mb-4">Recent Activity</p>
            {recentActivity.length > 0 ? (
              <div className="divide-y divide-border/50">
                {recentActivity.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center h-7 w-7 rounded-full shrink-0",
                        item.kind === "income"
                          ? "bg-income/10 text-income"
                          : "bg-expense/10 text-expense",
                      )}
                    >
                      {item.kind === "income" ? (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.description || item.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.label} · {formatDateString(item.date)}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "text-sm font-mono tabular-nums font-medium shrink-0",
                        item.kind === "income" ? "text-income" : "text-expense",
                      )}
                    >
                      {item.kind === "income" ? "+" : "-"}
                      {format(item.amount, item.currency as Currency)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50 py-6">
                No transactions recorded yet
              </p>
            )}
          </div>
        </BlurFade>
      </div>
    </div>
  );
}
