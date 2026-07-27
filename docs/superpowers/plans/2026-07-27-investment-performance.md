# Investment Performance Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/performance` page that shows true investment performance (XIRR, TWR, net gain, vs S&P 500) for the stock portfolio, separated from top-up-driven net-worth growth.

**Architecture:** A pure math module (`lib/utils/performance.ts`, fully unit-tested) consumes the existing `portfolio_transactions` + `portfolio_snapshots` cloud-storage keys; a thin API route proxies SPY daily history from Yahoo; the page and its `_components/` render stats, two echarts line charts, and a per-holding table following the portfolio page's visual patterns.

**Tech Stack:** Next.js 16 App Router (client page), echarts via `@/components/ui/lazy-echarts`, vitest (new devDependency) for the math module only.

**Spec:** `docs/superpowers/specs/2026-07-27-investment-performance-design.md`

## Global Constraints

- All internal math in USD; convert to display currency only at render time via `useCurrency()`.
- `lib/utils/performance.ts` uses relative imports only (`./types`) so vitest needs no path-alias config.
- Snapshot `date` strings may be `"YYYY-MM-DD"` or `"YYYY-MM-DD HH:mm"` — always normalize with `.slice(0, 10)`; keep the LAST snapshot per calendar day.
- Orphan transactions (holdingId not in holdings) COUNT in portfolio-level math, treated as normal-account.
- XIRR renders "—" when null (no sign change or earliest flow < 30 days old).
- New UI must reuse existing idioms: `finance-card`, `label-mono`, `text-income`/`text-expense`, `BlurFade`, `getCartesianBaseOption`, `ECHARTS_COLORS`, range-selector button group from `history-chart.tsx`.
- No new storage keys; no writes to cloud storage from this page.

---

### Task 1: Vitest setup + XIRR

**Files:**
- Modify: `package.json` (add vitest devDependency + `"test": "vitest run"` script)
- Create: `lib/utils/performance.ts`
- Test: `lib/utils/__tests__/performance.test.ts`

**Interfaces:**
- Produces: `interface CashFlow { date: string; amount: number }` (date `YYYY-MM-DD`; amount negative = money in, positive = money out/terminal value)
- Produces: `function xirr(flows: CashFlow[]): number | null` — annualized rate as decimal (0.12 = 12%/yr), null when unsolvable or history < 30 days.

- [ ] **Step 1: Install vitest and add script**

```bash
npm install -D vitest
```

In `package.json` scripts add: `"test": "vitest run"`.

- [ ] **Step 2: Write failing XIRR tests**

Create `lib/utils/__tests__/performance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { xirr, type CashFlow } from "../performance";

describe("xirr", () => {
  it("matches Excel XIRR for a simple two-flow case", () => {
    // Excel: XIRR({-1000, 1100}, {2025-01-01, 2026-01-01}) = 0.10
    const flows: CashFlow[] = [
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount: 1100 },
    ];
    expect(xirr(flows)!).toBeCloseTo(0.1, 4);
  });

  it("matches Excel XIRR for multiple irregular flows", () => {
    // Excel: XIRR({-10000,-2500,-2500,17500},
    //             {2024-01-15,2024-06-10,2024-11-20,2025-12-31}) ≈ 0.129566
    const flows: CashFlow[] = [
      { date: "2024-01-15", amount: -10000 },
      { date: "2024-06-10", amount: -2500 },
      { date: "2024-11-20", amount: -2500 },
      { date: "2025-12-31", amount: 17500 },
    ];
    expect(xirr(flows)!).toBeCloseTo(0.129566, 3);
  });

  it("handles negative returns", () => {
    // Excel: XIRR({-1000, 800}, {2025-01-01, 2026-01-01}) = -0.20
    const flows: CashFlow[] = [
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount: 800 },
    ];
    expect(xirr(flows)!).toBeCloseTo(-0.2, 4);
  });

  it("returns null when all flows have the same sign", () => {
    expect(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2025-06-01", amount: -200 },
      ]),
    ).toBeNull();
  });

  it("returns null when history is shorter than 30 days", () => {
    expect(
      xirr([
        { date: "2026-07-10", amount: -1000 },
        { date: "2026-07-27", amount: 1050 },
      ]),
    ).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(xirr([])).toBeNull();
  });

  it("solves steep gains that break plain Newton (bisection fallback)", () => {
    // Excel: XIRR({-100, 500}, {2025-01-01, 2025-03-01}) ≈ 19553 %/yr — huge but solvable
    const flows: CashFlow[] = [
      { date: "2025-01-01", amount: -100 },
      { date: "2025-03-01", amount: 500 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    // Verify by plugging back into NPV: Σ amount / (1+r)^(days/365) ≈ 0
    const t0 = Date.parse("2025-01-01");
    const npv = flows.reduce(
      (s, f) => s + f.amount / Math.pow(1 + r!, (Date.parse(f.date) - t0) / 86400000 / 365),
      0,
    );
    expect(Math.abs(npv)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run lib/utils/__tests__/performance.test.ts`
Expected: FAIL — `performance.ts` doesn't exist / `xirr` not exported.

- [ ] **Step 4: Implement `xirr` in `lib/utils/performance.ts`**

```ts
// Pure investment-performance math. No React, no app imports beyond ./types —
// keeps this module unit-testable with zero vitest config.
import type { PortfolioHolding, PortfolioTransaction } from "./types";

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

  // Newton-Raphson
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
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run lib/utils/__tests__/performance.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/utils/performance.ts lib/utils/__tests__/performance.test.ts
git commit -m "feat(performance): add XIRR solver with vitest setup"
```

---

### Task 2: Contribution series + TWR

**Files:**
- Modify: `lib/utils/performance.ts`
- Test: `lib/utils/__tests__/performance.test.ts` (append)

**Interfaces:**
- Consumes: `CashFlow` from Task 1.
- Produces:
  - `interface DailyFlow { date: string; amount: number }` (net external flow per day, USD; buys positive = money IN)
  - `function netFlowsByDay(txs: PortfolioTransaction[], toUsd: (amount: number, from: string) => number, holdingFilter?: (holdingId: string) => boolean): DailyFlow[]` — sorted ascending by date.
  - `function buildContributionSeries(flows: DailyFlow[]): { date: string; contributed: number }[]` — cumulative running sum.
  - `interface SnapshotLike { date: string; value: number; valueWithSuper?: number }`
  - `function dailySnapshotValues(snapshots: SnapshotLike[], includeSuper: boolean): { date: string; value: number }[]` — normalized to `YYYY-MM-DD`, last-per-day, sorted, zero/negative values dropped.
  - `function computeTwr(values: { date: string; value: number }[], flows: DailyFlow[]): { series: { date: string; index: number }[]; totalReturn: number | null }` — `index` starts at 100; flows dated ≤ a snapshot day and > the previous snapshot day belong to that sub-period (end-of-period convention).

