// Compound net-worth forecast — "at this pace, when do I get there, and
// what would it take to get there sooner?"
//
// Everything runs through ONE monthly simulation rather than closed-form
// annuity algebra: it stays honest when the contribution grows each year,
// when the return is zero or negative, and it makes the inverse questions
// (required saving, required return) a bisection over the same loop, so the
// forward and inverse answers can never disagree with each other.
//
// Model, per month:   nw ← nw × (1 + r_m) + saving
//                     saving grows by `contributionGrowthPct` once a year
// where r_m = (1 + annualReturnPct/100)^(1/12) − 1 (geometric, so a 7% year
// really compounds to 7%). Contributions land at month end.
//
// The iOS app carries a line-for-line port (Native/Forecast.swift); keep the
// two in step — they are meant to be diffed by eye.

export interface ForecastInputs {
  /** Net worth today, display currency. */
  netWorth: number;
  /** Money added per month (income − expenses), display currency. */
  monthlySaving: number;
  /** Long-run annual return on the whole net worth, percent (7 = 7%). */
  annualReturnPct: number;
  /** How much the monthly saving grows each year, percent (raises, etc). */
  contributionGrowthPct: number;
}

/** Hard horizon: past this the answer is "not on this path", not a date. */
export const FORECAST_MAX_MONTHS = 100 * 12;

export function monthlyRate(annualReturnPct: number): number {
  return Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
}

/**
 * Net worth after each of `months` months (index 0 = today), plus the
 * "savings only" path so a chart can show what compounding contributes.
 */
export function projectPath(
  inputs: ForecastInputs,
  months: number,
): { withGrowth: number[]; savingsOnly: number[] } {
  const r = monthlyRate(inputs.annualReturnPct);
  const withGrowth: number[] = [inputs.netWorth];
  const savingsOnly: number[] = [inputs.netWorth];
  let nw = inputs.netWorth;
  let flat = inputs.netWorth;
  let saving = inputs.monthlySaving;
  for (let m = 1; m <= months; m++) {
    if (m > 1 && (m - 1) % 12 === 0) saving *= 1 + inputs.contributionGrowthPct / 100;
    nw = nw * (1 + r) + saving;
    flat = flat + saving;
    withGrowth.push(nw);
    savingsOnly.push(flat);
  }
  return { withGrowth, savingsOnly };
}

/**
 * Months until net worth first reaches `target`; 0 when already there; null
 * when it never happens inside the horizon (shrinking or flat path).
 */
export function monthsToReach(inputs: ForecastInputs, target: number): number | null {
  if (inputs.netWorth >= target) return 0;
  const r = monthlyRate(inputs.annualReturnPct);
  let nw = inputs.netWorth;
  let saving = inputs.monthlySaving;
  for (let m = 1; m <= FORECAST_MAX_MONTHS; m++) {
    if (m > 1 && (m - 1) % 12 === 0) saving *= 1 + inputs.contributionGrowthPct / 100;
    nw = nw * (1 + r) + saving;
    if (nw >= target) return m;
  }
  return null;
}

/**
 * Smallest monthly saving that reaches `target` within `months` at the given
 * return — the "what would I need to put away" answer. Null when even an
 * absurd saving can't (months ≤ 0).
 */
export function requiredMonthlySaving(
  base: Omit<ForecastInputs, "monthlySaving">,
  target: number,
  months: number,
): number | null {
  if (months <= 0) return null;
  const reaches = (saving: number) =>
    (monthsToReach({ ...base, monthlySaving: saving }, target) ?? Infinity) <= months;
  if (reaches(0)) return 0;
  let lo = 0;
  let hi = Math.max(1, target); // saving the whole target monthly always works
  if (!reaches(hi)) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * Smallest annual return (percent) that reaches `target` within `months` at
 * the current saving. Null when nothing inside −50%…+100% does.
 */
export function requiredAnnualReturn(
  base: Omit<ForecastInputs, "annualReturnPct">,
  target: number,
  months: number,
): number | null {
  if (months <= 0) return null;
  const reaches = (pct: number) =>
    (monthsToReach({ ...base, annualReturnPct: pct }, target) ?? Infinity) <= months;
  let lo = -50;
  let hi = 100;
  if (reaches(lo)) return lo;
  if (!reaches(hi)) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/** "14y 7m", "8 months", "3 weeks" — a duration people say out loud. */
export function describeMonths(months: number): string {
  if (months <= 0) return "now";
  if (months < 1) return "under a month";
  const y = Math.floor(months / 12);
  const m = Math.round(months % 12);
  if (y === 0) return `${m} month${m === 1 ? "" : "s"}`;
  if (m === 0) return `${y} year${y === 1 ? "" : "s"}`;
  return `${y}y ${m}m`;
}

/**
 * The measured "pace" this app is built to report honestly: how fast net
 * worth grew BEYOND what was deposited — i.e. what the assets themselves
 * did. Annualised. Null when the window is under 90 days (a quarter of
 * one market swing is not a pace) or the numbers are unusable.
 *
 *   growth = nwEnd − nwStart − netSavings(window)
 *   pace   = growth / avg(nwStart, nwEnd) × 365 / days
 */
export function measuredAnnualPacePct(args: {
  nwStart: number;
  nwEnd: number;
  netSavingsInWindow: number;
  windowDays: number;
}): number | null {
  const { nwStart, nwEnd, netSavingsInWindow, windowDays } = args;
  if (windowDays < 90) return null;
  const avg = (nwStart + nwEnd) / 2;
  if (!(avg > 0)) return null;
  const growth = nwEnd - nwStart - netSavingsInWindow;
  const pct = (growth / avg) * (365 / windowDays) * 100;
  return Number.isFinite(pct) ? pct : null;
}

/**
 * Average monthly saving from the ledgers. Only months where BOTH income
 * and expenses were recorded count — a month with income and zero expenses
 * is a month before expense tracking started, not a month of perfect
 * frugality, and it would inflate the pace. Falls back to every month with
 * income when fewer than two such months exist.
 */
export function measuredMonthlySaving(
  monthly: { income: number; expenses: number }[],
): number | null {
  const complete = monthly.filter((m) => m.income > 0 && m.expenses > 0);
  const pool = complete.length >= 2 ? complete : monthly.filter((m) => m.income > 0);
  if (pool.length === 0) return null;
  return pool.reduce((s, m) => s + (m.income - m.expenses), 0) / pool.length;
}

/** Shared, synced assumptions (app_data key `forecast_assumptions`). */
export interface ForecastAssumptions {
  /** null = use the measured pace when available, else the balanced default. */
  annualReturnPct: number | null;
  /** null = use the measured monthly saving. */
  monthlySaving: number | null;
  contributionGrowthPct: number;
}

export const DEFAULT_ASSUMPTIONS: ForecastAssumptions = {
  annualReturnPct: null,
  monthlySaving: null,
  contributionGrowthPct: 0,
};

/** The long-run assumptions offered beside the measured pace. */
export const RETURN_PRESETS: { label: string; pct: number; note: string }[] = [
  { label: "Cautious", pct: 4, note: "bonds-heavy, or a rough decade" },
  { label: "Balanced", pct: 7, note: "long-run diversified equities" },
  { label: "Aggressive", pct: 10, note: "all-in growth, in a good era" },
];

/** Balanced is the fallback when nothing is measured yet. */
export const FALLBACK_RETURN_PCT = 7;

/**
 * The measured pace becomes the DEFAULT return only with a full year of
 * history behind it. Under that it is offered as a chip, never assumed —
 * a short window annualised is a mood, not a law.
 */
export const MEASURED_PACE_MIN_DAYS = 365;
