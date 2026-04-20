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
  totalPnlPct: number; // % vs prior-day total (0 when no baseline)
  portfolioPnlPct: number; // % vs prior-day stocks baseline
  cryptoPnlPct: number; // % vs prior-day crypto baseline
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
 * Snapshots are stored in USD; convert applies the user's chosen currency.
 */
function buildDailyMap(
  snapshots: Snapshot[],
  convert: (amount: number, currency: string) => number,
): Map<string, number> {
  const map = new Map<string, number>();
  // Sort chronologically so the last occurrence per day is the latest.
  const sorted = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const s of sorted) {
    map.set(dayOf(s.date), convert(s.value, "USD"));
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
  const portMap = buildDailyMap(portfolioSnapshots, convert);
  const cryptoMap = buildDailyMap(cryptoSnapshots, convert);
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

    // Without a real prior-day snapshot the day's full balance would be
    // booked as profit, so skip the contribution until a baseline exists.
    const portYesterdayVal = portMap.get(yesterday);
    const portTodayVal = portMap.get(today) ?? portYesterdayVal;
    const portDeposit = portCF.get(today) ?? 0;
    const portfolioPnl =
      portYesterdayVal !== undefined && portTodayVal !== undefined
        ? portTodayVal - portYesterdayVal - portDeposit
        : 0;

    const cryptoYesterdayVal = cryptoMap.get(yesterday);
    const cryptoTodayVal = cryptoMap.get(today) ?? cryptoYesterdayVal;
    const cryptoDeposit = cryptoCF.get(today) ?? 0;
    const cryptoPnl =
      cryptoYesterdayVal !== undefined && cryptoTodayVal !== undefined
        ? cryptoTodayVal - cryptoYesterdayVal - cryptoDeposit
        : 0;

    const totalPnl = portfolioPnl + cryptoPnl;
    const baseline = (portYesterdayVal ?? 0) + (cryptoYesterdayVal ?? 0);
    const totalPnlPct = baseline > 0 ? (totalPnl / baseline) * 100 : 0;
    const portfolioPnlPct =
      portYesterdayVal && portYesterdayVal > 0
        ? (portfolioPnl / portYesterdayVal) * 100
        : 0;
    const cryptoPnlPct =
      cryptoYesterdayVal && cryptoYesterdayVal > 0
        ? (cryptoPnl / cryptoYesterdayVal) * 100
        : 0;
    entries.push({
      date: today,
      portfolioPnl,
      cryptoPnl,
      totalPnl,
      totalPnlPct,
      portfolioPnlPct,
      cryptoPnlPct,
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
    const realizedConverted = convert(h.realizedPnlUsd ?? 0, "USD");
    // Total profit per token = unrealized (current − cost) + realized (locked
    // in from past sells) — matches what crypto exchanges report.
    const pnl = currentConverted - costConverted + realizedConverted;
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

// ---------------------------------------------------------------------------
// Reconstruct daily stock snapshots from transactions + historical closes
// ---------------------------------------------------------------------------

interface StockBar {
  date: string;
  close: number;
}

interface MinimalHolding {
  id: string;
  ticker: string;
  name?: string;
  accountType?: string;
}

/**
 * Replay portfolio_transactions against daily close prices to produce one
 * total-value snapshot per day (in USD). Skips super holdings — the calendar
 * already uses the no-super column for daily PnL.
 *
 * Result feeds computeDailyPnl as the portfolio_snapshots input, replacing
 * the cron-captured values that drift whenever CSVs/holdings are edited
 * backdated. This stays in sync with transactions by construction, so no
 * phantom losses/gains from snapshot/ledger mismatch.
 */
export function reconstructStockSnapshots(
  transactions: PortfolioTransaction[],
  holdings: MinimalHolding[],
  historicalBars: Record<string, StockBar[]>,
  fromDate: string,
  toDate: string,
): { date: string; value: number }[] {
  const superIds = new Set<string>();
  const superNames = new Set<string>();
  const tickerById = new Map<string, string>();
  // Name → ticker fallback so transactions referencing deleted/consolidated
  // holdingIds (e.g. duplicate "Initial holding" entries the user later
  // merged) still resolve to the right ticker via their holdingName.
  const tickerByName = new Map<string, string>();
  for (const h of holdings) {
    if (h.accountType === "super") {
      superIds.add(h.id);
      if (h.name) superNames.add(h.name.toLowerCase());
    }
    if (h.ticker) {
      tickerById.set(h.id, h.ticker.toUpperCase());
      if (h.name) tickerByName.set(h.name.toLowerCase(), h.ticker.toUpperCase());
    }
  }

  // Per-ticker date → close for O(1) lookup
  const closeLookup = new Map<string, Map<string, number>>();
  for (const [ticker, bars] of Object.entries(historicalBars)) {
    closeLookup.set(
      ticker.toUpperCase(),
      new Map(bars.map((b) => [b.date, b.close])),
    );
  }

  const resolveTicker = (tx: PortfolioTransaction): string | undefined => {
    return (
      tickerById.get(tx.holdingId) ??
      (tx.holdingName ? tickerByName.get(tx.holdingName.toLowerCase()) : undefined)
    );
  };

  const isSuper = (tx: PortfolioTransaction) =>
    superIds.has(tx.holdingId) ||
    (tx.holdingName ? superNames.has(tx.holdingName.toLowerCase()) : false);

  // Filter to non-super txns, sort chronologically
  const sorted = transactions
    .filter((t) => !isSuper(t))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const unitsByTicker = new Map<string, number>();
  const lastClose = new Map<string, number>();
  let txIdx = 0;

  const out: { date: string; value: number }[] = [];
  for (
    let d = new Date(`${fromDate}T00:00:00Z`);
    d <= new Date(`${toDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.toISOString().slice(0, 10);

    // Apply all txns with date <= EOD this day
    while (txIdx < sorted.length && sorted[txIdx].date.slice(0, 10) <= day) {
      const tx = sorted[txIdx];
      const ticker = resolveTicker(tx);
      if (ticker) {
        const sign = tx.type === "buy" ? 1 : -1;
        unitsByTicker.set(ticker, (unitsByTicker.get(ticker) ?? 0) + sign * tx.units);
      }
      txIdx++;
    }

    // Sum units × close for each ticker
    let total = 0;
    for (const [ticker, units] of unitsByTicker) {
      if (Math.abs(units) < 1e-8) continue;
      const close = closeLookup.get(ticker)?.get(day) ?? lastClose.get(ticker);
      if (close != null) {
        lastClose.set(ticker, close);
        total += units * close;
      }
    }
    out.push({ date: day, value: total });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Reconstruct daily crypto snapshots from CSV txns + historical prices
// ---------------------------------------------------------------------------

const STABLE_TOKENS = new Set([
  "USDT", "USDC", "USDE", "USD1", "DAI", "BUSD", "TUSD", "FDUSD", "GUSD",
]);

/**
 * Same idea as reconstructStockSnapshots but for crypto: replay CSV txns and
 * value EOD holdings against historical Binance closes.
 *
 * Price fallback chain per token per day:
 *   1. Stablecoin → $1
 *   2. Historical close from API
 *   3. Last historical close seen on a prior day (carry-forward)
 *   4. Last txn priceUsd seen for this token on/before this day (CSV
 *      provides ground-truth prices for tokens not on Binance like syrupUSDC,
 *      yield tokens, niche listings)
 *   5. 0 (give up)
 */
export function reconstructCryptoSnapshots(
  transactions: CryptoTransaction[],
  historicalBars: Record<string, { date: string; close: number }[]>,
  fromDate: string,
  toDate: string,
): { date: string; value: number }[] {
  const closeLookup = new Map<string, Map<string, number>>();
  for (const [token, bars] of Object.entries(historicalBars)) {
    closeLookup.set(
      token.toUpperCase(),
      new Map(bars.map((b) => [b.date, b.close])),
    );
  }

  const sorted = [...transactions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  const holdings = new Map<string, number>();
  const lastApiClose = new Map<string, number>();
  const lastTxnPrice = new Map<string, number>();
  let txIdx = 0;

  const out: { date: string; value: number }[] = [];
  for (
    let d = new Date(`${fromDate}T00:00:00Z`);
    d <= new Date(`${toDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.toISOString().slice(0, 10);

    while (txIdx < sorted.length && sorted[txIdx].date.slice(0, 10) <= day) {
      const tx = sorted[txIdx];
      const sign = tx.type === "buy" || tx.type === "transferIn" ? 1 : -1;
      holdings.set(tx.token, (holdings.get(tx.token) ?? 0) + sign * tx.amount);
      if (tx.priceUsd != null && tx.priceUsd > 0) {
        lastTxnPrice.set(tx.token, tx.priceUsd);
      }
      txIdx++;
    }

    let total = 0;
    for (const [token, amount] of holdings) {
      if (Math.abs(amount) < 1e-8) continue;
      const upper = token.toUpperCase();
      if (STABLE_TOKENS.has(upper)) {
        total += amount;
        continue;
      }
      const close =
        closeLookup.get(upper)?.get(day) ??
        lastApiClose.get(upper) ??
        lastTxnPrice.get(token);
      if (close != null) {
        if (closeLookup.get(upper)?.get(day) != null) {
          lastApiClose.set(upper, closeLookup.get(upper)!.get(day)!);
        }
        total += amount * close;
      }
    }
    out.push({ date: day, value: total });
  }

  return out;
}
