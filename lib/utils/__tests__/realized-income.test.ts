import { describe, it, expect } from "vitest";
import { derivePosition, deriveRealizedSales } from "../portfolio-transactions";
import { computeRealizedSales, computeRealizedPnl } from "../crypto-csv";
import type { CryptoTransaction, PortfolioTransaction } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;
const ptx = (o: Partial<PortfolioTransaction>): PortfolioTransaction => ({
  id: o.id ?? `tx-${seq++}`,
  holdingId: o.holdingId ?? "h1",
  holdingName: o.holdingName ?? "Vanguard Diversified",
  type: o.type ?? "buy",
  units: o.units ?? 10,
  pricePerUnit: o.pricePerUnit ?? 10,
  totalAmount: o.totalAmount ?? 100,
  currency: o.currency ?? "AUD",
  date: o.date ?? "2026-01-01",
  notes: "",
  createdAt: o.createdAt ?? 0,
});

const ctx = (o: Partial<CryptoTransaction>): CryptoTransaction => ({
  date: o.date ?? "2026-04-01 10:00:00",
  token: o.token ?? "BTC",
  type: o.type ?? "buy",
  priceUsd: o.priceUsd === undefined ? 100 : o.priceUsd,
  amount: o.amount ?? 1,
  totalValueUsd: o.totalValueUsd === undefined ? 100 : o.totalValueUsd,
  fee: null,
  feeCurrency: "",
  notes: "",
});

/** Identity conversion — fixtures are single-currency unless stated. */
const same = (amount: number) => amount;
/** AUD is worth 2 USD in these fixtures, so cross-currency legs are visible. */
const fx = (amount: number, from: string, to?: string) => {
  if (from === to || to === undefined) return amount;
  if (from === "AUD" && to === "USD") return amount * 2;
  if (from === "USD" && to === "AUD") return amount / 2;
  return amount;
};

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