- [ ] **Step 1: Append failing tests**

```ts
import {
  netFlowsByDay,
  buildContributionSeries,
  dailySnapshotValues,
  computeTwr,
  type DailyFlow,
} from "../performance";
import type { PortfolioTransaction } from "../types";

const tx = (o: Partial<PortfolioTransaction>): PortfolioTransaction => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  holdingId: o.holdingId ?? "h1",
  holdingName: o.holdingName ?? "Test",
  type: o.type ?? "buy",
  units: o.units ?? 1,
  pricePerUnit: o.pricePerUnit ?? 100,
  totalAmount: o.totalAmount ?? 100,
  currency: o.currency ?? "USD",
  date: o.date ?? "2026-01-01",
  notes: o.notes ?? "",
  createdAt: o.createdAt ?? 1,
});

describe("netFlowsByDay", () => {
  it("nets buys and sells per day and converts currency", () => {
    const txs = [
      tx({ date: "2026-01-05", type: "buy", totalAmount: 100, currency: "USD" }),
      tx({ date: "2026-01-05", type: "sell", totalAmount: 40, currency: "USD" }),
      tx({ date: "2026-01-02", type: "buy", totalAmount: 200, currency: "AUD" }),
    ];
    // Fake FX: 1 AUD = 0.5 USD
    const toUsd = (a: number, c: string) => (c === "AUD" ? a * 0.5 : a);
    expect(netFlowsByDay(txs, toUsd)).toEqual([
      { date: "2026-01-02", amount: 100 },
      { date: "2026-01-05", amount: 60 },
    ]);
  });

  it("applies the holding filter", () => {
    const txs = [
      tx({ date: "2026-01-02", holdingId: "keep", totalAmount: 100 }),
      tx({ date: "2026-01-03", holdingId: "skip", totalAmount: 999 }),
    ];
    const flows = netFlowsByDay(txs, (a) => a, (id) => id === "keep");
    expect(flows).toEqual([{ date: "2026-01-02", amount: 100 }]);
  });
});

describe("buildContributionSeries", () => {
  it("accumulates flows; sells reduce contributions", () => {
    const flows: DailyFlow[] = [
      { date: "2026-01-02", amount: 100 },
      { date: "2026-01-05", amount: 60 },
      { date: "2026-02-01", amount: -30 },
    ];
    expect(buildContributionSeries(flows)).toEqual([
      { date: "2026-01-02", contributed: 100 },
      { date: "2026-01-05", contributed: 160 },
      { date: "2026-02-01", contributed: 130 },
    ]);
  });
});

describe("dailySnapshotValues", () => {
  it("normalizes datetimes, keeps last per day, picks super field, drops zeros", () => {
    const snaps = [
      { date: "2026-01-01 06:00", value: 90, valueWithSuper: 100 },
      { date: "2026-01-01 18:00", value: 95, valueWithSuper: 105 },
      { date: "2026-01-02", value: 0, valueWithSuper: 0 },
      { date: "2026-01-03", value: 98, valueWithSuper: 110 },
    ];
    expect(dailySnapshotValues(snaps, true)).toEqual([
      { date: "2026-01-01", value: 105 },
      { date: "2026-01-03", value: 110 },
    ]);
    expect(dailySnapshotValues(snaps, false)[0]).toEqual({ date: "2026-01-01", value: 95 });
  });
});

describe("computeTwr", () => {
  it("is flat when growth comes only from a deposit", () => {
    // Day1: 100. Day2: deposit 100, value 200 → return 0%.
    const values = [
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 200 },
    ];
    const flows: DailyFlow[] = [{ date: "2026-01-02", amount: 100 }];
    const { series, totalReturn } = computeTwr(values, flows);
    expect(totalReturn!).toBeCloseTo(0, 6);
    expect(series[1].index).toBeCloseTo(100, 6);
  });

  it("chains sub-period returns across snapshot gaps", () => {
    // 100 → 110 (+10%), gap, deposit 50 then value 176: (176-50)/110 ≈ +14.545%
    const values = [
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 110 },
      { date: "2026-01-05", value: 176 },
    ];
    const flows: DailyFlow[] = [{ date: "2026-01-04", amount: 50 }];
    const { totalReturn } = computeTwr(values, flows);
    expect(totalReturn!).toBeCloseTo(1.1 * (126 / 110) - 1, 6);
  });

  it("handles withdrawals (negative flows)", () => {
    // 100 → withdraw 20, value 85: (85+20)/100 = +5%
    const values = [
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 85 },
    ];
    const flows: DailyFlow[] = [{ date: "2026-01-02", amount: -20 }];
    expect(computeTwr(values, flows).totalReturn!).toBeCloseTo(0.05, 6);
  });

  it("returns null totalReturn with fewer than 2 snapshots", () => {
    expect(computeTwr([{ date: "2026-01-01", value: 100 }], []).totalReturn).toBeNull();
    expect(computeTwr([], []).totalReturn).toBeNull();
  });

  it("skips degenerate sub-periods where the denominator is ~0", () => {
    const values = [
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 100.000001 },
      { date: "2026-01-03", value: 110 },
    ];
    // Flow equals prior value → denominator (V_prev) fine, but flow > V_t case:
    const flows: DailyFlow[] = [{ date: "2026-01-03", amount: 200 }];
    // (110 - 200) / 100 would be -90% from a mistimed flow; the function still
    // computes it (data is data) — this test just pins the behavior.
    const { totalReturn } = computeTwr(values, flows);
    expect(totalReturn).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify new ones fail**

Run: `npx vitest run lib/utils/__tests__/performance.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement in `lib/utils/performance.ts`**

```ts
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
 * consecutive snapshots: r = (V_t − F) / V_prev, where F = net flows dated
 * after the previous snapshot day up to and including this one
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
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run lib/utils/__tests__/performance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/performance.ts lib/utils/__tests__/performance.test.ts
git commit -m "feat(performance): add contribution series and TWR chaining"
```

---

### Task 3: Per-holding stats + cost-basis drift guard

