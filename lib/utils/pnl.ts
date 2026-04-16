import type {
  PortfolioTransaction,
  CryptoTransaction,
  PortfolioHolding,
  CryptoHolding,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyPnlEntry {
  date: string; // YYYY-MM-DD
  portfolioPnl: number; // Price-change PnL for stocks
  cryptoPnl: number; // Price-change PnL for crypto
  totalPnl: number; // Combined
}

export interface HoldingPnl {
  name: string;
  ticker: string;
  type: "stock" | "crypto";
  units: number;
  currentValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  currency: string;
}

export interface PnlAnalysis {
  winDays: number;
  lossDays: number;
  winRate: number;
  cumulativeProfit: number;
  cumulativeLoss: number;
  totalPnl: number;
}

// ---------------------------------------------------------------------------
// Snapshot shape (minimal — only what we need)
// ---------------------------------------------------------------------------

interface Snapshot {
  date: string; // "YYYY-MM-DD HH:MM" or "YYYY-MM-DD"
  value: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract the YYYY-MM-DD portion from a snapshot date string. */
function dayOf(dateStr: string): string {
  return dateStr.slice(0, 10);
}

/**
 * Build a map of day -> last snapshot value for that day.
 * If multiple snapshots fall on the same day, the latest one wins.
 */
function buildDailyMap(snapshots: Snapshot[]): Map<string, number> {
  const map = new Map<string, number>();
  // Sort chronologically so the last occurrence per day is the latest.
  const sorted = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const s of sorted) {
    map.set(dayOf(s.date), s.value);
  }
  return map;
}

/** Net cash-flow per day from portfolio transactions (buy = deposit, sell = withdrawal). */
function portfolioCashFlowByDay(
  txns: PortfolioTransaction[],
  convert: (amount: number, currency: string) => number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of txns) {
    const day = dayOf(t.date);
    const flow = t.type === "buy" ? convert(t.totalAmount, t.currency) : -convert(t.totalAmount, t.currency);
    map.set(day, (map.get(day) ?? 0) + flow);
  }
  return map;
}

/** Net cash-flow per day from crypto transactions. */
function cryptoCashFlowByDay(
  txns: CryptoTransaction[],
  convert: (amount: number, currency: string) => number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.totalValueUsd == null) continue;
    const day = dayOf(t.date);
    let flow: number;
    if (t.type === "buy" || t.type === "transferIn") {
      flow = convert(t.totalValueUsd, "USD");
    } else {
      flow = -convert(t.totalValueUsd, "USD");
    }
    map.set(day, (map.get(day) ?? 0) + flow);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute daily PnL from hourly snapshot series and transactions.
 *
 * Formula per day:
 *   PnL = endOfDayValue - endOfPrevDayValue - netDeposits
 *
 * The first day in the series is "day 0" and is skipped (no previous value).
 */
export function computeDailyPnl(
  portfolioSnapshots: Snapshot[],
  cryptoSnapshots: Snapshot[],
  portfolioTxns: PortfolioTransaction[],
  cryptoTxns: CryptoTransaction[],
  convert: (amount: number, currency: string) => number,
): DailyPnlEntry[] {
  const portMap = buildDailyMap(portfolioSnapshots);
  const cryptoMap = buildDailyMap(cryptoSnapshots);
  const portCF = portfolioCashFlowByDay(portfolioTxns, convert);
  const cryptoCF = cryptoCashFlowByDay(cryptoTxns, convert);

  // Collect every unique day across all maps
  const daySet = new Set<string>();
  for (const d of portMap.keys()) daySet.add(d);
  for (const d of cryptoMap.keys()) daySet.add(d);
  for (const d of portCF.keys()) daySet.add(d);
  for (const d of cryptoCF.keys()) daySet.add(d);

  const days = [...daySet].sort();
  if (days.length <= 1) return [];

  const entries: DailyPnlEntry[] = [];

  for (let i = 1; i < days.length; i++) {
    const today = days[i];
    const yesterday = days[i - 1];

    const portToday = portMap.get(today) ?? portMap.get(yesterday) ?? 0;
    const portYesterday = portMap.get(yesterday) ?? 0;
    const portDeposit = portCF.get(today) ?? 0;
    const portfolioPnl = portToday - portYesterday - portDeposit;

    const cryptoToday = cryptoMap.get(today) ?? cryptoMap.get(yesterday) ?? 0;
    const cryptoYesterday = cryptoMap.get(yesterday) ?? 0;
    const cryptoDeposit = cryptoCF.get(today) ?? 0;
    const cryptoPnl = cryptoToday - cryptoYesterday - cryptoDeposit;

    entries.push({
      date: today,
      portfolioPnl,
      cryptoPnl,
      totalPnl: portfolioPnl + cryptoPnl,
    });
  }

  return entries;
}

/**
 * Compute per-holding PnL from current portfolio & crypto holdings.
 */
export function computeHoldingsPnl(
  portfolioHoldings: PortfolioHolding[],
  cryptoHoldings: CryptoHolding[],
  convert: (amount: number, currency: string) => number,
): HoldingPnl[] {
  const result: HoldingPnl[] = [];

  for (const h of portfolioHoldings) {
    const currentConverted = convert(h.currentValue, h.currency);
    const costConverted = convert(h.amountInvested, h.currency);
    const pnl = currentConverted - costConverted;
    const pnlPct = costConverted !== 0 ? (pnl / costConverted) * 100 : 0;

    result.push({
      name: h.name,
      ticker: h.ticker,
      type: "stock",
      units: h.units,
      currentValue: currentConverted,
      costBasis: costConverted,
      pnl,
      pnlPct,
      currency: h.currency,
    });
  }

  for (const h of cryptoHoldings) {
    const currentConverted = convert(h.currentValueUsd, "USD");
    const costConverted = convert(h.totalCostUsd, "USD");
    const pnl = currentConverted - costConverted;
    const pnlPct = costConverted !== 0 ? (pnl / costConverted) * 100 : 0;

    result.push({
      name: h.token,
      ticker: h.token,
      type: "crypto",
      units: h.amount,
      currentValue: currentConverted,
      costBasis: costConverted,
      pnl,
      pnlPct,
      currency: "USD",
    });
  }

  return result;
}

/**
 * Aggregate win/loss stats from daily PnL entries.
 */
export function computePnlAnalysis(dailyPnl: DailyPnlEntry[]): PnlAnalysis {
  let winDays = 0;
  let lossDays = 0;
  let cumulativeProfit = 0;
  let cumulativeLoss = 0;

  for (const d of dailyPnl) {
    if (d.totalPnl > 0) {
      winDays++;
      cumulativeProfit += d.totalPnl;
    } else if (d.totalPnl < 0) {
      lossDays++;
      cumulativeLoss += d.totalPnl;
    }
  }

  const total = winDays + lossDays;
  return {
    winDays,
    lossDays,
    winRate: total > 0 ? (winDays / total) * 100 : 0,
    cumulativeProfit,
    cumulativeLoss,
    totalPnl: cumulativeProfit + cumulativeLoss,
  };
}

/**
 * Return all YYYY-MM-DD strings for a given month.
 * @param month 0-indexed (0 = January)
 */
/** Get all days in a month as YYYY-MM-DD strings. Month is 1-indexed (1=Jan, 12=Dec). */
export function getMonthDays(year: number, month: number): string[] {
  const days: string[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return days;
}

/**
 * Return ISO weekday: 0 = Monday .. 6 = Sunday.
 */
export function getISOWeekday(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  return (d.getDay() + 6) % 7; // JS getDay: 0=Sun → shift to 0=Mon
}
