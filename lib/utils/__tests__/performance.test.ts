import { describe, it, expect } from "vitest";
import {
  xirr,
  netFlowsByDay,
  buildContributionSeries,
  dailySnapshotValues,
  computeTwr,
  type CashFlow,
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