**Files:**
- Modify: `lib/utils/performance.ts`
- Test: `lib/utils/__tests__/performance.test.ts` (append)

**Interfaces:**
- Consumes: `xirr`, `CashFlow` (Task 1); `derivePosition` from `./portfolio-transactions`.
- Produces:
  - `interface HoldingPerfRow { holdingId: string; name: string; ticker: string; isOrphan: boolean; accountType: "normal" | "super"; investedUsd: number; valueUsd: number; gainUsd: number; returnPct: number | null; xirrPct: number | null; closed: boolean }`
  - `function perHoldingStats(holdings: PortfolioHolding[], txs: PortfolioTransaction[], toUsd: (amount: number, from: string) => number, todayIso: string): HoldingPerfRow[]` — one row per holding with txs, plus ONE aggregate orphan row (`holdingId: "__removed__"`, name "Removed holdings") when orphan txs exist. Sorted by `xirrPct` desc, nulls last, orphan row last.
  - `function costBasisDrift(holdings: PortfolioHolding[], txs: PortfolioTransaction[], toUsd: (amount: number, from: string) => number): { holdingId: string; name: string; investedUsd: number; txCostUsd: number }[]` — rows where the holding's manual `amountInvested` differs from tx-derived cost basis by >1% AND >$1 USD (holdings with zero txs count as drifted when `amountInvested > 0`... no — user confirmed all buys logged; a holding with NO txs and amountInvested > 0 IS the drift case to flag).

- [ ] **Step 1: Append failing tests**

```ts
import { perHoldingStats, costBasisDrift } from "../performance";
import type { PortfolioHolding } from "../types";

const holding = (o: Partial<PortfolioHolding>): PortfolioHolding => ({
  id: o.id ?? "h1",
  name: o.name ?? "Test Co",
  ticker: o.ticker ?? "TST",
  type: o.type ?? "stock",
  accountType: o.accountType ?? "normal",
  broker: "", country: "US", link: "",
  units: o.units ?? 10,
  amountInvested: o.amountInvested ?? 1000,
  currentValue: o.currentValue ?? 1200,
  currency: o.currency ?? "USD",
  notes: "", createdAt: 1,
});

const idUsd = (a: number) => a;

describe("perHoldingStats", () => {
  it("computes invested, value, gain and return for an open holding", () => {
    const h = holding({ id: "h1", amountInvested: 1000, currentValue: 1200 });
    const txs = [tx({ holdingId: "h1", date: "2025-01-01", totalAmount: 1000, units: 10, pricePerUnit: 100 })];
    const rows = perHoldingStats([h], txs, idUsd, "2026-07-27");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.investedUsd).toBeCloseTo(1000);
    expect(r.valueUsd).toBeCloseTo(1200);
    expect(r.gainUsd).toBeCloseTo(200);
    expect(r.returnPct).toBeCloseTo(0.2, 6);
    expect(r.xirrPct).toBeCloseTo(0.125, 2); // ~12.5%/yr over ~1.57yr
    expect(r.closed).toBe(false);
  });

  it("includes realized P&L in gain for a partially sold holding", () => {
    const h = holding({ id: "h1", currentValue: 660 });
    const txs = [
      tx({ holdingId: "h1", date: "2025-01-01", type: "buy", units: 10, totalAmount: 1000, pricePerUnit: 100 }),
      tx({ holdingId: "h1", date: "2025-06-01", type: "sell", units: 5, totalAmount: 600, pricePerUnit: 120 }),
    ];
    const r = perHoldingStats([h], txs, idUsd, "2026-07-27")[0];
    // realized = 600 − 500 = 100; unrealized = 660 − 500 = 160; gain = 260
    expect(r.gainUsd).toBeCloseTo(260);
    // returnPct = gain / gross buys = 260 / 1000
    expect(r.returnPct).toBeCloseTo(0.26, 6);
  });

  it("marks fully-sold holdings closed and skips terminal value in XIRR", () => {
    const h = holding({ id: "h1", units: 0, currentValue: 0 });
    const txs = [
      tx({ holdingId: "h1", date: "2025-01-01", type: "buy", units: 10, totalAmount: 1000 }),
      tx({ holdingId: "h1", date: "2026-01-01", type: "sell", units: 10, totalAmount: 1100 }),
    ];
    const r = perHoldingStats([h], txs, idUsd, "2026-07-27")[0];
    expect(r.closed).toBe(true);
    expect(r.xirrPct).toBeCloseTo(0.1, 3);
  });

  it("aggregates orphan transactions into one removed-holdings row", () => {
    const txs = [
      tx({ holdingId: "gone", holdingName: "Sold Co", date: "2025-01-01", type: "buy", totalAmount: 500 }),
      tx({ holdingId: "gone", holdingName: "Sold Co", date: "2025-12-01", type: "sell", totalAmount: 450 }),
    ];
    const rows = perHoldingStats([], txs, idUsd, "2026-07-27");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.holdingId).toBe("__removed__");
    expect(r.isOrphan).toBe(true);
    expect(r.gainUsd).toBeCloseTo(-50);
    expect(r.closed).toBe(true);
  });

  it("skips holdings with no transactions", () => {
    expect(perHoldingStats([holding({ id: "h9" })], [], idUsd, "2026-07-27")).toHaveLength(0);
  });
});

describe("costBasisDrift", () => {
  it("flags holdings whose manual invested amount drifts >1% and >$1 from tx cost basis", () => {
    const drifted = holding({ id: "d1", name: "Drifty", amountInvested: 2000 });
    const clean = holding({ id: "c1", name: "Clean", amountInvested: 1000 });
    const txs = [
      tx({ holdingId: "d1", date: "2025-01-01", totalAmount: 1000 }),
      tx({ holdingId: "c1", date: "2025-01-01", totalAmount: 1000 }),
    ];
    const out = costBasisDrift([drifted, clean], txs, idUsd);
    expect(out).toHaveLength(1);
    expect(out[0].holdingId).toBe("d1");
    expect(out[0].investedUsd).toBeCloseTo(2000);
    expect(out[0].txCostUsd).toBeCloseTo(1000);
  });

  it("flags a holding with invested amount but zero transactions", () => {
    const h = holding({ id: "h1", amountInvested: 500 });
    const out = costBasisDrift([h], [], idUsd);
    expect(out).toHaveLength(1);
    expect(out[0].txCostUsd).toBe(0);
  });

  it("ignores sub-1% drift", () => {
    const h = holding({ id: "h1", amountInvested: 1005 });
    const txs = [tx({ holdingId: "h1", date: "2025-01-01", totalAmount: 1000 })];
    expect(costBasisDrift([h], txs, idUsd)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests, verify new ones fail**

Run: `npx vitest run lib/utils/__tests__/performance.test.ts`
Expected: FAIL — `perHoldingStats` / `costBasisDrift` not exported.

- [ ] **Step 3: Implement in `lib/utils/performance.ts`**

Add import at top: `import { derivePosition } from "./portfolio-transactions";`

```ts
export interface HoldingPerfRow {
  holdingId: string;
  name: string;
  ticker: string;
  isOrphan: boolean;
  accountType: "normal" | "super";
  investedUsd: number; // remaining cost basis (avg-cost) in USD
  valueUsd: number;
  gainUsd: number; // unrealized + realized
  returnPct: number | null; // gain / gross buys
  xirrPct: number | null;
  closed: boolean;
}

