"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";

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
  monthKeyToLabel,
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
  PortfolioTransaction,
  DebtRecord,
  DebtTransaction,
  Currency,
  RecurringExpense,
  RecurringIncome,
} from "@/lib/utils/types";

// Sub-components
import {
  FinancialHealthSection,
  type FinancialIndicator,
} from "./_components/financial-health-section";
import { GlanceCards, type ActivityItem } from "./_components/glance-cards";
import { NetWorthChart } from "./_components/net-worth-chart";
import { VitalsCard } from "./_components/goal-progress";
import { TopMovers } from "./_components/top-movers";
import {
  UpcomingRecurring,
  type UpcomingItem,
} from "./_components/upcoming-recurring";
import { AssetBreakdown } from "./_components/asset-breakdown";
import { IncomeExpenseCharts } from "./_components/income-expense-charts";
import { WorldDistributionChart } from "./_components/world-distribution-chart";
import { MoneyFlowCard } from "./_components/money-flow-card";
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

const PERIOD_LABELS: Record<Period, string> = { W: "This Week", M: "This Month", Y: "This Year" };

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
  const [nwSnapshots, setNwSnapshots] = useCloudStorage<{ date: string; value: number }[]>("networth_snapshots", []);
  const [stablecoinTags] = useCloudStorage<Record<string, boolean>>("crypto_stablecoin_tags", {});

  const { convert, format, symbol } = useCurrency();
  const [period, setPeriod] = useState<Period>("M");
  const [includeSuper, setIncludeSuper] = useState(true);

  // Section visibility
  const [hiddenSections, setHiddenSections] = useCloudStorage<string[]>("dashboard_hidden_sections", []);
  const toggleSection = (key: string) => {
    setHiddenSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };
  const isVisible = (key: string) => !hiddenSections.includes(key);

  // ---- Derived data -------------------------------------------------------

  const rawCryptoHoldings = useMemo(() => (cryptoCsvText ? parseAndComputeHoldings(cryptoCsvText) : []), [cryptoCsvText]);
  const cryptoHoldings = useMemo(() => applyStablecoinTags(rawCryptoHoldings, stablecoinTags), [rawCryptoHoldings, stablecoinTags]);
  const last6Keys = getLast6MonthKeys();

  const portfolioTotal = useMemo(() => portfolioHoldings.reduce((s, h) => s + convert(h.currentValue, h.currency), 0), [portfolioHoldings, convert]);
  const cryptoTotal = useMemo(() => convert(getTotalCryptoValueUsd(cryptoHoldings), "USD"), [cryptoHoldings, convert]);

  const normalTotal = useMemo(
    () =>
      portfolioHoldings
        .filter((h) => h.accountType === "normal")
        .reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
    [portfolioHoldings, convert],
  );

  const superTotal = useMemo(
    () =>
      portfolioHoldings
        .filter((h) => h.accountType === "super")
        .reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
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

  const activePortfolioTotal = includeSuper ? portfolioTotal : normalTotal;
  const totalAssets = activePortfolioTotal + cryptoTotal + owedToMe;
  const netWorth = totalAssets - iOwe;

  // Net worth snapshots
  useEffect(() => {
    if (netWorth === 0) return; // skip before hydration
    const today = getSydneyDateString();
    if (nwSnapshots.some((s) => s.date === today)) return;
    setNwSnapshots((prev) => [...prev.slice(-89), { date: today, value: netWorth }]);
  }, [netWorth, nwSnapshots, setNwSnapshots]);

  const nwTrendData = useMemo(() => nwSnapshots.map((s) => ({ date: s.date.slice(5), value: s.value })), [nwSnapshots]);

  // ---- Period-filtered income/expenses ------------------------------------

  const periodIncome = useMemo(() => incomeEntries.filter((e) => isInPeriod(e.date ?? "", period)), [incomeEntries, period]);
  const periodExpenses = useMemo(() => expenseEntries.filter((e) => isInPeriod(e.date ?? "", period)), [expenseEntries, period]);
  const prevPeriodIncome = useMemo(() => incomeEntries.filter((e) => isInPrevPeriod(e.date ?? "", period)), [incomeEntries, period]);
  const prevPeriodExpenses = useMemo(() => expenseEntries.filter((e) => isInPrevPeriod(e.date ?? "", period)), [expenseEntries, period]);

  const periodIncomeTotal = useMemo(() => sumConverted(periodIncome, convert), [periodIncome, convert]);
  const periodExpenseTotal = useMemo(() => sumConverted(periodExpenses, convert), [periodExpenses, convert]);
  const prevIncomeTotal = useMemo(() => sumConverted(prevPeriodIncome, convert), [prevPeriodIncome, convert]);
  const prevExpenseTotal = useMemo(() => sumConverted(prevPeriodExpenses, convert), [prevPeriodExpenses, convert]);

  const periodInvested = useMemo(() => {
    const today = getSydneyDateString();
    let from: string;
    if (period === "W") {
      from = getWeekStart();
    } else if (period === "M") {
      from = today.slice(0, 7) + "-01";
    } else {
      from = today.slice(0, 4) + "-01-01";
    }
    return totalInvestedInRange(portfolioTransactions, from, today, convert);
  }, [period, convert, portfolioTransactions]);

  const netCashFlow = periodIncomeTotal - periodExpenseTotal;
  const savingsRate = periodIncomeTotal > 0 ? ((periodIncomeTotal - periodExpenseTotal) / periodIncomeTotal) * 100 : 0;
  const debtToAssetRatio = totalAssets > 0 ? (iOwe / totalAssets) * 100 : 0;
  const incomeChange = prevIncomeTotal > 0 ? ((periodIncomeTotal - prevIncomeTotal) / prevIncomeTotal) * 100 : 0;
  const expenseChange = prevExpenseTotal > 0 ? ((periodExpenseTotal - prevExpenseTotal) / prevExpenseTotal) * 100 : 0;

  // ---- Financial Health computed values -----------------------------------

  const annualizedIncome = useMemo(() => {
    if (period === "Y") return periodIncomeTotal;
    if (period === "M") return periodIncomeTotal * 12;
    return periodIncomeTotal * 52;
  }, [periodIncomeTotal, period]);

  const monthlyExpenses = useMemo(() => {
    if (period === "Y") return periodExpenseTotal / 12;
    if (period === "M") return periodExpenseTotal;
    return periodExpenseTotal * (52 / 12);
  }, [periodExpenseTotal, period]);

  const debtToIncomeRatio = annualizedIncome > 0 ? (iOwe / annualizedIncome) * 100 : 0;

  const liquidAssets = useMemo(() => {
    const cashLikePortfolio = portfolioHoldings
      .filter((h) => h.type === "bond" || h.type === "other")
      .reduce((s, h) => s + convert(h.currentValue, h.currency), 0);
    const stablecoinValue = cryptoHoldings
      .filter((h) => h.token === "Stablecoin" || ["USDC", "USDT", "DAI", "BUSD", "FDUSD", "PYUSD", "TUSD", "USD1"].includes(h.token.toUpperCase()))
      .reduce((s, h) => s + convert(h.currentValueUsd, "USD"), 0);
    return cashLikePortfolio + stablecoinValue;
  }, [portfolioHoldings, cryptoHoldings, convert]);

  const emergencyFundMonths = monthlyExpenses > 0 ? liquidAssets / monthlyExpenses : 0;
  const wealthToIncomeRatio = annualizedIncome > 0 ? netWorth / annualizedIncome : 0;

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
  const investmentAssets = portfolioTotal + cryptoTotal;
  const investmentToNetWorthRatio = netWorth > 0 ? (investmentAssets / netWorth) * 100 : 0;

  // ---- Financial health indicators data -----------------------------------

  const indicators: FinancialIndicator[] = useMemo(() => [
    { label: "Debt / Assets", value: debtToAssetRatio, max: 100, thresholds: [30, 60] as [number, number], invert: true, suffix: "%",
      status: debtToAssetRatio <= 30 ? "Healthy" : debtToAssetRatio <= 60 ? "Moderate" : "High",
      formula: "Total Liabilities \u00f7 Total Assets", detail: `${format(iOwe)} \u00f7 ${format(totalAssets)}`,
      desc: "Measures how much of your assets are financed by debt. Lower is better \u2014 means you truly own more of what you have.",
      tip: debtToAssetRatio <= 30 ? "You're in great shape. Keep debt low as you grow assets." : debtToAssetRatio <= 60 ? "Consider paying down debt before taking on more." : "Focus on debt reduction \u2014 pay off highest-interest debt first.",
    },
    { label: "Debt / Income", value: debtToIncomeRatio, max: 100, thresholds: [35, 50] as [number, number], invert: true, suffix: "%",
      status: debtToIncomeRatio <= 35 ? "Healthy" : debtToIncomeRatio <= 50 ? "Caution" : "High",
      formula: "Total Debt \u00f7 Annual Income", detail: `${format(iOwe)} \u00f7 ${format(annualizedIncome)}`,
      desc: "Shows your total debt burden relative to what you earn. Banks use this to assess lending risk \u2014 under 35% is ideal.",
      tip: debtToIncomeRatio <= 35 ? "Lenders see you as low risk. Good position for future borrowing if needed." : "Avoid new debt until this ratio drops. Focus on increasing income or paying down principal.",
    },
    { label: "Savings Rate", value: savingsRate, max: 100, thresholds: [10, 20] as [number, number], invert: false, suffix: "%",
      status: savingsRate >= 20 ? "Excellent" : savingsRate >= 10 ? "Good" : "Low",
      formula: "(Income \u2212 Expenses) \u00f7 Income", detail: `(${format(periodIncomeTotal)} \u2212 ${format(periodExpenseTotal)}) \u00f7 ${format(periodIncomeTotal)}`,
      desc: "The percentage of income you keep. The single most important habit for building wealth. 20%+ puts you ahead of most people.",
      tip: savingsRate >= 20 ? "Outstanding! Consider directing extra savings into investments." : savingsRate >= 10 ? "Good start. Try automating an extra 5% into savings." : "Track your top 3 expense categories and find one to cut by 10%.",
    },
    { label: "Emergency Fund", value: emergencyFundMonths, max: 12, thresholds: [3, 6] as [number, number], invert: false, suffix: "months",
      status: emergencyFundMonths >= 6 ? "Strong" : emergencyFundMonths >= 3 ? "Adequate" : "Build up",
      formula: "Liquid Assets \u00f7 Monthly Expenses", detail: `${format(liquidAssets)} \u00f7 ${format(monthlyExpenses)}/mo`,
      desc: "How many months you could survive without income. Includes cash, bonds, and stablecoins. 3-6 months is the standard target.",
      tip: emergencyFundMonths >= 6 ? "Well protected! Anything above 6 months could be invested for growth." : emergencyFundMonths >= 3 ? "You have a basic safety net. Build to 6 months for full protection." : "This is your #1 priority. Set up auto-transfers to build this up.",
    },
    { label: "Wealth / Income", value: wealthToIncomeRatio, max: 12, thresholds: [1, 5] as [number, number], invert: false, suffix: "x annual",
      status: wealthToIncomeRatio >= 5 ? "Strong" : wealthToIncomeRatio >= 1 ? "Growing" : "Early",
      formula: "Net Worth \u00f7 Annual Income", detail: `${format(netWorth)} \u00f7 ${format(annualizedIncome)}`,
      desc: "How many years of income you've accumulated. A rule of thumb: aim for 1x by 30, 3x by 40, 6x by 50, 10-12x by retirement.",
      tip: wealthToIncomeRatio >= 5 ? "You're building real wealth. Stay the course." : wealthToIncomeRatio >= 1 ? "Good progress! Focus on increasing both savings rate and investment returns." : "You're in the accumulation phase. Every dollar saved now has the most compounding time.",
    },
    { label: "Invest / Net Worth", value: Math.min(investmentToNetWorthRatio, 100), max: 100, thresholds: [40, 70] as [number, number], invert: false, suffix: "%",
      status: investmentToNetWorthRatio >= 70 ? "Great" : investmentToNetWorthRatio >= 40 ? "Good" : "Grow",
      formula: "Investment Assets \u00f7 Net Worth", detail: `${format(investmentAssets)} \u00f7 ${format(netWorth)}`,
      desc: "What portion of your wealth is actively invested (portfolio + crypto). Higher means more of your money is working for you, generating returns.",
      tip: investmentToNetWorthRatio >= 70 ? "Your money is working hard. Ensure you're diversified across asset classes." : "Consider moving idle cash into diversified investments for long-term growth.",
    },
    { label: "FI Ratio", value: Math.min(fiRatio, 100), max: 100, thresholds: [25, 100] as [number, number], invert: false, suffix: "%",
      status: fiRatio >= 100 ? "Free!" : fiRatio >= 25 ? "On track" : "Building",
      formula: "Passive Income \u00f7 Total Expenses", detail: `${format(passiveAnnualized)}/yr \u00f7 ${format(annualizedExpenses)}/yr`,
      desc: "The holy grail \u2014 when passive income (dividends, interest, rental, crypto yield) covers 100% of expenses, you're financially independent.",
      tip: fiRatio >= 100 ? "Congratulations! You could live entirely on passive income." : fiRatio >= 25 ? "Great progress toward FI. Keep growing passive income sources." : "Focus on building dividend stocks, rental income, or yield-generating assets.",
    },
    { label: "Net Cash Flow", value: Math.max(0, savingsRate), max: 100, thresholds: [0, 15] as [number, number], invert: false,
      suffix: format(netCashFlow).replace(/[A-Z$\s]/g, "").slice(0, 8),
      status: netCashFlow >= 0 ? "Surplus" : "Deficit",
      formula: "Income \u2212 Expenses", detail: `${format(periodIncomeTotal)} \u2212 ${format(periodExpenseTotal)}`,
      desc: "Simple: are you earning more than you spend? A positive cash flow is the foundation of all wealth building.",
      tip: netCashFlow >= 0 ? "You're cash-flow positive. Direct the surplus to savings and investments." : "You're spending more than you earn. Review expenses immediately and find cuts.",
    },
  ], [debtToAssetRatio, debtToIncomeRatio, savingsRate, emergencyFundMonths, wealthToIncomeRatio, investmentToNetWorthRatio, fiRatio, netCashFlow, iOwe, totalAssets, annualizedIncome, periodIncomeTotal, periodExpenseTotal, liquidAssets, monthlyExpenses, netWorth, investmentAssets, passiveAnnualized, annualizedExpenses, format]);

  // ---- Asset allocation ---------------------------------------------------

  const allocationData = useMemo(() => {
    const slices: { name: string; value: number; color: string }[] = [];
    let ci = 0;
    const filteredPortfolio = includeSuper
      ? portfolioHoldings
      : portfolioHoldings.filter((h) => h.accountType !== "super");
    for (const h of filteredPortfolio) {
      slices.push({ name: h.ticker || h.name, value: convert(h.currentValue, h.currency), color: CHART_COLORS[ci++ % CHART_COLORS.length] });
    }
    for (const h of cryptoHoldings) {
      slices.push({ name: h.token, value: convert(h.currentValueUsd, "USD"), color: CHART_COLORS[ci++ % CHART_COLORS.length] });
    }
    return slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  }, [portfolioHoldings, cryptoHoldings, convert, includeSuper]);

  // ---- Income vs Expenses bar chart data ----------------------------------

  const barData = useMemo(() => {
    return last6Keys.map((key) => {
      let inc = 0, exp = 0;
      for (const e of incomeEntries) { if ((e.date ?? "").slice(0, 7) === key) inc += convert(e.amount, e.currency); }
      for (const e of expenseEntries) { if ((e.date ?? "").slice(0, 7) === key) exp += convert(e.amount, e.currency); }
      return { month: monthKeyToLabel(key), income: inc, expenses: exp, net: inc - exp };
    });
  }, [last6Keys, incomeEntries, expenseEntries, convert]);

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

  // ---- Health score -------------------------------------------------------

  const healthScore = useMemo(() => {
    let score = 0;
    if (savingsRate > 0) score += Math.min(savingsRate, 30);
    if (debtToAssetRatio < 50) score += Math.max(0, 30 - debtToAssetRatio * 0.6);
    if (netWorth > 0) score += 20;
    if (periodIncomeTotal > 0 && periodExpenseTotal < periodIncomeTotal) score += 20;
    return Math.round(Math.min(100, Math.max(0, score)));
  }, [savingsRate, debtToAssetRatio, netWorth, periodIncomeTotal, periodExpenseTotal]);

  const healthLabel = healthScore >= 80 ? "Excellent" : healthScore >= 60 ? "Good" : healthScore >= 40 ? "Fair" : "Needs Work";
  const healthColor = healthScore >= 80 ? "#2e8b57" : healthScore >= 60 ? "#2e8b57" : healthScore >= 40 ? "#2c251e" : "#cd5c5c";

  // ---- Recent activity feed -----------------------------------------------

  const recentActivity: ActivityItem[] = useMemo(() => {
    const items: ActivityItem[] = [];
    for (const e of incomeEntries) {
      items.push({ id: e.id, kind: "income", type: e.type, label: (INCOME_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type, description: e.description, amount: e.amount, currency: e.currency, date: e.date });
    }
    for (const e of expenseEntries) {
      items.push({ id: e.id, kind: "expense", type: e.type, label: (EXPENSE_TYPE_LABELS as Record<string, string>)[e.type] ?? e.type, description: e.description, amount: e.amount, currency: e.currency, date: e.date });
    }
    return items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5);
  }, [incomeEntries, expenseEntries]);

  // ---- Asset breakdown rows -----------------------------------------------

  const assetRows = useMemo(() => [
    { key: "portfolio", label: "Portfolio", value: activePortfolioTotal, negative: false },
    { key: "crypto", label: "Crypto", value: cryptoTotal, negative: false },
    { key: "owed_to_me", label: "Owed to Me", value: owedToMe, negative: false },
    { key: "i_owe", label: "I Owe", value: -iOwe, negative: true },
  ], [activePortfolioTotal, cryptoTotal, owedToMe, iOwe]);

  // ---- Render -------------------------------------------------------------

  const D = 0.05;

  return (
    <div className="space-y-8 pb-12">
      {/* Floating period toggle */}
      <div className="fixed bottom-20 md:bottom-6 right-4 lg:right-8 z-40">
        <div className="flex items-center rounded-full bg-card/90 backdrop-blur-md p-0.5 gap-0.5 shadow-lg ring-1 ring-border/40">
          {(["W", "M", "Y"] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={cn("px-3 py-1.5 rounded-full text-xs font-semibold transition-all", period === p ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{p}</button>
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
            <span
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                includeSuper ? "bg-income" : "bg-border"
              )}
            >
              <span
                className={cn(
                  "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                  includeSuper ? "translate-x-[18px]" : "translate-x-[3px]"
                )}
              />
            </span>
          </button>
        </section>
      </BlurFade>

      {/* 2. QUICK ACTIONS */}
      <BlurFade delay={D * 0.3}>
        <div className="flex flex-wrap gap-2">
          {[
            { href: "/income", label: "+ Add Income" },
            { href: "/expenses", label: "+ Add Expense" },
            { href: "/portfolio", label: "Update Portfolio" },
            { href: "/crypto", label: "Upload CSV" },
          ].map((a) => (
            <Link key={a.href} href={a.href} className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-full text-xs font-medium transition-colors">{a.label}</Link>
          ))}
        </div>
      </BlurFade>

      {/* 3. ASSET BREAKDOWN + NET WORTH TREND */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <AssetBreakdown rows={assetRows} hiddenSections={hiddenSections} onToggleSection={toggleSection} format={format} delay={D * 0.5} />
        <NetWorthChart nwTrendData={nwTrendData} format={format} delay={D} />
      </div>

      {/* 3b. WORLD DISTRIBUTION + MONEY FLOW */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <div className="md:col-span-5">
          <WorldDistributionChart
            normalTotal={normalTotal}
            cryptoTotal={cryptoTotal}
            superTotal={superTotal}
            format={format}
            delay={0.15}
          />
        </div>
        <div className="md:col-span-7">
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

      {/* 4. GOAL SECTION */}
      <GoalSection netWorth={netWorth} symbol={symbol} format={format} />

      {/* 5. VITALS + FINANCIAL HEALTH SCORE */}
      <VitalsCard
        period={period} periodLabel={PERIOD_LABELS[period]}
        periodIncomeTotal={periodIncomeTotal} periodExpenseTotal={periodExpenseTotal}
        netCashFlow={netCashFlow} incomeChange={incomeChange} expenseChange={expenseChange}
        prevIncomeTotal={prevIncomeTotal} prevExpenseTotal={prevExpenseTotal}
        healthScore={healthScore} healthLabel={healthLabel} healthColor={healthColor}
        savingsRate={savingsRate} debtToAssetRatio={debtToAssetRatio}
        format={format} delayVitals={D} delayHealth={D * 2}
      />

      {/* FINANCIAL HEALTH INDICATORS */}
      {isVisible("health-indicators") && (
        <FinancialHealthSection indicators={indicators} delay={D * 2.5} />
      )}

      {/* 6. INCOME VS EXPENSES BAR + ASSET ALLOCATION DONUT */}
      <IncomeExpenseCharts barData={barData} allocationData={allocationData} format={format} delayBar={D * 3} delayDonut={D * 4} />

      {/* 7. PORTFOLIO HIGHLIGHTS + UPCOMING RECURRING */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <TopMovers gainers={portfolioHighlights.gainers} losers={portfolioHighlights.losers} format={format} delay={D * 5} />
        <UpcomingRecurring items={upcomingRecurring} format={format} delay={D * 6} />
      </div>

      {/* 8. WEEKLY GLANCE + RECENT ACTIVITY */}
      <GlanceCards
        incomeEntries={incomeEntries} expenseEntries={expenseEntries}
        recentActivity={recentActivity} convert={convert} format={format}
        delayWeek={D * 7} delayRecent={D * 7.5}
      />
    </div>
  );
}
