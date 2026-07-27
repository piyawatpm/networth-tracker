// Pure investment-performance math. No React, no app imports beyond siblings —
// keeps this module unit-testable with zero vitest config.
import type { PortfolioTransaction } from "./types";

export interface CashFlow {
  /** YYYY-MM-DD */
  date: string;
  /** Negative = money into the portfolio (buy), positive = money out (sell / terminal value). */
  amount: number;
}

const MS_PER_YEAR = 365 * 86400000;
const MIN_XIRR_SPAN_MS = 30 * 86400000;

/**
 * Annualized money-weighted return (Excel-compatible XIRR), as a decimal.
 * Newton-Raphson from 10%, falling back to bisection on [-0.9999, 1e6].
 * Null when: <2 flows, no sign change, span < 30 days, or no convergence.
 */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const pts = flows
    .map((f) => ({ t: Date.parse(f.date + "T00:00:00Z"), a: f.amount }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.a))
    .sort((x, y) => x.t - y.t);
  if (pts.length < 2) return null;
  if (pts[pts.length - 1].t - pts[0].t < MIN_XIRR_SPAN_MS) return null;
  const hasNeg = pts.some((p) => p.a < 0);
  const hasPos = pts.some((p) => p.a > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = pts[0].t;
  const npv = (r: number) =>
    pts.reduce((s, p) => s + p.a / Math.pow(1 + r, (p.t - t0) / MS_PER_YEAR), 0);
  const dNpv = (r: number) =>
    pts.reduce((s, p) => {
      const y = (p.t - t0) / MS_PER_YEAR;
      return s - (y * p.a) / Math.pow(1 + r, y + 1);
    }, 0);

  // Newton-Raphson — fast path for well-behaved rates.
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const f = npv(r);
    if (Math.abs(f) < 1e-7) return r;
    const d = dNpv(r);
    if (!Number.isFinite(d) || Math.abs(d) < 1e-12) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
  }

  // Bisection fallback — bracket a sign change, expanding hi geometrically.
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  while (fLo * fHi > 0 && hi < 1e6) {
    hi *= 10;
    fHi = npv(hi);
  }
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7 || (hi - lo) / 2 < 1e-9) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return null;
}

export interface DailyFlow {
  date: string;
  /** Net external flow that day in USD. Positive = money IN (buys), negative = money OUT (sells). */
  amount: number;
}

/** Net buys − sells per calendar day, in USD, ascending by date. */
export function netFlowsByDay(
  txs: PortfolioTransaction[],
  toUsd: (amount: number, from: string) => number,
  holdingFilter?: (holdingId: string) => boolean,
): DailyFlow[] {
  const byDay = new Map<string, number>();
  for (const t of txs) {
    if (holdingFilter && !holdingFilter(t.holdingId)) continue;
    const day = t.date.slice(0, 10);
    const usd = toUsd(t.totalAmount, t.currency);
    const signed = t.type === "buy" ? usd : -usd;
    byDay.set(day, (byDay.get(day) ?? 0) + signed);
  }
  return [...byDay.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .filter((f) => f.amount !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Cumulative net contributions over time (running sum of daily flows). */
export function buildContributionSeries(
  flows: DailyFlow[],
): { date: string; contributed: number }[] {
  let sum = 0;
  return flows.map((f) => {
    sum += f.amount;
    return { date: f.date, contributed: sum };
  });
}

export interface SnapshotLike {
  date: string;
  value: number;
  valueWithSuper?: number;
}

/** Normalize snapshots to one positive value per calendar day (last wins). */
export function dailySnapshotValues(
  snapshots: SnapshotLike[],
  includeSuper: boolean,
): { date: string; value: number }[] {
  const byDay = new Map<string, number>();
  const sorted = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const s of sorted) {
    const v = includeSuper ? (s.valueWithSuper ?? s.value) : s.value;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    byDay.set(s.date.slice(0, 10), v);
  }
  return [...byDay.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Time-weighted return over daily values. Sub-period return between
 * consecutive snapshots: r = (V_t − F) / V_prev − 1, where F = net flows
 * dated after the previous snapshot day up to and including this one
 * (end-of-period convention). Returns a growth-of-100 series.
 */
export function computeTwr(
  values: { date: string; value: number }[],
  flows: DailyFlow[],
): { series: { date: string; index: number }[]; totalReturn: number | null } {
  if (values.length < 2) return { series: [], totalReturn: null };
  const series: { date: string; index: number }[] = [{ date: values[0].date, index: 100 }];
  let index = 100;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    const flow = flows.reduce(
      (s, f) => (f.date > prev.date && f.date <= cur.date ? s + f.amount : s),
      0,
    );
    if (prev.value > 1e-9) {
      const r = (cur.value - flow) / prev.value - 1;
      index *= 1 + r;
    }
    series.push({ date: cur.date, index });
  }
  return { series, totalReturn: index / 100 - 1 };
}