/** Per-holding performance rows + one aggregate row for orphaned (deleted-holding) txs. */
export function perHoldingStats(
  holdings: PortfolioHolding[],
  txs: PortfolioTransaction[],
  toUsd: (amount: number, from: string) => number,
  todayIso: string,
): HoldingPerfRow[] {
  const rows: HoldingPerfRow[] = [];
  const holdingIds = new Set(holdings.map((h) => h.id));

  for (const h of holdings) {
    const own = txs.filter((t) => t.holdingId === h.id);
    if (own.length === 0) continue;
    const pos = derivePosition(own, "USD", (a, from) => toUsd(a, from));
    const valueUsd = h.units > 0 ? toUsd(h.currentValue, h.currency) : 0;
    const grossBuysUsd = own
      .filter((t) => t.type === "buy")
      .reduce((s, t) => s + toUsd(t.totalAmount, t.currency), 0);
    const gainUsd = valueUsd - pos.costBasis + pos.realizedPnl;
    const flows: CashFlow[] = own.map((t) => ({
      date: t.date.slice(0, 10),
      amount: t.type === "buy" ? -toUsd(t.totalAmount, t.currency) : toUsd(t.totalAmount, t.currency),
    }));
    const closed = h.units <= 0;
    if (!closed && valueUsd > 0) flows.push({ date: todayIso, amount: valueUsd });
    rows.push({
      holdingId: h.id,
      name: h.name,
      ticker: h.ticker,
      isOrphan: false,
      accountType: h.accountType === "super" ? "super" : "normal",
      investedUsd: pos.costBasis,
      valueUsd,
      gainUsd,
      returnPct: grossBuysUsd > 0 ? gainUsd / grossBuysUsd : null,
      xirrPct: xirr(flows),
      closed,
    });
  }

  // Orphans: transactions whose holding was deleted. Real history — aggregate.
  const orphanTxs = txs.filter((t) => !holdingIds.has(t.holdingId));
  if (orphanTxs.length > 0) {
    const pos = derivePosition(orphanTxs, "USD", (a, from) => toUsd(a, from));
    const grossBuysUsd = orphanTxs
      .filter((t) => t.type === "buy")
      .reduce((s, t) => s + toUsd(t.totalAmount, t.currency), 0);
    // No live value for deleted holdings — only realized P&L survives.
    const gainUsd = pos.realizedPnl - pos.costBasis;
    const flows: CashFlow[] = orphanTxs.map((t) => ({
      date: t.date.slice(0, 10),
      amount: t.type === "buy" ? -toUsd(t.totalAmount, t.currency) : toUsd(t.totalAmount, t.currency),
    }));
    rows.push({
      holdingId: "__removed__",
      name: "Removed holdings",
      ticker: "",
      isOrphan: true,
      accountType: "normal",
      investedUsd: pos.costBasis,
      valueUsd: 0,
      gainUsd,
      returnPct: grossBuysUsd > 0 ? gainUsd / grossBuysUsd : null,
      xirrPct: xirr(flows),
      closed: true,
    });
  }

  return rows.sort((a, b) => {
    if (a.isOrphan !== b.isOrphan) return a.isOrphan ? 1 : -1;
    if (a.xirrPct == null && b.xirrPct == null) return b.gainUsd - a.gainUsd;
    if (a.xirrPct == null) return 1;
    if (b.xirrPct == null) return -1;
    return b.xirrPct - a.xirrPct;
  });
}

export interface DriftRow {
  holdingId: string;
  name: string;
  investedUsd: number;
  txCostUsd: number;
}

/** Holdings whose manual amountInvested disagrees with tx-derived cost basis (>1% and >$1). */
export function costBasisDrift(
  holdings: PortfolioHolding[],
  txs: PortfolioTransaction[],
  toUsd: (amount: number, from: string) => number,
): DriftRow[] {
  const out: DriftRow[] = [];
  for (const h of holdings) {
    const own = txs.filter((t) => t.holdingId === h.id);
    const txCostUsd =
      own.length > 0 ? derivePosition(own, "USD", (a, from) => toUsd(a, from)).costBasis : 0;
    const investedUsd = toUsd(h.amountInvested ?? 0, h.currency);
    const diff = Math.abs(investedUsd - txCostUsd);
    const base = Math.max(investedUsd, txCostUsd);
    if (base <= 0) continue;
    if (diff > 1 && diff / base > 0.01) {
      out.push({ holdingId: h.id, name: h.name, investedUsd, txCostUsd });
    }
  }
  return out;
}
```

NOTE: `derivePosition`'s converter signature is `(amount, from, to?) => number`; the wrapper `(a, from) => toUsd(a, from)` satisfies it because `derivePosition` always calls it with `targetCurrency` as the third arg, which the wrapper ignores — the wrapper IS the USD conversion. Pass `"USD"` as `targetCurrency` for clarity.

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/performance.ts lib/utils/__tests__/performance.test.ts
git commit -m "feat(performance): per-holding stats with orphan aggregation + drift guard"
```

---

### Task 4: Benchmark API route

**Files:**
- Create: `app/api/benchmark/route.ts`

**Interfaces:**
- Produces: `GET /api/benchmark?from=YYYY-MM-DD` → `{ symbol: "SPY", prices: { date: string; close: number }[] }` (dates ascending, `YYYY-MM-DD`). 502 with `{ error }` on upstream failure. No test file (network proxy; verified manually in Task 8).

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";

