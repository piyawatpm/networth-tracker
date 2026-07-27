import { describe, it, expect } from "vitest";
import {
  isCashLikeToken,
  cryptoNetFlowsByDay,
  stableBalanceByDay,
  cryptoPotValues,
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
