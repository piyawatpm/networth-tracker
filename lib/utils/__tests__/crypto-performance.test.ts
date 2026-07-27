import { describe, it, expect } from "vitest";
import {
  isCashLikeToken,
  cryptoNetFlowsByDay,
  stableBalanceByDay,
  cryptoPotValues,
  perTokenStats,
  bootstrapCryptoWindow,
} from "../crypto-performance";
import type { CryptoTransaction } from "../types";

const ctx = (o: Partial<CryptoTransaction>): CryptoTransaction => ({
  date: o.date ?? "2026-04-01 10:00:00",
  token: o.token ?? "BTC",
  type: o.type ?? "buy",
  priceUsd: o.priceUsd === undefined ? 100 : o.priceUsd,
  amount: o.amount ?? 1,
  totalValueUsd: o.totalValueUsd === undefined ? 100 : o.totalValueUsd,
  fee: null,
  feeCurrency: "",
  notes: o.notes ?? "",
});

const noTags: Record<string, boolean> = {};
const cash = (t: string) => isCashLikeToken(t, noTags);

describe("isCashLikeToken", () => {
  it("treats base stablecoins, pegged extras and user tags as cash", () => {
    expect(isCashLikeToken("USDT", noTags)).toBe(true);
    expect(isCashLikeToken("USDe", noTags)).toBe(true); // pegged extra
    expect(isCashLikeToken("syrupUSDC", noTags)).toBe(true); // pegged extra
    expect(isCashLikeToken("GUSD", noTags)).toBe(true);
    expect(isCashLikeToken("WEIRDUSD", { WEIRDUSD: true })).toBe(true); // user tag
  });
  it("keeps investments out of cash", () => {
    expect(isCashLikeToken("BTC", noTags)).toBe(false);
    expect(isCashLikeToken("XAUt", noTags)).toBe(false); // gold = investment
    expect(isCashLikeToken("HYPE", { HYPE: false })).toBe(false);
  });
});

describe("cryptoNetFlowsByDay", () => {
  it("counts non-cash buys as deposits and sells as withdrawals, per day", () => {
    const txs = [
      ctx({ date: "2026-04-01 09:00:00", token: "BTC", type: "buy", totalValueUsd: 500 }),
      ctx({ date: "2026-04-01 12:00:00", token: "ETH", type: "sell", totalValueUsd: 200 }),
      ctx({ date: "2026-04-03 09:00:00", token: "SOL", type: "buy", totalValueUsd: 50 }),
    ];
    const { flows, skippedUnpriced } = cryptoNetFlowsByDay(txs, cash);
    expect(flows).toEqual([
      { date: "2026-04-01", amount: 300 },
      { date: "2026-04-03", amount: 50 },
    ]);
    expect(skippedUnpriced).toBe(0);
  });

  it("ignores transfers, cash tokens, and counts skipped unpriced rows", () => {
    const txs = [
      ctx({ token: "USDT", type: "buy", totalValueUsd: 9999 }), // cash — ignored
      ctx({ token: "BTC", type: "transferIn", totalValueUsd: null, priceUsd: null }), // yield
      ctx({ token: "ETH", type: "transferOut", totalValueUsd: 50 }), // still no flow
      ctx({ token: "SOL", type: "buy", totalValueUsd: null, priceUsd: null }), // unpriced buy
      ctx({ token: "BTC", type: "buy", totalValueUsd: 100 }),
    ];
    const { flows, skippedUnpriced } = cryptoNetFlowsByDay(txs, cash);
    expect(flows).toEqual([{ date: "2026-04-01", amount: 100 }]);
    expect(skippedUnpriced).toBe(1); // only the unpriced BUY counts as skipped
  });
});