// Daily-close history for the benchmark index (SPY). Same unofficial Yahoo
// chart endpoint the snapshot cron already relies on, so no new upstream.
const SYMBOL = "SPY";

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  // period1 must predate the requested window slightly so the first close
  // exists on or before `from` (weekends/holidays).
  const fromMs = from ? Date.parse(from + "T00:00:00Z") - 14 * 86400000 : Date.parse("2020-01-01");
  const period1 = Math.floor((Number.isFinite(fromMs) ? fromMs : Date.parse("2020-01-01")) / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}?interval=1d&period1=${period1}&period2=${period2}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
        next: { revalidate: 21600 }, // 6h — daily closes don't need more
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps: number[] | undefined = result?.timestamp;
    const closes: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closes)) {
      return NextResponse.json({ error: "malformed upstream payload" }, { status: 502 });
    }
    const prices: { date: string; close: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (typeof c !== "number" || !Number.isFinite(c)) continue;
      prices.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: c });
    }
    return NextResponse.json(
      { symbol: SYMBOL, prices },
      { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "benchmark fetch failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Smoke-test locally**

Run: `npm run dev` (background), then `curl -s "http://localhost:3000/api/benchmark?from=2026-01-01" | head -c 300`
Expected: JSON starting `{"symbol":"SPY","prices":[{"date":"2025-12-..."`. Stop dev server after.

- [ ] **Step 3: Commit**

```bash
git add app/api/benchmark/route.ts
git commit -m "feat(performance): add SPY benchmark history API route"
```

---

### Task 5: Page skeleton — data wiring, controls, stats row, nav entry

**Files:**
- Create: `app/(app)/performance/page.tsx`
- Create: `app/(app)/performance/_components/perf-stats.tsx`
- Modify: `app/(app)/layout.tsx` (SECONDARY_NAV first entry + `LineChart` icon import)

**Interfaces:**
- Consumes: everything exported by `lib/utils/performance.ts` (Tasks 1–3); `useCloudStorage`, `useCurrency`; `GET /api/benchmark` (Task 4).
- Produces (used by Tasks 6–7):
  - Page-level state: `period: "3M" | "6M" | "1Y" | "All"` (default `"All"`), `includeSuper: boolean` (default `true`).
  - `spy: { date: string; close: number }[] | null` fetched once on mount (localStorage cache key `benchmark_spy_cache`, `{fetchedAt, prices}`, 12h TTL).
  - `<PerfStats>` props: `{ xirrPct: number | null; twrPct: number | null; twrLabel: string; netGainUsd: number; dividendsUsd: number; vsSpyPct: number | null }` — all USD values formatted inside via `useCurrency().convert(v, "USD")`.

- [ ] **Step 1: Create `perf-stats.tsx`**

```tsx
"use client";

import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";

function pct(v: number | null): string {
  if (v == null) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export function PerfStats({
  xirrPct,
  twrPct,
  twrLabel,
  netGainUsd,
  dividendsUsd,
  vsSpyPct,
}: {
  xirrPct: number | null;
  twrPct: number | null;
  twrLabel: string;
  netGainUsd: number;
  dividendsUsd: number;
  vsSpyPct: number | null;
}) {
  const { format, convert } = useCurrency();
  const gain = convert(netGainUsd, "USD");
  const divs = convert(dividendsUsd, "USD");

  const tiles = [
    {
      label: "XIRR / YR",
      value: pct(xirrPct),
      tone: xirrPct == null ? "muted" : xirrPct >= 0 ? "up" : "down",
      sub: "money-weighted, annualized",
    },
    {
      label: `TWR · ${twrLabel}`,
      value: pct(twrPct),
      tone: twrPct == null ? "muted" : twrPct >= 0 ? "up" : "down",
      sub: "strategy return, deposits stripped",
    },
    {
      label: "NET GAIN",
      value: `${gain >= 0 ? "+" : "-"}${format(Math.abs(gain))}`,
      tone: gain >= 0 ? "up" : "down",
      sub: divs > 0 ? `+ ${format(divs)} dividends received` : "value − net contributions",
    },
    {
      label: "VS S&P 500",
      value: vsSpyPct == null ? "—" : `${vsSpyPct >= 0 ? "+" : ""}${(vsSpyPct * 100).toFixed(1)}pp`,
      tone: vsSpyPct == null ? "muted" : vsSpyPct >= 0 ? "up" : "down",
      sub: "TWR minus SPY, same period",
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t, i) => (
        <BlurFade key={t.label} delay={0.05 + i * 0.05}>
          <div className="finance-card p-4 sm:p-5">
            <p className="label-mono mb-1.5">{t.label}</p>
            <p
              className={cn(
                "text-xl sm:text-2xl font-semibold tabular-nums",
                t.tone === "up" && "text-income",
                t.tone === "down" && "text-expense",
                t.tone === "muted" && "text-muted-foreground",
              )}
            >
              {t.value}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">{t.sub}</p>
          </div>
        </BlurFade>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `page.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry, PortfolioHolding, PortfolioTransaction } from "@/lib/utils/types";
import {
  buildContributionSeries,
  computeTwr,
  costBasisDrift,
  dailySnapshotValues,
  netFlowsByDay,
  perHoldingStats,
  xirr,
  type CashFlow,
  type SnapshotLike,
} from "@/lib/utils/performance";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { PerfStats } from "./_components/perf-stats";
import { ValueContributionsChart } from "./_components/value-contributions-chart";
import { GrowthChart } from "./_components/growth-chart";
import { HoldingsPerformanceTable } from "./_components/holdings-performance-table";

type Period = "3M" | "6M" | "1Y" | "All";
const PERIODS: Period[] = ["3M", "6M", "1Y", "All"];
const PERIOD_DAYS: Record<Exclude<Period, "All">, number> = { "3M": 90, "6M": 180, "1Y": 365 };

interface SpyCache {
  fetchedAt: number;
  prices: { date: string; close: number }[];
}

export default function PerformancePage() {
  const [holdings] = useCloudStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [transactions] = useCloudStorage<PortfolioTransaction[]>("portfolio_transactions", []);
  const [snapshots] = useCloudStorage<SnapshotLike[]>("portfolio_snapshots", []);
  const [incomeEntries] = useCloudStorage<IncomeEntry[]>("income_entries", []);
  const { convert, format } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [period, setPeriod] = useState<Period>("All");
  const [includeSuper, setIncludeSuper] = useState(true);
  const [spy, setSpy] = useState<SpyCache["prices"] | null>(null);

  const today = getSydneyDateString();
  const toUsd = useMemo(
    () => (amount: number, from: string) => convert(amount, from, "USD"),
    [convert],
  );

  // ── SPY history: localStorage-cached 12h, hides benchmark UI on failure ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem("benchmark_spy_cache");
        if (raw) {
          const cached = JSON.parse(raw) as SpyCache;
          if (Date.now() - cached.fetchedAt < 12 * 3600_000 && cached.prices?.length) {
            setSpy(cached.prices);
            return;
          }
        }
      } catch { /* refetch */ }
      try {
        const res = await fetch("/api/benchmark?from=2020-01-01");
        if (!res.ok) return;
        const data = (await res.json()) as { prices: SpyCache["prices"] };
        if (cancelled || !data.prices?.length) return;
        setSpy(data.prices);
        localStorage.setItem(
          "benchmark_spy_cache",
          JSON.stringify({ fetchedAt: Date.now(), prices: data.prices } satisfies SpyCache),
        );
      } catch { /* benchmark stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Core derived data (all USD) ──
  const superIds = useMemo(
    () => new Set(holdings.filter((h) => h.accountType === "super").map((h) => h.id)),
    [holdings],
  );
  const holdingFilter = useMemo(
    () => (includeSuper ? undefined : (id: string) => !superIds.has(id)),
    [includeSuper, superIds],
  );

  const flows = useMemo(
    () => netFlowsByDay(transactions, toUsd, holdingFilter),
    [transactions, toUsd, holdingFilter],
  );
  const contributions = useMemo(() => buildContributionSeries(flows), [flows]);
  const values = useMemo(
    () => dailySnapshotValues(snapshots, includeSuper),
    [snapshots, includeSuper],
  );

  const periodStart = useMemo(() => {
    if (period === "All") return "0000-00-00";
    const d = new Date(Date.now() - PERIOD_DAYS[period] * 86400000);
    return d.toISOString().slice(0, 10);
  }, [period]);

  const periodValues = useMemo(
    () => values.filter((v) => v.date >= periodStart),
    [values, periodStart],
  );
  const twr = useMemo(() => computeTwr(periodValues, flows), [periodValues, flows]);

  const currentValueUsd = useMemo(
    () =>
      holdings
        .filter((h) => h.type !== "savings" && (includeSuper || h.accountType !== "super"))
        .reduce((s, h) => s + toUsd(h.currentValue ?? 0, h.currency), 0),
    [holdings, includeSuper, toUsd],
  );

  const xirrAllTime = useMemo(() => {
    const cf: CashFlow[] = flows.map((f) => ({ date: f.date, amount: -f.amount }));
    if (currentValueUsd > 0) cf.push({ date: today, amount: currentValueUsd });
    return xirr(cf);
  }, [flows, currentValueUsd, today]);

  const netContributedUsd = useMemo(() => flows.reduce((s, f) => s + f.amount, 0), [flows]);
  const netGainUsd = currentValueUsd - netContributedUsd;

  const dividendsUsd = useMemo(
    () =>
      incomeEntries
        .filter((e) => e.type === "dividend")
        .reduce((s, e) => s + toUsd(e.amount, e.currency), 0),
    [incomeEntries, toUsd],
  );

  // ── SPY return over the SAME window TWR covers ──
  const spyStats = useMemo(() => {
    if (!spy || spy.length === 0 || twr.series.length < 2) return null;
    const start = twr.series[0].date;
    const end = twr.series[twr.series.length - 1].date;
    const inWindow = spy.filter((p) => p.date >= start && p.date <= end);
    if (inWindow.length < 2) return null;
    const base = inWindow[0].close;
    return {
      series: inWindow.map((p) => ({ date: p.date, index: (p.close / base) * 100 })),
      totalReturn: inWindow[inWindow.length - 1].close / base - 1,
    };
  }, [spy, twr.series]);

  const drift = useMemo(
    () => costBasisDrift(holdings, transactions, toUsd),
    [holdings, transactions, toUsd],
  );
  const holdingRows = useMemo(
    () =>
      perHoldingStats(
        includeSuper ? holdings : holdings.filter((h) => h.accountType !== "super"),
        holdingFilter ? transactions.filter((t) => holdingFilter(t.holdingId) || !holdings.some((h) => h.id === t.holdingId)) : transactions,
        toUsd,
        today,
      ),
    [holdings, transactions, toUsd, today, includeSuper, holdingFilter],
  );

  return (
    <div className="space-y-6">
      {/* ── Header + controls ── */}
      <BlurFade>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Performance</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              What your money earned — top-ups stripped out. Stocks only for now.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIncludeSuper((v) => !v)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                includeSuper
                  ? "bg-secondary text-foreground border-transparent"
                  : "text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {includeSuper ? "Super: in" : "Super: out"}
            </button>
            <div className="flex items-center gap-0.5 rounded-lg bg-secondary p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                    period === p
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </BlurFade>

      {/* ── Data-quality banner ── */}
      {drift.length > 0 && (
        <BlurFade delay={0.03}>
          <div className="finance-card border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium mb-0.5">
                {drift.length} {drift.length === 1 ? "holding" : "holdings"} missing buy history
              </p>
              <p className="text-muted-foreground">
                {drift.map((d) => d.name).join(", ")} — invested amount doesn&apos;t match logged
                transactions ({drift.map((d) => `${d.name}: ${format(convert(d.investedUsd, "USD"))} vs ${format(convert(d.txCostUsd, "USD"))}`).join("; ")}).
                XIRR and TWR only count logged transactions, so add the missing buys on the
                Portfolio page to keep these numbers honest.
              </p>
            </div>
          </div>
        </BlurFade>
      )}

      {/* ── Stats ── */}
      <PerfStats
        xirrPct={xirrAllTime}
        twrPct={twr.totalReturn}
        twrLabel={period === "All" ? "ALL" : period}
        netGainUsd={netGainUsd}
        dividendsUsd={dividendsUsd}
        vsSpyPct={
          twr.totalReturn != null && spyStats ? twr.totalReturn - spyStats.totalReturn : null
        }
      />

      {/* ── Charts (Tasks 6) ── */}
      <ValueContributionsChart
        values={periodValues}
        contributions={contributions}
        isDark={isDark}
      />
      <GrowthChart twrSeries={twr.series} spySeries={spyStats?.series ?? null} isDark={isDark} />

      {/* ── Per-holding table (Task 7) ── */}
      <HoldingsPerformanceTable rows={holdingRows} />
    </div>
  );
}
```

NOTE — the XIRR stat is all-time by design (money-weighted return is meaningful over the whole investing life; TWR + benchmark are the period-scoped numbers). The `holdingRows` memo passes orphan txs through even when super is excluded (orphans can't be classified).

- [ ] **Step 3: Add nav entry in `app/(app)/layout.tsx`**

Import `LineChart` in the existing lucide-react import, then:

```ts
const SECONDARY_NAV = [
  { href: "/performance", label: "Performance", icon: LineChart },
  { href: "/liabilities", label: "Liabilities", icon: Handshake },
  // ...rest unchanged
];
```

- [ ] **Step 4: Stub the three chart/table components so the page compiles**

Create minimal versions (replaced in Tasks 6–7) — each renders `null`:

`_components/value-contributions-chart.tsx`:
```tsx
"use client";
export function ValueContributionsChart(_props: {
  values: { date: string; value: number }[];
  contributions: { date: string; contributed: number }[];
  isDark: boolean;
}) {
  return null;
}
```

`_components/growth-chart.tsx`:
```tsx
"use client";
export function GrowthChart(_props: {
  twrSeries: { date: string; index: number }[];
  spySeries: { date: string; index: number }[] | null;
  isDark: boolean;
}) {
  return null;
}
```

`_components/holdings-performance-table.tsx`:
```tsx
"use client";
import type { HoldingPerfRow } from "@/lib/utils/performance";
export function HoldingsPerformanceTable(_props: { rows: HoldingPerfRow[] }) {
  return null;
}
```

- [ ] **Step 5: Verify it compiles and renders**

Run: `npm run lint && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors in new files. Then `npm run dev`, open `http://localhost:3000/performance`, confirm stats row renders with real numbers and the nav shows Performance.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/performance app/(app)/layout.tsx
git commit -m "feat(performance): add /performance page with XIRR/TWR/net-gain stats + nav"
```

---

### Task 6: The two charts

**Files:**
- Rewrite: `app/(app)/performance/_components/value-contributions-chart.tsx`
- Rewrite: `app/(app)/performance/_components/growth-chart.tsx`

**Interfaces:**
- Consumes: props defined in Task 5 stubs (unchanged signatures, `_props` → real rendering).
- Produces: nothing new — leaf components.

- [ ] **Step 1: Implement `value-contributions-chart.tsx`**

Contributions are step-forward-filled onto the snapshot date axis (a contribution made before the first snapshot is included in the first point's level):

```tsx
"use client";

