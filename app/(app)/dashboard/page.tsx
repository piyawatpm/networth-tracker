"use client";

import { useState, useMemo, useEffect } from "react";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
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
import { useBinanceWs } from "@/lib/hooks/use-binance-ws";
import { useFinnhubWs } from "@/lib/hooks/use-finnhub-ws";
import { applyLivePrices } from "@/lib/utils/crypto-prices";
import { canAutoUpdate } from "@/lib/utils/prices";

// Sub-components
import { PerformanceChart, type StackedCategory } from "@/components/ui/performance-chart";

// Net worth stacked-area categories (ordered bottom → top in the chart)
const NW_STACKED_CATEGORIES: StackedCategory[] = [
  { key: "portfolio", label: "Portfolio", colorLight: "#4d7cc7", colorDark: "#6ea0e0" },
  { key: "crypto", label: "Crypto", colorLight: "#d4a033", colorDark: "#e8b94a" },
  { key: "other", label: "Other", colorLight: "#2ea598", colorDark: "#4fc1b4" },
];
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
import { FinancialFreedomCard } from "./_components/financial-freedom-card";
import { InvestedVsCashCard } from "./_components/invested-vs-cash-card";
import {
  FinancialHealthSection,
  type FinancialIndicator,
} from "./_components/financial-health-section";
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
  const [cryptoCashTags] = useCloudStorage<Record<string, boolean>>("crypto_cash_tags", {});
  const [efTargetMonths] = useCloudStorage<number>("emergency_fund_target_months", 6);

  const { convert, format, symbol, currency } = useCurrency();
  const [period, setPeriod] = useState<Period>("M");
  const [includeSuper, setIncludeSuper] = useState(true);
  const [tickerMappings] = useCloudStorage<Record<string, string>>("crypto_ticker_mappings", {});

  // Section visibility
  const [hiddenSections, setHiddenSections] = useCloudStorage<string[]>("dashboard_hidden_sections", []);
  const toggleSection = (key: string) => {
    setHiddenSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  // ---- Real-time prices via WebSocket ------------------------------------

  // Finnhub WS for US stocks
  const stockWsSymbols = useMemo(() => {
    return portfolioHoldings
      .filter((h) => h.ticker && canAutoUpdate(h.ticker) && h.country?.toUpperCase() === "US")
      .map((h) => h.ticker.toUpperCase());
  }, [portfolioHoldings]);
  const { livePrices: finnhubPrices, connected: stockWsConnected } = useFinnhubWs(stockWsSymbols);

  // Binance WS for crypto
  const rawCryptoHoldings = useMemo(() => (cryptoCsvText ? parseAndComputeHoldings(cryptoCsvText) : []), [cryptoCsvText]);
  const cryptoWsSymbols = useMemo(() => {
    const skip = new Set(["CASH", "USD", "USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD"]);
    const syms: string[] = [];
    for (const h of rawCryptoHoldings) {
      if (stablecoinTags[h.token]) continue;
      const mapped = tickerMappings[h.token];
      if (!mapped) continue;
      const upper = mapped.toUpperCase();
      if (skip.has(upper)) continue;
      const sym = `${upper}USDT`;
      if (!syms.includes(sym)) syms.push(sym);
    }
    return syms;
  }, [rawCryptoHoldings, tickerMappings, stablecoinTags]);
  const { livePrices: binancePrices, connected: cryptoWsConnected } = useBinanceWs(cryptoWsSymbols);

  // Merge Binance WS prices into crypto holdings
  const [cryptoLivePrices, setCryptoLivePrices] = useState<Record<string, number>>({});
  useEffect(() => {
    if (Object.keys(binancePrices).length === 0) return;
    const mapped: Record<string, number> = {};
    for (const h of rawCryptoHoldings) {
      const ticker = tickerMappings[h.token] ?? h.token;
      const sym = `${ticker.toUpperCase()}USDT`;
      if (binancePrices[sym]) mapped[h.token] = binancePrices[sym].price;
    }
    if (Object.keys(mapped).length > 0) {
      setCryptoLivePrices((prev) => ({ ...prev, ...mapped }));
    }
  }, [binancePrices, rawCryptoHoldings, tickerMappings]);

  // Live portfolio holdings with Finnhub prices applied
  const livePortfolioHoldings = useMemo(() => {
    if (Object.keys(finnhubPrices).length === 0) return portfolioHoldings;
    return portfolioHoldings.map((h) => {
      const trade = finnhubPrices[h.ticker?.toUpperCase()];
      if (!trade) return h;
      const newValue = h.units * trade.price;
      if (Math.abs(newValue - h.currentValue) < 0.01) return h;
      return { ...h, currentValue: newValue };
    });
  }, [portfolioHoldings, finnhubPrices]);

  // ---- Derived data -------------------------------------------------------

  const cryptoHoldings = useMemo(() => {
    const tagged = applyStablecoinTags(rawCryptoHoldings, stablecoinTags);
    return applyLivePrices(tagged, cryptoLivePrices);
  }, [rawCryptoHoldings, stablecoinTags, cryptoLivePrices]);
  const last6Keys = getLast6MonthKeys();

  const portfolioTotal = useMemo(() => livePortfolioHoldings.reduce((s, h) => s + convert(h.currentValue, h.currency), 0), [livePortfolioHoldings, convert]);
  const cryptoTotal = useMemo(() => convert(getTotalCryptoValueUsd(cryptoHoldings), "USD"), [cryptoHoldings, convert]);

  const normalTotal = useMemo(
    () => livePortfolioHoldings.filter((h) => h.accountType === "normal").reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
    [livePortfolioHoldings, convert],
  );

  const superTotal = useMemo(
    () => livePortfolioHoldings.filter((h) => h.accountType === "super").reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
    [livePortfolioHoldings, convert],
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

  // Net worth snapshots for the chart (raw — chart handles conversion).
  // Also derive per-category components for the stacked-area view:
  //   - portfolio (from cron: portfolioTotal, includes super)
  //   - crypto
  //   - other = total − portfolio − crypto (net debts: owed − iOwe)
  // When !includeSuper, subtract the super delta from the portfolio band.
  const nwChartSnapshots = useMemo(() => {
    return nwSnapshots.map((s) => {
      const ext = s as {
        valueNoSuper?: number;
        currency?: string;
        portfolio?: number;
        crypto?: number;
      };
      const total = includeSuper ? s.value : (ext.valueNoSuper ?? s.value);
      const superDelta = ext.valueNoSuper != null ? s.value - ext.valueNoSuper : 0;
      const portfolioPart = includeSuper
        ? (ext.portfolio ?? 0)
        : Math.max(0, (ext.portfolio ?? 0) - superDelta);
      const cryptoPart = ext.crypto ?? 0;
      const otherPart = Math.max(0, total - portfolioPart - cryptoPart);
      const hasBreakdown = ext.portfolio != null || ext.crypto != null;
      return {
        date: s.date,
        value: total,
        currency: ext.currency ?? "USD",
        components: hasBreakdown
          ? { portfolio: portfolioPart, crypto: cryptoPart, other: otherPart }
          : undefined,
      };
    });
  }, [nwSnapshots, includeSuper]);

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
    for (const h of livePortfolioHoldings) {
      if (h.type === "savings" || h.isEmergencyFund) {
        allocs.push({ label: h.name, value: convert(h.currentValue, h.currency), color: colors[ci++ % colors.length] });
      }
    }
    // Crypto — use rawCryptoHoldings (before stablecoin merge) so token names match tags
    for (const h of rawCryptoHoldings) {
      if (cryptoEmergencyTags[h.token]) {
        allocs.push({ label: h.token, value: convert(h.currentValueUsd, "USD"), color: colors[ci++ % colors.length] });
      }
    }
    allocs.sort((a, b) => b.value - a.value);
    return { emergencyFundTotal: allocs.reduce((s, a) => s + a.value, 0), efAllocations: allocs };
  }, [livePortfolioHoldings, rawCryptoHoldings, cryptoEmergencyTags, convert]);

  // Dry powder / cash = manually-tagged portfolio holdings + tagged crypto
  const { cashTotal, cashAllocations, superCashTotal } = useMemo(() => {
    const allocs: { label: string; sublabel?: string; value: number; source: "portfolio" | "crypto"; isSuper?: boolean }[] = [];
    let superCash = 0;
    for (const h of livePortfolioHoldings) {
      if (h.isCash) {
        const value = convert(h.currentValue, h.currency);
        const isSuper = h.accountType === "super";
        if (isSuper) superCash += value;
        allocs.push({
          label: h.ticker || h.name,
          sublabel: h.ticker && h.name !== h.ticker ? h.name : h.broker || undefined,
          value,
          source: "portfolio",
          isSuper,
        });
      }
    }
    for (const h of rawCryptoHoldings) {
      if (cryptoCashTags[h.token]) {
        allocs.push({
          label: h.token,
          sublabel: h.exchange,
          value: convert(h.currentValueUsd, "USD"),
          source: "crypto",
        });
      }
    }
    allocs.sort((a, b) => b.value - a.value);
    return { cashTotal: allocs.reduce((s, a) => s + a.value, 0), cashAllocations: allocs, superCashTotal: superCash };
  }, [livePortfolioHoldings, rawCryptoHoldings, cryptoCashTags, convert]);

  // Weighted average monthly expenses (recent 3mo × 2 + older 3mo × 1) — excludes one-off expenses
  const weightedMonthlyExpenses = useMemo(() => {
    const recurring = expenseEntries.filter((e) => !e.isOneOff);
    const monthlyTotals = last6Keys.map((mk) =>
      recurring.filter((e) => (e.date ?? "").startsWith(mk)).reduce((s, e) => s + convert(e.amount, e.currency), 0),
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

  // Annualized expenses — exclude one-off for projection accuracy
  const periodRecurringExpenseTotal = useMemo(
    () => sumConverted(periodExpenses.filter((e) => !e.isOneOff), convert),
    [periodExpenses, convert],
  );
  const annualizedExpenses = useMemo(() => {
    if (period === "Y") return periodRecurringExpenseTotal;
    if (period === "M") return periodRecurringExpenseTotal * 12;
    return periodRecurringExpenseTotal * 52;
  }, [periodRecurringExpenseTotal, period]);

  const fiRatio = annualizedExpenses > 0 ? (passiveAnnualized / annualizedExpenses) * 100 : 0;

  // Investment rate: (portfolio + crypto) / net worth
  const investmentAssets = portfolioTotal + cryptoTotal;
  const investRate = netWorth > 0 ? (investmentAssets / netWorth) * 100 : 0;

  // Runway: all liquid assets / monthly burn
  const liquidAssets = normalTotal + cryptoTotal + emergencyFundTotal;
  const runwayMonths = weightedMonthlyExpenses > 0 ? liquidAssets / weightedMonthlyExpenses : 99;

  // Extra metrics for the Financial Health gauges
  const annualizedIncome = useMemo(() => {
    if (period === "Y") return periodIncomeTotal;
    if (period === "M") return periodIncomeTotal * 12;
    return periodIncomeTotal * 52;
  }, [periodIncomeTotal, period]);

  const totalAssetsGross = portfolioTotal + cryptoTotal + owedToMe;
  const debtToAssetRatio = totalAssetsGross > 0 ? (iOwe / totalAssetsGross) * 100 : 0;
  const debtToIncomeRatio = annualizedIncome > 0 ? (iOwe / annualizedIncome) * 100 : 0;
  const wealthToIncomeRatio = annualizedIncome > 0 ? netWorth / annualizedIncome : 0;
  const netCashFlow = periodIncomeTotal - periodExpenseTotal;

  const healthIndicators: FinancialIndicator[] = useMemo(() => [
    {
      label: "Debt / Assets",
      value: debtToAssetRatio,
      max: 100,
      thresholds: [30, 60],
      invert: true,
      suffix: "%",
      status: debtToAssetRatio <= 30 ? "Healthy" : debtToAssetRatio <= 60 ? "Moderate" : "High",
      formula: "Total Liabilities ÷ Total Assets",
      detail: `${format(iOwe)} ÷ ${format(totalAssetsGross)}`,
      desc: "Measures how much of your assets are financed by debt. Lower is better — means you truly own more of what you have.",
      tip: debtToAssetRatio <= 30
        ? "You're in great shape. Keep debt low as you grow assets."
        : debtToAssetRatio <= 60
          ? "Consider paying down debt before taking on more."
          : "Focus on debt reduction — pay off highest-interest debt first.",
    },
    {
      label: "Debt / Income",
      value: debtToIncomeRatio,
      max: 100,
      thresholds: [35, 50],
      invert: true,
      suffix: "%",
      status: debtToIncomeRatio <= 35 ? "Healthy" : debtToIncomeRatio <= 50 ? "Caution" : "High",
      formula: "Total Debt ÷ Annual Income",
      detail: `${format(iOwe)} ÷ ${format(annualizedIncome)}`,
      desc: "Shows your total debt burden relative to what you earn. Banks use this to assess lending risk — under 35% is ideal.",
      tip: debtToIncomeRatio <= 35
        ? "Lenders see you as low risk. Good position for future borrowing if needed."
        : "Avoid new debt until this ratio drops. Focus on increasing income or paying down principal.",
    },
    {
      label: "Savings Rate",
      value: Math.max(0, savingsRate),
      max: 100,
      thresholds: [10, 20],
      invert: false,
      suffix: "%",
      status: savingsRate >= 20 ? "Excellent" : savingsRate >= 10 ? "Good" : "Low",
      formula: "(Income − Expenses) ÷ Income",
      detail: `(${format(periodIncomeTotal)} − ${format(periodExpenseTotal)}) ÷ ${format(periodIncomeTotal)}`,
      desc: "The percentage of income you keep. The single most important habit for building wealth. 20%+ puts you ahead of most people.",
      tip: savingsRate >= 20
        ? "Outstanding! Consider directing extra savings into investments."
        : savingsRate >= 10
          ? "Good start. Try automating an extra 5% into savings."
          : "Track your top 3 expense categories and find one to cut by 10%.",
    },
    {
      label: "Emergency Fund",
      value: emergencyFundMonths,
      max: 12,
      thresholds: [3, 6],
      invert: false,
      suffix: "months",
      status: emergencyFundMonths >= 6 ? "Strong" : emergencyFundMonths >= 3 ? "Adequate" : "Build up",
      formula: "Liquid Assets ÷ Monthly Expenses",
      detail: `${format(liquidAssets)} ÷ ${format(weightedMonthlyExpenses)}/mo`,
      desc: "How many months you could survive without income. Includes cash, bonds, and stablecoins. 3–6 months is the standard target.",
      tip: emergencyFundMonths >= 6
        ? "Well protected! Anything above 6 months could be invested for growth."
        : emergencyFundMonths >= 3
          ? "You have a basic safety net. Build to 6 months for full protection."
          : "This is your #1 priority. Set up auto-transfers to build this up.",
    },
    {
      label: "Wealth / Income",
      value: wealthToIncomeRatio,
      max: 12,
      thresholds: [1, 5],
      invert: false,
      suffix: "x annual",
      status: wealthToIncomeRatio >= 5 ? "Strong" : wealthToIncomeRatio >= 1 ? "Growing" : "Early",
      formula: "Net Worth ÷ Annual Income",
      detail: `${format(netWorth)} ÷ ${format(annualizedIncome)}`,
      desc: "How many years of income you've accumulated. Rule of thumb: 1× by 30, 3× by 40, 6× by 50, 10–12× by retirement.",
      tip: wealthToIncomeRatio >= 5
        ? "You're building real wealth. Stay the course."
        : wealthToIncomeRatio >= 1
          ? "Good progress! Focus on increasing both savings rate and investment returns."
          : "You're in the accumulation phase. Every dollar saved now has the most compounding time.",
    },
    {
      label: "Invest / Net Worth",
      value: Math.min(investRate, 100),
      max: 100,
      thresholds: [40, 70],
      invert: false,
      suffix: "%",
      status: investRate >= 70 ? "Great" : investRate >= 40 ? "Good" : "Grow",
      formula: "Investment Assets ÷ Net Worth",
      detail: `${format(investmentAssets)} ÷ ${format(netWorth)}`,
      desc: "What portion of your wealth is actively invested (portfolio + crypto). Higher means more of your money is working for you.",
      tip: investRate >= 70
        ? "Your money is working hard. Ensure you're diversified across asset classes."
        : "Consider moving idle cash into diversified investments for long-term growth.",
    },
    {
      label: "FI Ratio",
      value: Math.min(fiRatio, 100),
      max: 100,
      thresholds: [25, 100],
      invert: false,
      suffix: "%",
      status: fiRatio >= 100 ? "Free!" : fiRatio >= 25 ? "On track" : "Building",
      formula: "Passive Income ÷ Total Expenses",
      detail: `${format(passiveAnnualized)}/yr ÷ ${format(annualizedExpenses)}/yr`,
      desc: "The holy grail — when passive income (dividends, interest, rental, crypto yield) covers 100% of expenses, you're financially independent.",
      tip: fiRatio >= 100
        ? "Congratulations! You could live entirely on passive income."
        : fiRatio >= 25
          ? "Great progress toward FI. Keep growing passive income sources."
          : "Focus on building dividend stocks, rental income, or yield-generating assets.",
    },
    {
      label: "Net Cash Flow",
      value: Math.max(0, savingsRate),
      max: 100,
      thresholds: [0, 15],
      invert: false,
      suffix: format(Math.abs(netCashFlow)).replace(/[A-Z$\s]/g, "").slice(0, 8),
      status: netCashFlow >= 0 ? "Surplus" : "Deficit",
      formula: "Income − Expenses",
      detail: `${format(periodIncomeTotal)} − ${format(periodExpenseTotal)}`,
      desc: "Are you earning more than you spend? A positive cash flow is the foundation of all wealth building.",
      tip: netCashFlow >= 0
        ? "You're cash-flow positive. Direct the surplus to savings and investments."
        : "You're spending more than you earn. Review expenses immediately and find cuts.",
    },
  ], [
    debtToAssetRatio, debtToIncomeRatio, savingsRate, emergencyFundMonths,
    wealthToIncomeRatio, investRate, fiRatio, netCashFlow,
    iOwe, totalAssetsGross, annualizedIncome, periodIncomeTotal, periodExpenseTotal,
    liquidAssets, weightedMonthlyExpenses, netWorth, investmentAssets,
    passiveAnnualized, annualizedExpenses, format,
  ]);

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
    for (const h of livePortfolioHoldings) {
      const cur = convert(h.currentValue, h.currency), cost = convert(h.amountInvested, h.currency);
      items.push({ name: h.ticker || h.name, pnl: cur - cost, pnlPct: cost > 0 ? ((cur - cost) / cost) * 100 : 0 });
    }
    for (const h of cryptoHoldings) {
      const cur = convert(h.currentValueUsd, "USD"), cost = convert(h.totalCostUsd, "USD");
      items.push({ name: h.token, pnl: cur - cost, pnlPct: cost > 0 ? ((cur - cost) / cost) * 100 : 0 });
    }
    const sorted = [...items].sort((a, b) => b.pnl - a.pnl);
    return { gainers: sorted.filter((i) => i.pnl > 0).slice(0, 3), losers: sorted.filter((i) => i.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 3) };
  }, [livePortfolioHoldings, cryptoHoldings, convert]);

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

      {/* 1. NET WORTH PERFORMANCE CHART */}
      <BlurFade delay={0}>
        <div className="flex items-center justify-end mb-2">
          <button
            onClick={() => setIncludeSuper(!includeSuper)}
            className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="hidden sm:inline">Include Super</span>
            <span className="sm:hidden">Super</span>
            <span className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors", includeSuper ? "bg-income" : "bg-border")}>
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform", includeSuper ? "translate-x-[18px]" : "translate-x-[3px]")} />
            </span>
          </button>
        </div>
        <PerformanceChart
          label="Net Worth"
          currentValue={netWorth}
          snapshots={nwChartSnapshots}
          isLive={stockWsConnected || cryptoWsConnected}
          defaultPeriod="1D"
          breakdownRows={assetRows.filter((r) => !hiddenSections.includes(r.key))}
          breakdownLabel="Asset Breakdown"
          stackedCategories={NW_STACKED_CATEGORIES}
        />
      </BlurFade>

      {/* 2. FINANCIAL FREEDOM: passive income vs expenses for selected period */}
      <FinancialFreedomCard
        period={period}
        passiveIncome={passiveIncome}
        expenses={periodRecurringExpenseTotal}
        passiveAnnualised={passiveAnnualized}
        expensesAnnualised={annualizedExpenses}
        format={format}
        delay={D * 0.25}
      />

      {/* 3a. ASSET DISTRIBUTION (full width) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <WorldDistributionChart
          normalTotal={normalTotal}
          cryptoTotal={cryptoTotal}
          superTotal={superTotal}
          format={format}
          delay={0.15}
          cashTotal={cashTotal}
          cashAllocations={cashAllocations}
          breakdowns={{
            normal: livePortfolioHoldings
              .filter((h) => h.accountType === "normal")
              .map((h) => ({
                label: h.ticker || h.name,
                sublabel: h.ticker && h.name !== h.ticker ? h.name : h.broker || undefined,
                value: convert(h.currentValue, h.currency),
              })),
            super: livePortfolioHoldings
              .filter((h) => h.accountType === "super")
              .map((h) => ({
                label: h.ticker || h.name,
                sublabel: h.ticker && h.name !== h.ticker ? h.name : h.broker || undefined,
                value: convert(h.currentValue, h.currency),
              })),
            crypto: cryptoHoldings.map((h) => ({
              label: h.token,
              sublabel: h.exchange,
              value: convert(h.currentValueUsd, "USD"),
            })),
          }}
        />
      </div>

      {/* 3a+. CAPITAL ALLOCATION (invested vs cash) */}
      <InvestedVsCashCard
        totalAssets={(includeSuper ? portfolioTotal : normalTotal) + cryptoTotal + owedToMe}
        cashTotal={includeSuper ? cashTotal : cashTotal - superCashTotal}
        format={format}
        delay={D * 0.5}
      />

      {/* 3b. ASSET BREAKDOWN + MONEY FLOW */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <AssetBreakdown rows={assetRows} hiddenSections={hiddenSections} onToggleSection={toggleSection} format={format} delay={D * 0.5} />
        <div className="md:col-span-8">
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

      {/* 4b. FINANCIAL HEALTH INDICATORS (8 gauges, click for detail modal) */}
      <FinancialHealthSection indicators={healthIndicators} delay={D * 2.7} />

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