describe("stableBalanceByDay", () => {
  it("accumulates cash amounts across buys/sells/transfers and floors at 0", () => {
    const txs = [
      ctx({ date: "2026-04-01 09:00:00", token: "USDT", type: "buy", amount: 1000 }),
      ctx({ date: "2026-04-02 09:00:00", token: "USDT", type: "sell", amount: 300 }),
      ctx({ date: "2026-04-02 10:00:00", token: "USDe", type: "transferIn", amount: 50, totalValueUsd: null }),
      ctx({ date: "2026-04-05 09:00:00", token: "USDT", type: "transferOut", amount: 2000 }), // over-withdraw
      ctx({ date: "2026-04-06 09:00:00", token: "BTC", type: "buy", amount: 1 }), // not cash — no effect
    ];
    expect(stableBalanceByDay(txs, cash)).toEqual([
      { date: "2026-04-01", balance: 1000 },
      { date: "2026-04-02", balance: 750 },
      { date: "2026-04-05", balance: 0 },
    ]);
  });
});

describe("cryptoPotValues", () => {
  it("subtracts forward-filled stable balance and drops non-positive days", () => {
    const snaps = [
      { date: "2026-04-01", value: 1500 },
      { date: "2026-04-02", value: 1400 },
      { date: "2026-04-03", value: 700 },
      { date: "2026-04-04", value: 2000 },
    ];
    const stable = [
      { date: "2026-04-01", balance: 1000 },
      { date: "2026-04-03", balance: 800 },
    ];
    expect(cryptoPotValues(snaps, stable)).toEqual([
      { date: "2026-04-01", value: 500 },
      { date: "2026-04-02", value: 400 }, // balance forward-filled from 04-01
      // 04-03: 700 − 800 → ≤ 0, dropped
      { date: "2026-04-04", value: 1200 },
    ]);
  });

  it("uses zero stable balance before the first stable entry", () => {
    const snaps = [
      { date: "2026-03-30", value: 100 },
      { date: "2026-04-01", value: 90 },
    ];
    const stable = [{ date: "2026-04-01", balance: 40 }];
    expect(cryptoPotValues(snaps, stable)).toEqual([
      { date: "2026-03-30", value: 100 },
      { date: "2026-04-01", value: 50 },
    ]);
  });
});

describe("perTokenStats", () => {
  const today = "2026-07-27";
  it("builds a row per non-cash token with live-price value and realized+unrealized gain", () => {
    const txs = [
      ctx({ date: "2026-04-01 09:00:00", token: "BTC", type: "buy", amount: 2, priceUsd: 100, totalValueUsd: 200 }),
      ctx({ date: "2026-05-01 09:00:00", token: "BTC", type: "sell", amount: 1, priceUsd: 150, totalValueUsd: 150 }),
      ctx({ date: "2026-04-01 09:00:00", token: "USDT", type: "buy", amount: 500, totalValueUsd: 500 }),
    ];
    const rows = perTokenStats(txs, { BTC: 180 }, {}, cash, today);
    expect(rows).toHaveLength(1); // USDT is cash — excluded
    const r = rows[0];
    expect(r.ticker).toBe("BTC");
    expect(r.badge).toBe("CRYPTO");
    expect(r.valueUsd).toBeCloseTo(180); // 1 remaining × live 180
    expect(r.investedUsd).toBeCloseTo(100); // avg-cost of remaining unit
    // realized = 150 − 100 = 50; unrealized = 180 − 100 = 80; gain = 130
    expect(r.gainUsd).toBeCloseTo(130);
    expect(r.returnPct).toBeCloseTo(130 / 200, 6);
    expect(r.xirrPct).not.toBeNull();
    expect(r.closed).toBe(false);
  });

  it("resolves live price through ticker mappings and falls back to last tx price", () => {
    const txs = [
      ctx({ token: "GRAM", type: "buy", amount: 10, priceUsd: 2, totalValueUsd: 20 }),
    ];
    const viaMapping = perTokenStats(txs, { Telegram: 3 }, { GRAM: "Telegram" }, cash, today);
    expect(viaMapping[0].valueUsd).toBeCloseTo(30);
    const viaFallback = perTokenStats(txs, {}, {}, cash, today);
    expect(viaFallback[0].valueUsd).toBeCloseTo(20); // last known priceUsd = 2
  });

  it("keeps fully-sold tokens as closed rows with realized P&L", () => {
    const txs = [
      ctx({ date: "2026-04-01 09:00:00", token: "APT", type: "buy", amount: 100, priceUsd: 1, totalValueUsd: 100 }),
      ctx({ date: "2026-06-01 09:00:00", token: "APT", type: "sell", amount: 100, priceUsd: 1.5, totalValueUsd: 150 }),
    ];
    const rows = perTokenStats(txs, {}, {}, cash, today);
    expect(rows).toHaveLength(1); // computeHoldings drops it; union keeps it
    const r = rows[0];
    expect(r.closed).toBe(true);
    expect(r.valueUsd).toBe(0);
    expect(r.gainUsd).toBeCloseTo(50);
  });

  it("includes yield transferIns in value but not in flows (return, not deposit)", () => {
    const txs = [
      ctx({ date: "2026-04-01 09:00:00", token: "GT", type: "buy", amount: 10, priceUsd: 10, totalValueUsd: 100 }),
      ctx({ date: "2026-05-01 09:00:00", token: "GT", type: "transferIn", amount: 5, priceUsd: null, totalValueUsd: null }),
    ];
    const r = perTokenStats(txs, { GT: 10 }, {}, cash, today)[0];
    expect(r.valueUsd).toBeCloseTo(150); // 15 units × $10 — yield units count
    expect(r.gainUsd).toBeCloseTo(50); // 150 − 100 cost
  });
});