import { useMemo } from "react";
import { ReactECharts } from "@/components/ui/lazy-echarts";
import { getCartesianBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";

export function ValueContributionsChart({
  values,
  contributions,
  isDark,
}: {
  values: { date: string; value: number }[];
  contributions: { date: string; contributed: number }[];
  isDark: boolean;
}) {
  const { symbol, convert } = useCurrency();

  const data = useMemo(() => {
    // Forward-fill cumulative contributions onto each snapshot date.
    let ci = -1;
    let level = 0;
    return values.map((v) => {
      while (ci + 1 < contributions.length && contributions[ci + 1].date <= v.date) {
        ci++;
        level = contributions[ci].contributed;
      }
      return {
        date: v.date,
        value: convert(v.value, "USD"),
        contributed: convert(level, "USD"),
      };
    });
  }, [values, contributions, convert]);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    return {
      ...base,
      grid: { ...base.grid, left: 56, right: 8 },
      legend: {
        show: true,
        top: 0,
        right: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 3,
        textStyle: { color: isDark ? "#888888" : "#968360", fontSize: 11 },
      },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: data.map((d) => {
          const dt = new Date(d.date + "T00:00:00");
          return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
        }),
        axisLabel: {
          ...base.xAxis.axisLabel,
          interval: Math.max(0, Math.floor(data.length / 6) - 1),
        },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        scale: true,
        axisLabel: {
          ...base.yAxis.axisLabel,
          formatter: (v: number) => `${symbol}${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`,
        },
      },
      series: [
        {
          name: "Value",
          type: "line" as const,
          data: data.map((d) => Math.round(d.value * 100) / 100),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: ECHARTS_COLORS[0] },
          areaStyle: { color: ECHARTS_COLORS[0], opacity: 0.08 },
        },
        {
          name: "Net contributions",
          type: "line" as const,
          data: data.map((d) => Math.round(d.contributed * 100) / 100),
          step: "end" as const,
          showSymbol: false,
          lineStyle: { width: 1.5, color: ECHARTS_COLORS[3], type: "dashed" as const },
        },
      ],
    };
  }, [data, isDark, symbol]);

  return (
    <BlurFade delay={0.12}>
      <div className="finance-card p-6">
        <div className="flex items-center justify-between mb-1">
          <p className="label-mono">VALUE VS WHAT YOU PUT IN</p>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          The gap between the lines is money your investments actually made.
        </p>
        {data.length > 1 ? (
          <div className="w-full overflow-hidden">
            <ReactECharts option={option} style={{ height: 260, width: "100%" }} opts={{ renderer: "svg" }} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">
            Not enough snapshot history yet — the daily cron builds this chart over time.
          </p>
        )}
      </div>
    </BlurFade>
  );
}
```

- [ ] **Step 2: Implement `growth-chart.tsx`**

SPY series is aligned to the TWR series' date axis by forward-filling the latest SPY index at or before each TWR date:

```tsx
"use client";