describe("deriveRealizedSales — portfolio", () => {
  it("emits one event per sell, with that sell's own gain", () => {
    const txs = [
      ptx({ type: "buy", units: 10, totalAmount: 100, date: "2026-01-01" }),
      ptx({ type: "sell", units: 5, totalAmount: 75, date: "2026-03-01" }),
      ptx({ type: "sell", units: 5, totalAmount: 60, date: "2026-05-01" }),
    ];
    const events = deriveRealizedSales(txs, same);

    expect(events).toHaveLength(2);
    // avg cost $10/unit → 75 − 50 = 25, then 60 − 50 = 10
    expect(events[0]).toMatchObject({ date: "2026-03-01", realized: 25, source: "stocks" });
    expect(events[1]).toMatchObject({ date: "2026-05-01", realized: 10 });
  });

  it("sums to derivePosition's realizedPnl — the two replays cannot drift", () => {
    const txs = [
      ptx({ type: "buy", units: 10, totalAmount: 100, date: "2026-01-01" }),
      ptx({ type: "buy", units: 10, totalAmount: 300, date: "2026-02-01" }),
      ptx({ type: "sell", units: 5, totalAmount: 150, date: "2026-03-01" }),
      ptx({ type: "buy", units: 5, totalAmount: 50, date: "2026-04-01" }),
      ptx({ type: "sell", units: 12, totalAmount: 200, date: "2026-05-01" }),
    ];
    const total = deriveRealizedSales(txs, same).reduce((s, e) => s + e.realized, 0);
    expect(total).toBeCloseTo(derivePosition(txs, "AUD", same).realizedPnl, 10);
  });

  it("emits a negative event for a sell at a loss", () => {
    const txs = [
      ptx({ type: "buy", units: 10, totalAmount: 200, date: "2026-01-01" }),
      ptx({ type: "sell", units: 5, totalAmount: 60, date: "2026-03-01" }),
    ];
    const events = deriveRealizedSales(txs, same);
    expect(events).toHaveLength(1);
    expect(events[0].realized).toBe(-40); // 60 proceeds vs 100 cost
  });

  it("keeps each holding in its own quote currency", () => {
    const txs = [
      ptx({ holdingId: "aud", currency: "AUD", type: "buy", units: 10, totalAmount: 100 }),
      ptx({ holdingId: "aud", currency: "AUD", type: "sell", units: 10, totalAmount: 150, date: "2026-03-01" }),
      ptx({ holdingId: "usd", currency: "USD", type: "buy", units: 10, totalAmount: 100 }),
      ptx({ holdingId: "usd", currency: "USD", type: "sell", units: 10, totalAmount: 150, date: "2026-03-01" }),
    ];
    const events = deriveRealizedSales(txs, fx);

    expect(events).toHaveLength(2);
    const aud = events.find((e) => e.currency === "AUD")!;
    const usd = events.find((e) => e.currency === "USD")!;
    // Same nominal gain in each holding's own currency — no cross-conversion.
    expect(aud.realized).toBe(50);
    expect(usd.realized).toBe(50);
  });

  it("groups by holdingId so a deleted holding still contributes", () => {
    const txs = [
      ptx({ holdingId: "gone", holdingName: "Old ETF", type: "buy", units: 10, totalAmount: 100 }),
      ptx({ holdingId: "gone", holdingName: "Old ETF", type: "sell", units: 10, totalAmount: 130, date: "2026-03-01" }),
    ];
    const events = deriveRealizedSales(txs, same, () => undefined);
    expect(events).toHaveLength(1);
    // No holding row to read a ticker from → falls back to the logged name.
    expect(events[0]).toMatchObject({ label: "Old ETF", ticker: "Old ETF", realized: 30 });
  });

  it("uses the holding's ticker for the source column when available", () => {
    const txs = [
      ptx({ holdingId: "h1", type: "buy", units: 10, totalAmount: 100 }),
      ptx({ holdingId: "h1", type: "sell", units: 10, totalAmount: 130, date: "2026-03-01" }),
    ];
    const events = deriveRealizedSales(txs, same, (id) => (id === "h1" ? "VDHG" : undefined));
    expect(events[0].ticker).toBe("VDHG");
  });

  it("clamps an oversell instead of inventing a cost basis", () => {
    const txs = [
      ptx({ type: "buy", units: 5, totalAmount: 50, date: "2026-01-01" }),
      ptx({ type: "sell", units: 10, totalAmount: 200, date: "2026-03-01" }),
    ];
    const events = deriveRealizedSales(txs, same);
    // Only the 5 units actually held carry cost: 200 − 50 = 150.
    expect(events[0].realized).toBe(150);
    expect(events[0].realized).toBeCloseTo(
      derivePosition(txs, "AUD", same).realizedPnl,
      10,
    );
  });

  it("drops sub-cent dust rows", () => {
    const txs = [
      ptx({ type: "buy", units: 10, totalAmount: 100, date: "2026-01-01" }),
      ptx({ type: "sell", units: 5, totalAmount: 50.001, date: "2026-03-01" }),
    ];
    expect(deriveRealizedSales(txs, same)).toHaveLength(0);
  });

  it("produces ids that are stable across calls", () => {
    const txs = [
      ptx({ id: "fixed", type: "buy", units: 10, totalAmount: 100 }),
      ptx({ id: "sell-1", type: "sell", units: 10, totalAmount: 150, date: "2026-03-01" }),
    ];
    expect(deriveRealizedSales(txs, same)[0].id).toBe("rp-stocks-sell-1");
    expect(deriveRealizedSales(txs, same)[0].id).toBe("rp-stocks-sell-1");
  });

  it("returns nothing when the log has no sells", () => {
    expect(deriveRealizedSales([ptx({ type: "buy" })], same)).toEqual([]);
    expect(deriveRealizedSales([], same)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

describe("computeRealizedSales — crypto", () => {
  it("emits one event per sell against the running average buy price", () => {
    const txs = [
      ctx({ type: "buy", token: "BTC", amount: 1, totalValueUsd: 100, date: "2026-01-01 00:00:00" }),
      ctx({ type: "buy", token: "BTC", amount: 1, totalValueUsd: 300, date: "2026-02-01 00:00:00" }),
      ctx({ type: "sell", token: "BTC", amount: 1, totalValueUsd: 400, date: "2026-03-01 00:00:00" }),
    ];
    const events = computeRealizedSales(txs);
    expect(events).toHaveLength(1);
    expect(events[0].realized).toBe(200); // 400 − 1 × avg 200
    expect(events[0].currency).toBe("USD");
  });

  it("truncates the CSV timestamp to a YYYY-MM-DD date", () => {
    const txs = [
      ctx({ type: "buy", amount: 1, totalValueUsd: 100, date: "2026-01-01 09:30:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: 180, date: "2026-03-05 14:22:07" }),
    ];
    expect(computeRealizedSales(txs)[0].date).toBe("2026-03-05");
  });

  it("excludes transferOut — a move is not income", () => {
    const txs = [
      ctx({ type: "buy", amount: 2, totalValueUsd: 200, date: "2026-01-01 00:00:00" }),
      ctx({ type: "transferOut", amount: 1, totalValueUsd: 500, date: "2026-02-01 00:00:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: 150, date: "2026-03-01 00:00:00" }),
    ];
    const events = computeRealizedSales(txs);
    expect(events).toHaveLength(1);
    expect(events[0].realized).toBe(50); // the sell only: 150 − 100

    // The crypto page's card still counts the transfer, so it reads higher.
    // That divergence is the point — assert it rather than let it drift.
    expect(computeRealizedPnl(txs).total).toBeCloseTo(450, 10);
  });

  it("leaves the average buy price untouched by excluded transfers", () => {
    const withTransfer = [
      ctx({ type: "buy", amount: 2, totalValueUsd: 200, date: "2026-01-01 00:00:00" }),
      ctx({ type: "transferOut", amount: 1, totalValueUsd: 900, date: "2026-02-01 00:00:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: 150, date: "2026-03-01 00:00:00" }),
    ];
    const without = withTransfer.filter((t) => t.type !== "transferOut");
    expect(computeRealizedSales(withTransfer)).toEqual(computeRealizedSales(without));
  });

  it("shifts the average on a transferIn that carries a cost", () => {
    const txs = [
      ctx({ type: "buy", amount: 1, totalValueUsd: 100, date: "2026-01-01 00:00:00" }),
      ctx({ type: "transferIn", amount: 1, totalValueUsd: 300, date: "2026-02-01 00:00:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: 400, date: "2026-03-01 00:00:00" }),
    ];
    expect(computeRealizedSales(txs)[0].realized).toBe(200); // avg 200
  });

  it("ignores a valueless transferIn so deposits don't drag the average down", () => {
    const txs = [
      ctx({ type: "buy", amount: 1, totalValueUsd: 100, date: "2026-01-01 00:00:00" }),
      ctx({ type: "transferIn", amount: 5, totalValueUsd: null, priceUsd: null, date: "2026-02-01 00:00:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: 150, date: "2026-03-01 00:00:00" }),
    ];
    expect(computeRealizedSales(txs)[0].realized).toBe(50); // avg stays 100
  });

  it("skips stablecoins, valueless sells and sells with no cost basis", () => {
    const stable = [
      ctx({ type: "buy", token: "USDT", amount: 100, totalValueUsd: 100, date: "2026-01-01 00:00:00" }),
      ctx({ type: "sell", token: "USDT", amount: 50, totalValueUsd: 60, date: "2026-03-01 00:00:00" }),
    ];
    expect(computeRealizedSales(stable)).toEqual([]);

    const noValue = [
      ctx({ type: "buy", amount: 1, totalValueUsd: 100, date: "2026-01-01 00:00:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: null, priceUsd: null, date: "2026-03-01 00:00:00" }),
    ];
    expect(computeRealizedSales(noValue)).toEqual([]);

    const noBasis = [
      ctx({ type: "sell", amount: 1, totalValueUsd: 500, date: "2026-03-01 00:00:00" }),
    ];
    expect(computeRealizedSales(noBasis)).toEqual([]);
  });

  it("emits a negative event for a sell at a loss", () => {
    const txs = [
      ctx({ type: "buy", token: "SOL", amount: 10, totalValueUsd: 1000, date: "2026-01-01 00:00:00" }),
      ctx({ type: "sell", token: "SOL", amount: 5, totalValueUsd: 350, date: "2026-03-01 00:00:00" }),
    ];
    expect(computeRealizedSales(txs)[0].realized).toBe(-150);
  });

  it("gives same-day sells of one token distinct stable ids", () => {
    const txs = [
      ctx({ type: "buy", amount: 4, totalValueUsd: 400, date: "2026-01-01 00:00:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: 150, date: "2026-03-01 09:00:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: 160, date: "2026-03-01 17:00:00" }),
    ];
    const ids = computeRealizedSales(txs).map((e) => e.id);
    expect(ids).toEqual(["rp-crypto-2026-03-01-BTC-0", "rp-crypto-2026-03-01-BTC-1"]);
    expect(computeRealizedSales(txs).map((e) => e.id)).toEqual(ids);
  });

  it("replays out-of-order rows in date order", () => {
    const inOrder = [
      ctx({ type: "buy", amount: 1, totalValueUsd: 100, date: "2026-01-01 00:00:00" }),
      ctx({ type: "buy", amount: 1, totalValueUsd: 300, date: "2026-02-01 00:00:00" }),
      ctx({ type: "sell", amount: 1, totalValueUsd: 400, date: "2026-03-01 00:00:00" }),
    ];
    const shuffled = [inOrder[2], inOrder[0], inOrder[1]];
    expect(computeRealizedSales(shuffled)).toEqual(computeRealizedSales(inOrder));
  });

  it("returns nothing for an empty log", () => {
    expect(computeRealizedSales([])).toEqual([]);
  });
});