describe("bootstrapCryptoWindow", () => {
  it("trims partial-coverage leading days and injects an opening deposit", () => {
    // Days 1-2 captured only part of the stack; day 3 the full holdings
    // appear (+1300% flow-adjusted) — classic onboarding noise.
    const pot = [
      { date: "2026-03-27", value: 470 },
      { date: "2026-03-29", value: 473 },
      { date: "2026-03-30", value: 7255 },
      { date: "2026-04-02", value: 7500 },
    ];
    const flows = [
      { date: "2026-03-26", amount: 400 },
      { date: "2026-03-30", amount: 612 },
      { date: "2026-04-02", amount: 100 },
    ];
    const w = bootstrapCryptoWindow(pot, flows);
    expect(w.values[0]).toEqual({ date: "2026-03-30", value: 7255 });
    // Opening deposit replaces all flows ≤ the trusted start date.
    expect(w.flows[0]).toEqual({ date: "2026-03-30", amount: 7255 });
    expect(w.flows.slice(1)).toEqual([{ date: "2026-04-02", amount: 100 }]);
  });

  it("keeps a clean series untouched apart from the opening deposit", () => {
    const pot = [
      { date: "2026-04-01", value: 1000 },
      { date: "2026-04-02", value: 1100 },
    ];
    const flows = [
      { date: "2026-04-01", amount: 1000 },
      { date: "2026-04-02", amount: 50 },
    ];
    const w = bootstrapCryptoWindow(pot, flows);
    expect(w.values).toEqual(pot);
    expect(w.flows).toEqual([
      { date: "2026-04-01", amount: 1000 }, // opening = day-1 pot value
      { date: "2026-04-02", amount: 50 },
    ]);
  });

  it("only trims inside the first 14 days — later spikes are real market moves", () => {
    const pot = [
      { date: "2026-04-01", value: 1000 },
      { date: "2026-05-01", value: 1050 },
      { date: "2026-05-02", value: 4000 }, // late spike: stays
    ];
    const flows = [{ date: "2026-04-01", amount: 1000 }];
    const w = bootstrapCryptoWindow(pot, flows);
    expect(w.values).toHaveLength(3);
  });

  it("handles empty inputs", () => {
    expect(bootstrapCryptoWindow([], []).values).toEqual([]);
    expect(bootstrapCryptoWindow([], []).flows).toEqual([]);
  });
});