import { useMemo } from "react";
import { ReactECharts } from "@/components/ui/lazy-echarts";
import { getCartesianBaseOption, ECHARTS_COLORS } from "@/lib/utils/echarts";
import { BlurFade } from "@/components/ui/blur-fade";

export function GrowthChart({
  twrSeries,
  spySeries,
  isDark,
}: {
  twrSeries: { date: string; index: number }[];
  spySeries: { date: string; index: number }[] | null;
  isDark: boolean;
}) {
  const aligned = useMemo(() => {
    if (!spySeries || spySeries.length === 0) return null;
    let si = -1;
    let level: number | null = null;
    return twrSeries.map((p) => {
      while (si + 1 < spySeries.length && spySeries[si + 1].date <= p.date) {
        si++;
        level = spySeries[si].index;
      }
      return level;
    });
  }, [twrSeries, spySeries]);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    return {
      ...base,
      grid: { ...base.grid, left: 44, right: 8 },
      legend: {
        show: true,
        top: 0,
        right: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 3,
        textStyle: { color: isDark ? "#888888" : "#968360", fontSize: 11 },
      },
      tooltip: {
        ...base.tooltip,
        valueFormatter: (v: number) => `${Number(v).toFixed(1)}`,
      },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: twrSeries.map((p) => {
          const dt = new Date(p.date + "T00:00:00");
          return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
        }),
        axisLabel: {
          ...base.xAxis.axisLabel,
          interval: Math.max(0, Math.floor(twrSeries.length / 6) - 1),
        },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        scale: true,
        axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => v.toFixed(0) },
      },
      series: [
        {
          name: "Your portfolio",
          type: "line" as const,
          data: twrSeries.map((p) => Math.round(p.index * 100) / 100),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: ECHARTS_COLORS[1] },
        },
        ...(aligned
          ? [
              {
                name: "S&P 500",
                type: "line" as const,
                data: aligned.map((v) => (v == null ? null : Math.round(v * 100) / 100)),
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 1.5, color: ECHARTS_COLORS[7], type: "dashed" as const },
              },
            ]
          : []),
      ],
    };
  }, [twrSeries, aligned, isDark]);

  return (
    <BlurFade delay={0.15}>
      <div className="finance-card p-6">
        <p className="label-mono mb-1">GROWTH OF 100 — YOU VS S&P 500</p>
        <p className="text-xs text-muted-foreground mb-4">
          Deposit timing removed (TWR). Above the S&P line = your picks beat the index.
        </p>
        {twrSeries.length > 1 ? (
          <div className="w-full overflow-hidden">
            <ReactECharts option={option} style={{ height: 260, width: "100%" }} opts={{ renderer: "svg" }} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">
            Needs at least two daily snapshots in this period.
          </p>
        )}
      </div>
    </BlurFade>
  );
}
```

- [ ] **Step 3: Verify visually**

`npm run dev` → `/performance`: both charts render; toggling period/super updates them; killing the network (devtools offline) after clearing `benchmark_spy_cache` hides the S&P line but keeps the portfolio line.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/performance/_components
git commit -m "feat(performance): value-vs-contributions and growth-of-100 charts"
```

