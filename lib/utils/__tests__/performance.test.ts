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
