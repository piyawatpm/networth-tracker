// Pure investment-performance math. No React, no app imports beyond siblings —
// keeps this module unit-testable with zero vitest config.

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