---

### Task 7: Per-holding performance table

**Files:**
- Rewrite: `app/(app)/performance/_components/holdings-performance-table.tsx`

**Interfaces:**
- Consumes: `HoldingPerfRow` from `lib/utils/performance.ts`; `useCurrency`.
- Produces: nothing new — leaf component.

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import type { HoldingPerfRow } from "@/lib/utils/performance";

function fmtPct(v: number | null, suffix = "%"): string {
  if (v == null) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}${suffix}`;
}

export function HoldingsPerformanceTable({ rows }: { rows: HoldingPerfRow[] }) {
  const { format, convert } = useCurrency();
  if (rows.length === 0) return null;

  return (
    <BlurFade delay={0.18}>
      <div className="finance-card overflow-hidden">
        <div className="px-4 py-4 sm:px-5">
          <p className="label-mono">WHICH PICKS ARE EARNING</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sorted by annualized return. Gain includes locked-in profit from sells.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-border/60 text-left">
                <th className="px-4 sm:px-5 py-2 label-mono font-normal">Holding</th>
                <th className="px-3 py-2 label-mono font-normal text-right">Invested</th>
                <th className="px-3 py-2 label-mono font-normal text-right">Value</th>
                <th className="px-3 py-2 label-mono font-normal text-right">Gain</th>
                <th className="px-3 py-2 label-mono font-normal text-right">Return</th>
                <th className="px-4 sm:px-5 py-2 label-mono font-normal text-right">XIRR/yr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r) => (
                <tr key={r.holdingId} className={cn(r.closed && "opacity-70")}>
                  <td className="px-4 sm:px-5 py-2.5">
                    <span className="font-medium">{r.name}</span>
                    {r.ticker && (
                      <span className="ml-1.5 text-xs font-mono text-muted-foreground">{r.ticker}</span>
                    )}
                    {r.closed && !r.isOrphan && (
                      <span className="ml-1.5 text-[10px] font-mono text-muted-foreground border border-border rounded px-1 py-px">
                        CLOSED
                      </span>
                    )}
                    {r.accountType === "super" && (
                      <span className="ml-1.5 text-[10px] font-mono text-muted-foreground border border-border rounded px-1 py-px">
                        SUPER
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {r.investedUsd > 0 ? format(convert(r.investedUsd, "USD")) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.valueUsd > 0 ? format(convert(r.valueUsd, "USD")) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right tabular-nums font-medium",
                      r.gainUsd >= 0 ? "text-income" : "text-expense",
                    )}
                  >
                    {r.gainUsd >= 0 ? "+" : "-"}
                    {format(Math.abs(convert(r.gainUsd, "USD")))}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right tabular-nums",
                      r.returnPct == null
                        ? "text-muted-foreground"
                        : r.returnPct >= 0
                          ? "text-income"
                          : "text-expense",
                    )}
                  >
                    {fmtPct(r.returnPct)}
                  </td>
                  <td
                    className={cn(
                      "px-4 sm:px-5 py-2.5 text-right tabular-nums font-semibold",
                      r.xirrPct == null
                        ? "text-muted-foreground"
                        : r.xirrPct >= 0
                          ? "text-income"
                          : "text-expense",
                    )}
                  >
                    {fmtPct(r.xirrPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </BlurFade>
  );
}
```

- [ ] **Step 2: Verify visually**

`/performance`: table sorted by XIRR, closed rows dimmed with CLOSED chip, orphan aggregate (if any) last, horizontal scroll on mobile width.

- [ ] **Step 3: Commit**

```bash
git add app/(app)/performance/_components/holdings-performance-table.tsx
git commit -m "feat(performance): per-holding performance table"
```

---

### Task 8: Final verification

**Files:** none new.

- [ ] **Step 1: Full test suite** — `npx vitest run` → all pass.
- [ ] **Step 2: Lint** — `npm run lint` → no errors in changed files.
- [ ] **Step 3: Production build** — `npm run build` → succeeds, `/performance` route listed.
- [ ] **Step 4: Manual smoke** — dev server: `/performance` loads with real data; period + super toggles change TWR/vs-SPY; benchmark route curl returns SPY JSON; drift banner logic (temporarily bump one holding's amountInvested in the debug page if needed — optional).
- [ ] **Step 5: Commit any fixes** — `git add -A && git commit -m "fix(performance): post-verification fixes"` (only if fixes were needed).
