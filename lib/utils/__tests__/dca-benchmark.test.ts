import { describe, it, expect } from "vitest";
import {
  priceAsOf,
  valueAsOf,
  netFlowsInWindow,
  simulateDca,
  windowPnl,
  type PricePoint,
} from "../dca-benchmark";
import type { DailyFlow } from "../performance";

// $100 flat, then a clean doubling — makes every expected number checkable
// by hand rather than by re-running the implementation.
const prices: PricePoint[] = [
  { date: "2026-05-01", close: 100 },
  { date: "2026-05-15", close: 100 },
  { date: "2026-06-01", close: 200 },
];

describe("priceAsOf", () => {
  it("forward-fills across weekends and holidays", () => {
    expect(priceAsOf(prices, "2026-05-01")).toBe(100);
    expect(priceAsOf(prices, "2026-05-20")).toBe(100); // no row that day
    expect(priceAsOf(prices, "2026-12-31")).toBe(200); // past the end
  });
  it("returns null before the series starts", () => {
    expect(priceAsOf(prices, "2026-04-30")).toBeNull();
    expect(priceAsOf([], "2026-05-01")).toBeNull();
  });
});

describe("valueAsOf", () => {
  const values = [
    { date: "2026-05-01", value: 1000 },
    { date: "2026-06-01", value: 1500 },
  ];
  it("forward-fills and returns null before the first reading", () => {
    expect(valueAsOf(values, "2026-05-20")).toBe(1000);
    expect(valueAsOf(values, "2026-06-05")).toBe(1500);
    expect(valueAsOf(values, "2026-04-01")).toBeNull();
  });
});

describe("netFlowsInWindow", () => {
  const flows: DailyFlow[] = [
    { date: "2026-04-01", amount: 500 }, // before window
    { date: "2026-05-01", amount: 300 }, // ON the start — excluded
    { date: "2026-05-15", amount: 200 },
    { date: "2026-06-01", amount: -50 }, // ON the end — included
    { date: "2026-06-10", amount: 900 }, // after window
  ];
  it("is exclusive of the start and inclusive of the end", () => {
    expect(netFlowsInWindow(flows, "2026-05-01", "2026-06-01")).toBe(150);
  });
  it("excludes the start-date flow because it is already in the opening value", () => {
    // The opening balance is read as-of the start, so a flow that same day is
    // already reflected in it — counting it again would double it.
    expect(netFlowsInWindow(flows, "2026-05-01", "2026-05-01")).toBe(0);
  });
});

describe("simulateDca", () => {
  it("prices the opening balance as a lump sum on the start date", () => {
    const r = simulateDca(1000, [], prices, "2026-05-01", "2026-06-01")!;
    // 10 units at $100 → $2000 at $200.
    expect(r.invested).toBe(1000);
    expect(r.endValue).toBe(2000);
    expect(r.pnl).toBe(1000);
    expect(r.pnlPct).toBe(1);
  });

  it("buys later flows at that day's price", () => {
    const flows: DailyFlow[] = [{ date: "2026-05-15", amount: 500 }];
    const r = simulateDca(1000, flows, prices, "2026-05-01", "2026-06-01")!;
    // 10 units + 5 units = 15 units → $3000 on $1500 invested.
    expect(r.invested).toBe(1500);
    expect(r.endValue).toBe(3000);
    expect(r.pnl).toBe(1500);
  });

  it("earns nothing on money that arrives at the end", () => {
    const flows: DailyFlow[] = [{ date: "2026-06-01", amount: 1000 }];
    const r = simulateDca(0, flows, prices, "2026-05-01", "2026-06-01")!;
    // Bought at $200 and valued at $200 the same day.
    expect(r.invested).toBe(1000);
    expect(r.endValue).toBe(1000);
    expect(r.pnl).toBe(0);
  });

  it("ignores flows dated on the start or outside the window", () => {
    const flows: DailyFlow[] = [
      { date: "2026-04-01", amount: 9999 },
      { date: "2026-05-01", amount: 9999 },
      { date: "2026-07-01", amount: 9999 },
    ];
    const r = simulateDca(1000, flows, prices, "2026-05-01", "2026-06-01")!;
    expect(r.invested).toBe(1000);
    expect(r.pnl).toBe(1000);
  });

  it("sells units on a withdrawal", () => {
    const flows: DailyFlow[] = [{ date: "2026-05-15", amount: -500 }];
    const r = simulateDca(1000, flows, prices, "2026-05-01", "2026-06-01")!;
    // 10 units − 5 units = 5 units → $1000 on $500 net invested.
    expect(r.invested).toBe(500);
    expect(r.endValue).toBe(1000);
    expect(r.pnl).toBe(500);
  });

  it("clamps a withdrawal larger than the position instead of going short", () => {
    const flows: DailyFlow[] = [{ date: "2026-05-15", amount: -5000 }];
    const r = simulateDca(1000, flows, prices, "2026-05-01", "2026-06-01")!;
    expect(r.endValue).toBe(0); // units floored at 0, not negative
  });

  it("returns null when the index has no price at the window start", () => {
    expect(simulateDca(1000, [], prices, "2026-04-01", "2026-06-01")).toBeNull();
    expect(simulateDca(1000, [], [], "2026-05-01", "2026-06-01")).toBeNull();
  });
});

describe("windowPnl", () => {
  const values = [
    { date: "2026-05-01", value: 1000 },
    { date: "2026-06-01", value: 2000 },
  ];

  it("subtracts contributions so deposits never read as performance", () => {
    const flows: DailyFlow[] = [{ date: "2026-05-15", amount: 500 }];
    const r = windowPnl(values, flows, "2026-05-01", "2026-06-01")!;
    // Grew 1000 → 2000, but 500 of that was deposited.
    expect(r.invested).toBe(1500);
    expect(r.pnl).toBe(500);
  });

  it("reports a pure deposit as zero P&L, not as a gain", () => {
    const flat = [
      { date: "2026-05-01", value: 1000 },
      { date: "2026-06-01", value: 1500 },
    ];
    const flows: DailyFlow[] = [{ date: "2026-05-15", amount: 500 }];
    expect(windowPnl(flat, flows, "2026-05-01", "2026-06-01")!.pnl).toBe(0);
  });

  it("accepts a live end value that post-dates the last snapshot", () => {
    const r = windowPnl(values, [], "2026-05-01", "2026-06-01", 2500)!;
    expect(r.endValue).toBe(2500);
    expect(r.pnl).toBe(1500);
  });

  it("returns null when the window opens before any tracked history", () => {
    expect(windowPnl(values, [], "2026-01-01", "2026-06-01")).toBeNull();
  });

  it("puts you and the index on identical invested capital", () => {
    const flows: DailyFlow[] = [
      { date: "2026-05-15", amount: 500 },
      { date: "2026-06-01", amount: -100 },
    ];
    const mine = windowPnl(values, flows, "2026-05-01", "2026-06-01")!;
    const spy = simulateDca(1000, flows, prices, "2026-05-01", "2026-06-01")!;
    // Same capital on both sides is what makes the P&L columns comparable.
    expect(spy.invested).toBeCloseTo(mine.invested, 10);
  });
});
