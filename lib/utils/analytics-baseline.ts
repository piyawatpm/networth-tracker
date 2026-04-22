import type {
  AnalyticsBaseline,
  CryptoDeposit,
  CryptoHolding,
  PortfolioHolding,
  PortfolioTransaction,
} from "./types";

// ---------------------------------------------------------------------------
// Capture baseline from current state
// ---------------------------------------------------------------------------

/**
 * Snapshot the current portfolio + crypto state as the starting point for
 * all PnL calculations going forward. Call when the user hits "Reset Baseline".
 * fxToUsd converts native holding currency to USD so totals are comparable.
 */
export function captureBaseline(params: {
  date: string;
  holdings: PortfolioHolding[];
  cryptoHoldings: CryptoHolding[];
  spy: number;
  btc: number;
  fxToUsd: (amount: number, currency: string) => number;
}): AnalyticsBaseline {
  const { date, holdings, cryptoHoldings, spy, btc, fxToUsd } = params;

  const portfolio: AnalyticsBaseline["portfolio"] = {};
  let portfolioUsd = 0;
  for (const h of holdings) {
    if (!h.units || h.units === 0) continue;
    const valueUsd = fxToUsd(h.currentValue, h.currency);
    const priceUsd = h.units > 0 ? valueUsd / h.units : 0;
    portfolio[h.id] = {
      units: h.units,
      priceUsd,
      valueUsd,
      currency: h.currency,
      accountType: h.accountType,
    };
    portfolioUsd += valueUsd;
  }

  const crypto: AnalyticsBaseline["crypto"] = {};
  let cryptoUsd = 0;
  for (const h of cryptoHoldings) {
    if (Math.abs(h.amount) < 1e-8) continue;
    const priceUsd = h.amount > 0 ? h.currentValueUsd / h.amount : 0;
    crypto[h.token] = {
      amount: h.amount,
      priceUsd,
      valueUsd: h.currentValueUsd,
    };
    cryptoUsd += h.currentValueUsd;
  }

  return {
    date,
    createdAt: Date.now(),
    portfolio,
    crypto,
    benchmarks: { spy, btc },
    totals: {
      portfolioUsd,
      cryptoUsd,
      combinedUsd: portfolioUsd + cryptoUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// Deposits → per-day USD map
// ---------------------------------------------------------------------------

/**
 * Build a YYYY-MM-DD → net USD deposit map from stock txns + crypto deposits.
 * Stock buys = positive deposit, sells = negative (withdrawal). Crypto deposits
 * are always positive (use negative `amount` for withdrawals if ever needed).
 * Days ≤ baselineDate are skipped — pre-baseline deposits are rolled into the
 * baseline value and should not count as new capital.
 */
export function depositsByDay(params: {
  portfolioTxns: PortfolioTransaction[];
  cryptoDeposits: CryptoDeposit[];
  baselineDate: string;
  fxToUsd: (amount: number, currency: string) => number;
}): Map<string, number> {
  const { portfolioTxns, cryptoDeposits, baselineDate, fxToUsd } = params;
  const map = new Map<string, number>();

  for (const tx of portfolioTxns) {
    const day = tx.date.slice(0, 10);
    if (day <= baselineDate) continue;
    const usd = fxToUsd(tx.totalAmount, tx.currency);
    const signed = tx.type === "buy" ? usd : -usd;
    map.set(day, (map.get(day) ?? 0) + signed);
  }

  for (const d of cryptoDeposits) {
    const day = d.date.slice(0, 10);
    if (day <= baselineDate) continue;
    map.set(day, (map.get(day) ?? 0) + d.usdValueAtDeposit);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Time-Weighted Return series
// ---------------------------------------------------------------------------

export interface TwrPoint {
  date: string;           // YYYY-MM-DD
  valueUsd: number;       // EOD total value
  depositsUsd: number;    // net deposits on this day
  rDay: number;           // daily return fraction (e.g. 0.012 = +1.2%)
  cumulativePct: number;  // cumulative return % since baseline (0 on baseline_date)
  deltaUsd: number;       // valueUsd − baselineValue − cumulative net deposits
}

/**
 * Walk days from baseline → today computing daily TWR.
 *
 * Formula per day d > baseline_date:
 *   r_d    = (V_d − V_{d-1} − deposits_d) / (V_{d-1} + deposits_d)
 *   cum_d  = Π(1 + r_i) − 1   for i in (baseline_date, d]
 *
 * On baseline_date itself, cumulativePct = 0 and rDay = 0.
 * If V_{d-1} + deposits_d ≤ 0 we skip the day and carry forward the prior
 * cumulative value — prevents divide-by-zero when the portfolio is briefly empty.
 */
export function computeTwrSeries(params: {
  baseline: AnalyticsBaseline;
  /** EOD total values by day (portfolio + crypto, USD). Must include baseline_date. */
  dailyValuesUsd: Map<string, number>;
  deposits: Map<string, number>;
  today: string;
  /** Optional live value for `today` — overrides dailyValuesUsd[today] when provided. */
  liveValueUsd?: number;
}): TwrPoint[] {
  const { baseline, dailyValuesUsd, deposits, today, liveValueUsd } = params;
  const out: TwrPoint[] = [];

  // Sorted list of unique days from baseline through today
  const days: string[] = [];
  for (let d = new Date(`${baseline.date}T00:00:00Z`);
       d <= new Date(`${today}T00:00:00Z`);
       d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }

  const baselineValue = baseline.totals.combinedUsd;
  let prevValue = baselineValue;
  let cumFactor = 1;
  let cumDeposits = 0;

  for (const day of days) {
    const isToday = day === today;
    const rawValue = isToday && liveValueUsd != null
      ? liveValueUsd
      : dailyValuesUsd.get(day);
    const value = rawValue ?? prevValue;     // carry-forward on gaps
    const dep = deposits.get(day) ?? 0;

    // Compute daily return for every day including baseline itself. Intraday
    // movement on baseline_date (live price ≠ baseline value) is a real
    // return, not zero. depositsByDay already excludes the baseline day so
    // cumDeposits stays at 0 until the first post-baseline deposit.
    let rDay = 0;
    const denom = prevValue + dep;
    if (denom > 0) {
      rDay = (value - prevValue - dep) / denom;
      cumFactor *= 1 + rDay;
    }
    cumDeposits += dep;

    out.push({
      date: day,
      valueUsd: value,
      depositsUsd: dep,
      rDay,
      cumulativePct: (cumFactor - 1) * 100,
      deltaUsd: value - baselineValue - cumDeposits,
    });
    prevValue = value;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Benchmark series (SPY, BTC) normalized to 0% on baseline_date
// ---------------------------------------------------------------------------

export interface BenchmarkPoint {
  date: string;
  cumulativePct: number;
}

export function computeBenchmarkSeries(params: {
  baselineDate: string;
  baselinePrice: number;
  bars: { date: string; close: number }[];
  today: string;
}): BenchmarkPoint[] {
  const { baselineDate, baselinePrice, bars, today } = params;
  if (baselinePrice <= 0) return [];

  // Lookup + carry-forward for weekends/holidays
  const byDay = new Map<string, number>(bars.map(b => [b.date, b.close]));
  const out: BenchmarkPoint[] = [];
  let lastClose = baselinePrice;

  for (let d = new Date(`${baselineDate}T00:00:00Z`);
       d <= new Date(`${today}T00:00:00Z`);
       d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const close = byDay.get(day) ?? lastClose;
    lastClose = close;
    out.push({ date: day, cumulativePct: (close / baselinePrice - 1) * 100 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-holding PnL since baseline
// ---------------------------------------------------------------------------

/**
 * PnL for a single holding from baseline → now. `baselineValueUsd` is 0 for
 * holdings that didn't exist at baseline (cost basis = deposits only).
 */
export function holdingPnlSinceBaseline(params: {
  baselineValueUsd: number;
  currentValueUsd: number;
  depositsToHoldingUsd: number;
}): { pnlUsd: number; pnlPct: number } {
  const { baselineValueUsd, currentValueUsd, depositsToHoldingUsd } = params;
  const pnlUsd = currentValueUsd - baselineValueUsd - depositsToHoldingUsd;
  const denom = baselineValueUsd + depositsToHoldingUsd;
  const pnlPct = denom > 0 ? (pnlUsd / denom) * 100 : 0;
  return { pnlUsd, pnlPct };
}
