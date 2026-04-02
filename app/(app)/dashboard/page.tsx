"use client";

import { useState, useMemo, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { getEchartsBaseOption, ECHARTS_COLORS, formatAxisValue } from "@/lib/utils/echarts";
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
} from "@/lib/utils/timezone";
import {
  INCOME_TYPE_LABELS,
  EXPENSE_TYPE_LABELS,
  INCOME_TYPE_COLORS,
  EXPENSE_TYPE_COLORS,
  CHART_COLORS,
} from "@/lib/utils/constants";
import type {
  IncomeEntry,
  ExpenseEntry,
  PortfolioHolding,
  DebtRecord,
  DebtTransaction,
  IncomeType,
  ExpenseType,
  Currency,
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
  const [y, m, d] = today.split("-").map(Number);
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

  const [nwSnapshots, setNwSnapshots] = useLocalStorage<{ date: string; value: number }[]>("networth_snapshots", []);

  const { convert, format, symbol } = useCurrency();
  const [period, setPeriod] = useState<Period>("M");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

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

  // ---- Period breakdown by type -------------------------------------------

  const incomeByType = useMemo(() => {
    const map = new Map<IncomeType, number>();
    for (const e of periodIncome) {
      map.set(e.type, (map.get(e.type) ?? 0) + convert(e.amount, e.currency));
    }
    return Array.from(map.entries())
      .map(([type, value]) => ({ name: INCOME_TYPE_LABELS[type], value, color: INCOME_TYPE_COLORS[type], type }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [periodIncome, convert]);

  const expenseByType = useMemo(() => {
    const map = new Map<ExpenseType, number>();
    for (const e of periodExpenses) {
      map.set(e.type, (map.get(e.type) ?? 0) + convert(e.amount, e.currency));
    }
    return Array.from(map.entries())
      .map(([type, value]) => ({ name: EXPENSE_TYPE_LABELS[type], value, color: EXPENSE_TYPE_COLORS[type], type }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [periodExpenses, convert]);

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

  // ---- Daily cash flow (last 14 days) for sparkline -----------------------

  const dailyCashFlow = useMemo(() => {
    const today = getSydneyDateString();
    const days: { date: string; income: number; expenses: number; net: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
      let inc = 0, exp = 0;
      for (const e of incomeEntries) { if (e.date === ds) inc += convert(e.amount, e.currency); }
      for (const e of expenseEntries) { if (e.date === ds) exp += convert(e.amount, e.currency); }
      days.push({ date: ds.slice(5), income: inc, expenses: exp, net: inc - exp });
    }
    return days;
  }, [incomeEntries, expenseEntries, convert]);

  // ---- Top spending categories (period) -----------------------------------

  const topExpenseCategories = useMemo(() => {
    return expenseByType.slice(0, 5);
  }, [expenseByType]);

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
      items.push({ id: e.id, kind: "expense", type: e.type, label: EXPENSE_TYPE_LABELS[e.type as ExpenseType], description: e.description, amount: e.amount, currency: e.currency, date: e.date });
    }
    return items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 10);
  }, [incomeEntries, expenseEntries]);

  // ---- ECharts base -------------------------------------------------------

  const base = useMemo(() => getEchartsBaseOption(isDark), [isDark]);

  // CSS variable colors need to be resolved at render time for ECharts
  // We use computed style to get actual hex values
  const [chartColors, setChartColors] = useState({ accent: "#c95f3f", income: "#22c55e", expense: "#ef4444" });
  useEffect(() => {
    const root = document.documentElement;
    const computed = getComputedStyle(root);
    const accent = computed.getPropertyValue("--accent").trim();
    const income = computed.getPropertyValue("--income").trim();
    const expense = computed.getPropertyValue("--expense").trim();
    setChartColors({
      accent: accent || (isDark ? "#e09770" : "#c95f3f"),
      income: income || "#22c55e",
      expense: expense || "#ef4444",
    });
  }, [isDark]);

  // ---- ECharts options ----------------------------------------------------

  // 1. Net Worth Trend (Area)
  const nwTrendOption = useMemo(() => {
    return {
      ...base,
      grid: { top: 12, right: 8, bottom: 28, left: 50, containLabel: false },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: nwTrendData.map((d) => d.date),
        boundaryGap: false,
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: (v: number) => formatAxisValue(v),
        },
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis" as const,
        formatter: (params: { data: number; axisValue: string }[]) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `<span style="font-weight:600">${p.axisValue}</span><br/><span style="font-family:ui-monospace,monospace">${format(p.data)}</span>`;
        },
      },
      series: [
        {
          type: "line" as const,
          data: nwTrendData.map((d) => d.value),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: chartColors.accent, width: 2 },
          itemStyle: { color: chartColors.accent },
          areaStyle: {
            color: {
              type: "linear" as const,
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: chartColors.accent + "33" },
                { offset: 1, color: chartColors.accent + "00" },
              ],
            },
          },
        },
      ],
    };
  }, [base, nwTrendData, chartColors.accent, format]);

  // 2. Daily Cash Flow (Bar - 14 days)
  const dailyCashFlowOption = useMemo(() => {
    return {
      ...base,
      grid: { top: 12, right: 8, bottom: 28, left: 44, containLabel: false },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: dailyCashFlow.map((d) => d.date),
        axisLabel: {
          ...base.xAxis.axisLabel,
          interval: 1,
        },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: (v: number) => formatAxisValue(v),
        },
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; color: string }[]) => {
          if (!Array.isArray(params)) return "";
          const header = `<div style="margin-bottom:4px;font-weight:600">${params[0].value !== undefined ? dailyCashFlow[0]?.date : ""}</div>`;
          const rows = params.map(
            (p) =>
              `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><span style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>${p.seriesName}</span><span style="font-family:ui-monospace,monospace;font-weight:500">${format(p.value)}</span></div>`
          );
          return header + rows.join("");
        },
      },
      series: [
        {
          name: "Income",
          type: "bar" as const,
          data: dailyCashFlow.map((d) => d.income),
          itemStyle: { color: chartColors.income, borderRadius: [3, 3, 0, 0] },
          barGap: "10%",
        },
        {
          name: "Expenses",
          type: "bar" as const,
          data: dailyCashFlow.map((d) => d.expenses),
          itemStyle: { color: chartColors.expense, borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [base, dailyCashFlow, chartColors, format]);

  // 3. Income vs Expenses (Bar - 6 months)
  const incExpBarOption = useMemo(() => {
    return {
      ...base,
      grid: { top: 12, right: 8, bottom: 28, left: 48, containLabel: false },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: barData.map((d) => d.month),
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: (v: number) => formatAxisValue(v),
        },
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; color: string }[]) => {
          if (!Array.isArray(params)) return "";
          const rows = params.map(
            (p) =>
              `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px"><span style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>${p.seriesName}</span><span style="font-family:ui-monospace,monospace;font-weight:500">${format(p.value)}</span></div>`
          );
          return rows.join("");
        },
      },
      series: [
        {
          name: "Income",
          type: "bar" as const,
          data: barData.map((d) => d.income),
          itemStyle: { color: chartColors.income, borderRadius: [6, 6, 0, 0] },
          barGap: "15%",
        },
        {
          name: "Expenses",
          type: "bar" as const,
          data: barData.map((d) => d.expenses),
          itemStyle: { color: chartColors.expense, borderRadius: [6, 6, 0, 0] },
        },
      ],
    };
  }, [base, barData, chartColors, format]);

  // 4. Asset Allocation (Pie/Donut)
  const allocationPieOption = useMemo(() => {
    return {
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["55%", "90%"],
          center: ["50%", "50%"],
          data: allocationData.map((d) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: d.color },
          })),
          label: { show: false },
          emphasis: { scale: true, scaleSize: 6 },
          itemStyle: {
            borderColor: isDark ? "#1a1a1a" : "#f4f3ed",
            borderWidth: 2,
            borderRadius: 4,
          },
          padAngle: 2,
        },
      ],
      tooltip: {
        ...base.tooltip,
        trigger: "item" as const,
        formatter: (params: { name: string; value: number; percent: number }) =>
          `<span style="font-weight:600">${params.name}</span><br/><span style="font-family:ui-monospace,monospace">${format(params.value)}</span> (${params.percent}%)`,
      },
    };
  }, [base, allocationData, isDark, format]);

  // 5. Income Breakdown (Pie/Donut)
  const incomePieOption = useMemo(() => {
    return {
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["50%", "90%"],
          center: ["50%", "50%"],
          data: incomeByType.map((d) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: d.color },
          })),
          label: { show: false },
          emphasis: { scale: true, scaleSize: 6 },
          itemStyle: {
            borderColor: isDark ? "#1a1a1a" : "#f4f3ed",
            borderWidth: 2,
            borderRadius: 4,
          },
          padAngle: 2,
        },
      ],
      tooltip: {
        ...base.tooltip,
        trigger: "item" as const,
        formatter: (params: { name: string; value: number; percent: number }) =>
          `<span style="font-weight:600">${params.name}</span><br/><span style="font-family:ui-monospace,monospace">${format(params.value)}</span> (${params.percent}%)`,
      },
    };
  }, [base, incomeByType, isDark, format]);

  // 6. Expenses Breakdown (Pie/Donut)
  const expensePieOption = useMemo(() => {
    return {
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["50%", "90%"],
          center: ["50%", "50%"],
          data: expenseByType.map((d) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: d.color },
          })),
          label: { show: false },
          emphasis: { scale: true, scaleSize: 6 },
          itemStyle: {
            borderColor: isDark ? "#1a1a1a" : "#f4f3ed",
            borderWidth: 2,
            borderRadius: 4,
          },
          padAngle: 2,
        },
      ],
      tooltip: {
        ...base.tooltip,
        trigger: "item" as const,
        formatter: (params: { name: string; value: number; percent: number }) =>
          `<span style="font-weight:600">${params.name}</span><br/><span style="font-family:ui-monospace,monospace">${format(params.value)}</span> (${params.percent}%)`,
      },
    };
  }, [base, expenseByType, isDark, format]);

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

      {/* NET WORTH HERO */}
      <BlurFade delay={0}>
        <section>
          <p className="label-mono mb-2">Net Worth</p>
          <div className="display-number">
            <NumberTicker value={netWorth} prefix={symbol} decimalPlaces={0} className="display-number" />
          </div>
        </section>
      </BlurFade>

      {/* NET WORTH TREND + ASSET BREAKDOWN */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <BlurFade delay={D * 0.5} className="md:col-span-5">
          <div className="divide-y divide-border">
            {[
              { label: "Portfolio", value: portfolioTotal },
              { label: "Crypto", value: cryptoTotal },
              { label: "Owed to Me", value: owedToMe },
              { label: "I Owe", value: -iOwe, negative: true },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-3">
                <span className="label-mono">{row.label}</span>
                <span className={cn("font-mono text-sm tabular-nums", row.negative ? "text-expense" : "text-foreground")}>
                  {row.negative ? "-" : ""}{format(Math.abs(row.value))}
                </span>
              </div>
            ))}
          </div>
        </BlurFade>

        <BlurFade delay={D} className="md:col-span-7">
          <div className="finance-card p-5">
            <p className="label-mono mb-3">Net Worth Trend</p>
            {nwTrendData.length > 1 ? (
              <ReactECharts
                option={nwTrendOption}
                style={{ height: 144, width: "100%" }}
                notMerge lazyUpdate
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

      {/* GOAL SECTION */}
      <GoalSection netWorth={netWorth} symbol={symbol} format={format} />

      {/* VITALS ROW */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <BlurFade delay={D} className="md:col-span-8">
          <div className="finance-card p-6">
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

        {/* Ratios */}
        <BlurFade delay={D * 2} className="md:col-span-4">
          <div className="finance-card p-6 h-full flex flex-col justify-center">
            <p className="label-mono mb-4">Key Ratios</p>
            <div className="grid grid-cols-2 gap-6">
              <div className="text-center">
                <p className={cn("text-3xl font-semibold tracking-tighter tabular-nums", savingsRate >= 0 ? "text-income" : "text-expense")}>
                  {savingsRate.toFixed(0)}%
                </p>
                <p className="label-mono mt-1">Savings Rate</p>
              </div>
              <div className="text-center">
                <p className={cn("text-3xl font-semibold tracking-tighter tabular-nums", debtToAssetRatio <= 30 ? "text-income" : debtToAssetRatio <= 60 ? "text-foreground" : "text-expense")}>
                  {debtToAssetRatio.toFixed(0)}%
                </p>
                <p className="label-mono mt-1">Debt / Assets</p>
              </div>
            </div>
          </div>
        </BlurFade>

        {/* Daily Cash Flow Sparkline (14 days) */}
        <BlurFade delay={D * 3} className="md:col-span-7">
          <div className="finance-card p-6">
            <p className="label-mono mb-4">Daily Flow (14 days)</p>
            <ReactECharts
              option={dailyCashFlowOption}
              style={{ height: 160, width: "100%" }}
              notMerge lazyUpdate
            />
          </div>
        </BlurFade>

        {/* Asset Allocation Donut */}
        <BlurFade delay={D * 4} className="md:col-span-5">
          <div className="finance-card p-6">
            <p className="label-mono mb-4">Asset Allocation</p>
            {allocationData.length > 0 ? (
              <div className="flex items-center gap-5">
                <div className="w-36 shrink-0">
                  <ReactECharts
                    option={allocationPieOption}
                    style={{ height: 144, width: 144 }}
                    notMerge lazyUpdate
                  />
                </div>
                <div className="flex-1 space-y-1.5 overflow-hidden">
                  {allocationData.slice(0, 8).map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="truncate text-muted-foreground">{s.name}</span>
                      <span className="ml-auto font-mono tabular-nums text-xs whitespace-nowrap">{format(s.value, undefined, true)}</span>
                    </div>
                  ))}
                  {allocationData.length > 8 && <p className="text-xs text-muted-foreground/60 pl-4">+{allocationData.length - 8} more</p>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50 py-8">No holdings yet</p>
            )}
          </div>
        </BlurFade>

        {/* Income vs Expenses (6 months) */}
        <BlurFade delay={D * 5} className="md:col-span-7">
          <div className="finance-card p-6">
            <p className="label-mono mb-4">Income vs Expenses (6 months)</p>
            <ReactECharts
              option={incExpBarOption}
              style={{ height: 192, width: "100%" }}
              notMerge lazyUpdate
            />
          </div>
        </BlurFade>

        {/* Top Spending Categories */}
        <BlurFade delay={D * 6} className="md:col-span-5">
          <div className="finance-card p-6 h-full">
            <p className="label-mono mb-4">Top Spending — {PERIOD_LABELS[period]}</p>
            {topExpenseCategories.length > 0 ? (
              <div className="space-y-3">
                {topExpenseCategories.map((cat, i) => {
                  const pct = periodExpenseTotal > 0 ? (cat.value / periodExpenseTotal) * 100 : 0;
                  return (
                    <div key={cat.type}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          <span className="text-muted-foreground">{cat.name}</span>
                        </div>
                        <span className="font-mono tabular-nums text-expense text-xs">{format(cat.value)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: cat.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50 py-8">No spending {PERIOD_LABELS[period].toLowerCase()}</p>
            )}
          </div>
        </BlurFade>

        {/* Income Breakdown */}
        <BlurFade delay={D * 7} className="md:col-span-6">
          <div className="finance-card p-6">
            <p className="label-mono mb-4">Income — {PERIOD_LABELS[period]}</p>
            {incomeByType.length > 0 ? (
              <div className="flex items-center gap-6">
                <div className="w-32 shrink-0">
                  <ReactECharts
                    option={incomePieOption}
                    style={{ height: 128, width: 128 }}
                    notMerge lazyUpdate
                  />
                </div>
                <div className="flex-1 space-y-1.5 overflow-hidden">
                  {incomeByType.map((d, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="truncate text-muted-foreground">{d.name}</span>
                      <span className="ml-auto font-mono tabular-nums text-xs whitespace-nowrap">{format(d.value, undefined, true)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50 py-8">No income {PERIOD_LABELS[period].toLowerCase()}</p>
            )}
          </div>
        </BlurFade>

        {/* Expenses Breakdown */}
        <BlurFade delay={D * 8} className="md:col-span-6">
          <div className="finance-card p-6">
            <p className="label-mono mb-4">Expenses — {PERIOD_LABELS[period]}</p>
            {expenseByType.length > 0 ? (
              <div className="flex items-center gap-6">
                <div className="w-32 shrink-0">
                  <ReactECharts
                    option={expensePieOption}
                    style={{ height: 128, width: 128 }}
                    notMerge lazyUpdate
                  />
                </div>
                <div className="flex-1 space-y-1.5 overflow-hidden">
                  {expenseByType.map((d, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="truncate text-muted-foreground">{d.name}</span>
                      <span className="ml-auto font-mono tabular-nums text-xs whitespace-nowrap">{format(d.value, undefined, true)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50 py-8">No expenses {PERIOD_LABELS[period].toLowerCase()}</p>
            )}
          </div>
        </BlurFade>

        {/* Recent Activity */}
        <BlurFade delay={D * 9} className="md:col-span-12">
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
    </div>
  );
}
