import { describe, it, expect } from "vitest";
import {
  xirr,
  netFlowsByDay,
  buildContributionSeries,
  dailySnapshotValues,
  computeTwr,
  perHoldingStats,
  costBasisDrift,
  syntheticSuperSeries,
  type CashFlow,
  type DailyFlow,
} from "../performance";
import type { PortfolioHolding, PortfolioTransaction } from "../types";

const holding = (o: Partial<PortfolioHolding>): PortfolioHolding => ({
  id: o.id ?? "h1",
  name: o.name ?? "Test Co",
  ticker: o.ticker ?? "TST",
  type: o.type ?? "stock",
  accountType: o.accountType ?? "normal",
  broker: "",
  country: "US",
  link: "",
  units: o.units ?? 10,
  amountInvested: o.amountInvested ?? 1000,
  currentValue: o.currentValue ?? 1200,
  currency: o.currency ?? "USD",
  notes: "",
  createdAt: 1,
});

const idUsd = (a: number) => a;

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

describe("xirr", () => {
  it("matches Excel XIRR for a simple two-flow case", () => {
    // Excel: XIRR({-1000, 1100}, {2025-01-01, 2026-01-01}) = 0.10
    const flows: CashFlow[] = [
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount: 1100 },
    ];
    expect(xirr(flows)!).toBeCloseTo(0.1, 4);
  });

  it("solves multiple irregular flows (Excel day-count convention)", () => {
    // Root verified by hand: NPV(0.0916735) ≈ 0 with actual-days/365 exponents,
    // the same convention Excel's XIRR uses.
    const flows: CashFlow[] = [
      { date: "2024-01-15", amount: -10000 },
      { date: "2024-06-10", amount: -2500 },
      { date: "2024-11-20", amount: -2500 },
      { date: "2025-12-31", amount: 17500 },
    ];
    const r = xirr(flows)!;
    expect(r).toBeCloseTo(0.09167, 4);
    // And prove it's the root, not just a magic number:
    const t0 = Date.parse("2024-01-15T00:00:00Z");
    const npv = flows.reduce(
      (s, f) =>
        s +
        f.amount /
          Math.pow(1 + r, (Date.parse(f.date + "T00:00:00Z") - t0) / 86400000 / 365),
      0,
    );
    expect(Math.abs(npv)).toBeLessThan(0.01);
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
    // Two months from 100 → 500. Annualized rate is astronomical but solvable;
    // verify by plugging the root back into the NPV equation.
    const flows: CashFlow[] = [
      { date: "2025-01-01", amount: -100 },
      { date: "2025-03-01", amount: 500 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    const t0 = Date.parse("2025-01-01T00:00:00Z");
    const npv = flows.reduce(
      (s, f) =>
        s +
        f.amount /
          Math.pow(1 + r!, (Date.parse(f.date + "T00:00:00Z") - t0) / 86400000 / 365),
      0,
    );
    expect(Math.abs(npv)).toBeLessThan(0.01);
  });
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

  it("still computes when a large flow lands on a snapshot day", () => {
    const values = [
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 100.000001 },
      { date: "2026-01-03", value: 110 },
    ];
    const flows: DailyFlow[] = [{ date: "2026-01-03", amount: 200 }];
    // (110 − 200) / 100.000001 − 1 is a legitimate (ugly) sub-period return;
    // this test pins that the function doesn't blow up or go null.
    const { totalReturn } = computeTwr(values, flows);
    expect(totalReturn).not.toBeNull();
  });
});

describe("perHoldingStats", () => {
  it("computes invested, value, gain and return for an open holding", () => {
    const h = holding({ id: "h1", amountInvested: 1000, currentValue: 1200 });
    const txs = [
      tx({ holdingId: "h1", date: "2025-01-01", totalAmount: 1000, units: 10, pricePerUnit: 100 }),
    ];
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
      tx({ holdingId: "gone", holdingName: "Sold Co", date: "2025-01-01", type: "buy", totalAmount: 500, units: 5 }),
      tx({ holdingId: "gone", holdingName: "Sold Co", date: "2025-12-01", type: "sell", totalAmount: 450, units: 5 }),
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

describe("syntheticSuperSeries", () => {
  it("equals cost at the first flow and current value today, ramping between", () => {
    const flows: DailyFlow[] = [{ date: "2026-01-01", amount: 1000 }];
    const dates = ["2026-01-01", "2026-04-02", "2026-07-02"];
    // ratio = 1210/1000 = 1.21 over 182 days; midpoint (91d) → ×1.21^0.5 = ×1.1
    const s = syntheticSuperSeries(dates, flows, 1210, "2026-07-02");
    expect(s[0]).toEqual({ date: "2026-01-01", value: 1000 });
    expect(s[1].value).toBeCloseTo(1100, 0);
    expect(s[2].value).toBeCloseTo(1210, 6);
  });

  it("steps the cost basis up at later contributions", () => {
    const flows: DailyFlow[] = [
      { date: "2026-01-01", amount: 1000 },
      { date: "2026-07-02", amount: 500 },
    ];
    // total cost 1500, current 1815 → ratio 1.21 over 2026-01-01 → 2027-01-01
    const s = syntheticSuperSeries(
      ["2026-01-01", "2026-07-01", "2026-07-02", "2027-01-01"],
      flows,
      1815,
      "2027-01-01",
    );
    expect(s[0].value).toBeCloseTo(1000, 6);
    // day before the top-up: cost still 1000, ~half the ramp elapsed
    expect(s[1].value).toBeCloseTo(1000 * Math.pow(1.21, 181 / 365), 0);
    // top-up day: cost jumps to 1500
    expect(s[2].value).toBeCloseTo(1500 * Math.pow(1.21, 182 / 365), 0);
    expect(s[3].value).toBeCloseTo(1815, 6);
  });

  it("handles withdrawals by reducing the cost step", () => {
    const flows: DailyFlow[] = [
      { date: "2026-01-01", amount: 1000 },
      { date: "2026-02-01", amount: -400 },
    ];
    const s = syntheticSuperSeries(["2026-02-01"], flows, 660, "2026-03-01");
    // cost after withdrawal = 600; ratio = 660/600 = 1.1
    expect(s[0].value).toBeCloseTo(600 * Math.pow(1.1, 31 / 59), 0);
  });

  it("returns zeros when there are no super flows or no current value", () => {
    expect(syntheticSuperSeries(["2026-01-01"], [], 500, "2026-02-01")).toEqual([
      { date: "2026-01-01", value: 0 },
    ]);
    expect(
      syntheticSuperSeries(["2026-01-01"], [{ date: "2026-01-01", amount: 100 }], 0, "2026-02-01"),
    ).toEqual([{ date: "2026-01-01", value: 0 }]);
  });

  it("evaluates dates before the first flow as zero", () => {
    const flows: DailyFlow[] = [{ date: "2026-03-01", amount: 1000 }];
    const s = syntheticSuperSeries(["2026-02-01", "2026-03-01"], flows, 1100, "2026-04-01");
    expect(s[0].value).toBe(0);
    expect(s[1].value).toBeCloseTo(1000, 6);
  });
});
