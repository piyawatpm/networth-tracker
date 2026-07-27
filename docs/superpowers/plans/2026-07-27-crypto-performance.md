# Crypto Performance Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stocks | Crypto | All scopes to `/performance`, with the crypto pot (non-stablecoin tokens) getting XIRR/TWR, BTC+SPY benchmarks, and per-token rows in the merged table.

**Architecture:** A new pure module `lib/utils/crypto-performance.ts` derives crypto flows/values from the CSV-parsed transaction log and crypto snapshots; the existing generic math (`xirr`, `computeTwr`, `buildContributionSeries`, `dailySnapshotValues`) is reused untouched. The benchmark route gains a whitelisted BTC branch (Binance klines). The page adds scope state and per-scope data selection; the growth chart generalizes to N benchmark series.

**Tech Stack:** Next.js 16 App Router, echarts via lazy-echarts, vitest (`pnpm test`). **pnpm project — never npm.**

**Spec:** `docs/superpowers/specs/2026-07-27-crypto-performance-design.md`

## Global Constraints

- All math in USD; display conversion only at render time via `useCurrency()`.
- Crypto pot = non-cash tokens. Cash = `isStablecoin(token)` ∪ `stablecoinTags[token] === true` ∪ PEGGED_EXTRAS {USDE, USDG, GUSD, SYRUPUSDC}. XAUt is NOT cash.
- Flows: non-cash buys +, non-cash sells −, transfers and cash rows = no flow; null `totalValueUsd` rows skipped and counted.
- `lib/utils/crypto-performance.ts` imports only sibling modules (`./types`, `./crypto-csv`, `./performance`) — vitest needs no config.
- Existing 24 tests stay green; existing `HoldingPerfRow` consumers keep compiling (new field is optional).
- Chart colors must pass `scripts/validate_palette.js` (dataviz skill) on #f4f3ed and #242424 before shipping; benchmark lines are distinguished by dash pattern as secondary encoding.

---

### Task 1: Export `isStablecoin` + crypto flow/value derivation

**Files:**
- Modify: `lib/utils/crypto-csv.ts:89` (add `export` to `isStablecoin`)
- Create: `lib/utils/crypto-performance.ts`
- Test: `lib/utils/__tests__/crypto-performance.test.ts`

**Interfaces:**
- Consumes: `CryptoTransaction` from `./types`; `DailyFlow` from `./performance`; `isStablecoin` from `./crypto-csv`.
- Produces:
  - `function isCashLikeToken(token: string, stablecoinTags: Record<string, boolean>): boolean`
  - `function cryptoNetFlowsByDay(txs: CryptoTransaction[], isCash: (token: string) => boolean): { flows: DailyFlow[]; skippedUnpriced: number }`
  - `function stableBalanceByDay(txs: CryptoTransaction[], isCash: (token: string) => boolean): { date: string; balance: number }[]` (ascending, cumulative, floored at 0)
  - `function cryptoPotValues(snapshotValues: { date: string; value: number }[], stableBalance: { date: string; balance: number }[]): { date: string; value: number }[]`

- [ ] **Step 1: Export isStablecoin**

In `lib/utils/crypto-csv.ts` change `function isStablecoin(name: string): boolean {` to `export function isStablecoin(name: string): boolean {`.

- [ ] **Step 2: Write failing tests**

Create `lib/utils/__tests__/crypto-performance.test.ts`:

```ts
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
  priceUsd: o.priceUsd ?? 100,
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
    const snaps = [{ date: "2026-03-30", value: 100 }, { date: "2026-04-01", value: 90 }];
    const stable = [{ date: "2026-04-01", balance: 40 }];
    expect(cryptoPotValues(snaps, stable)).toEqual([
      { date: "2026-03-30", value: 100 },
      { date: "2026-04-01", value: 50 },
    ]);
  });
});
```

- [ ] **Step 3: Run tests, verify fail**

Run: `npx vitest run lib/utils/__tests__/crypto-performance.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `lib/utils/crypto-performance.ts`**

```ts
// Crypto-scope performance derivation. The crypto investment pot is the set
// of NON-cash tokens: stablecoins are the cash layer, so buys of investment
// tokens are deposits from cash, sells are withdrawals to cash, and transfers
// (bot profits / yield / inter-exchange moves) are zero-flow — their value
// surfaces in the pot's growth, i.e. as return.
import type { CryptoTransaction } from "./types";
import { isStablecoin } from "./crypto-csv";
import type { DailyFlow } from "./performance";

/** Dollar-pegged tokens the base classifier misses (yield-prefix exclusion
 * catches syrupUSDC; USDe/USDG/GUSD aren't in its name list). */
const PEGGED_EXTRAS = new Set(["USDE", "USDG", "GUSD", "SYRUPUSDC"]);

export function isCashLikeToken(
  token: string,
  stablecoinTags: Record<string, boolean>,
): boolean {
  if (stablecoinTags[token] === true) return true;
  if (PEGGED_EXTRAS.has(token.toUpperCase())) return true;
  return isStablecoin(token);
}

/** Net deposits (non-cash buys) − withdrawals (non-cash sells) per day, USD. */
export function cryptoNetFlowsByDay(
  txs: CryptoTransaction[],
  isCash: (token: string) => boolean,
): { flows: DailyFlow[]; skippedUnpriced: number } {
  const byDay = new Map<string, number>();
  let skippedUnpriced = 0;
  for (const t of txs) {
    if (t.type !== "buy" && t.type !== "sell") continue; // transfers = yield
    if (isCash(t.token)) continue; // cash management, not investment flow
    if (t.totalValueUsd == null || !Number.isFinite(t.totalValueUsd)) {
      skippedUnpriced++;
      continue;
    }
    const day = t.date.slice(0, 10);
    const signed = t.type === "buy" ? t.totalValueUsd : -t.totalValueUsd;
    byDay.set(day, (byDay.get(day) ?? 0) + signed);
  }
  const flows = [...byDay.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .filter((f) => f.amount !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { flows, skippedUnpriced };
}

/** Cumulative cash-token balance per day ($1 per unit), floored at 0. */
export function stableBalanceByDay(
  txs: CryptoTransaction[],
  isCash: (token: string) => boolean,
): { date: string; balance: number }[] {
  const deltaByDay = new Map<string, number>();
  for (const t of txs) {
    if (!isCash(t.token)) continue;
    const day = t.date.slice(0, 10);
    const sign = t.type === "buy" || t.type === "transferIn" ? 1 : -1;
    deltaByDay.set(day, (deltaByDay.get(day) ?? 0) + sign * t.amount);
  }
  const days = [...deltaByDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  let balance = 0;
  return days.map(([date, delta]) => {
    balance = Math.max(0, balance + delta);
    return { date, balance };
  });
}

/** Snapshot value minus forward-filled stable balance; non-positive days dropped. */
export function cryptoPotValues(
  snapshotValues: { date: string; value: number }[],
  stableBalance: { date: string; balance: number }[],
): { date: string; value: number }[] {
  let si = -1;
  let level = 0;
  const out: { date: string; value: number }[] = [];
  for (const s of snapshotValues) {
    while (si + 1 < stableBalance.length && stableBalance[si + 1].date <= s.date) {
      si++;
      level = stableBalance[si].balance;
    }
    const v = s.value - level;
    if (v > 0) out.push({ date: s.date, value: v });
  }
  return out;
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run lib/utils/__tests__/crypto-performance.test.ts`
Expected: PASS. Also run `npx vitest run` — all suites green.

- [ ] **Step 6: Commit**

```bash
git add lib/utils/crypto-csv.ts lib/utils/crypto-performance.ts lib/utils/__tests__/crypto-performance.test.ts
git commit -m "feat(performance): crypto pot flows, stable balance replay, pot values"
```

---

### Task 2: Per-token stats

**Files:**
- Modify: `lib/utils/performance.ts:168-183` (add optional `badge?: string` to `HoldingPerfRow`)
- Modify: `lib/utils/crypto-performance.ts` (append `perTokenStats`)
- Test: `lib/utils/__tests__/crypto-performance.test.ts` (append)

**Interfaces:**
- Consumes: `computeHoldings`, `computeRealizedPnl` from `./crypto-csv`; `xirr`, `CashFlow`, `HoldingPerfRow` from `./performance`.
- Produces: `function perTokenStats(txs: CryptoTransaction[], livePrices: Record<string, number>, tickerMappings: Record<string, string>, isCash: (token: string) => boolean, todayIso: string): HoldingPerfRow[]` — non-cash tokens only, `badge: "CRYPTO"`, sorted by xirrPct desc (nulls last).

- [ ] **Step 1: Add `badge?: string` to HoldingPerfRow**

In `lib/utils/performance.ts`, add to the `HoldingPerfRow` interface after `closed: boolean;`:

```ts
  /** Optional UI chip label (e.g. "CRYPTO"). */
  badge?: string;
```

- [ ] **Step 2: Append failing tests**

```ts
import { perTokenStats } from "../crypto-performance";

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

  it("marks dust positions closed and keeps sold-out tokens with realized P&L", () => {
    const txs = [
      ctx({ date: "2026-04-01 09:00:00", token: "APT", type: "buy", amount: 100, priceUsd: 1, totalValueUsd: 100 }),
      ctx({ date: "2026-06-01 09:00:00", token: "APT", type: "sell", amount: 100, priceUsd: 1.5, totalValueUsd: 150 }),
    ];
    const r = perTokenStats(txs, {}, {}, cash, today)[0];
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
```

- [ ] **Step 3: Run tests, verify fail**

Run: `npx vitest run lib/utils/__tests__/crypto-performance.test.ts`
Expected: FAIL — `perTokenStats` not exported.

- [ ] **Step 4: Implement `perTokenStats`** (append to crypto-performance.ts)

```ts
import { computeHoldings, computeRealizedPnl } from "./crypto-csv";
import { xirr, type CashFlow, type HoldingPerfRow } from "./performance";
```

(merge with existing imports at top) then:

```ts
/** Per-token performance rows for non-cash tokens, shaped like stock rows.
 * IMPORTANT: computeHoldings DROPS fully-sold tokens (|amount| < 0.0001), so
 * rows are built from the UNION of open holdings and tokens that appear in
 * computeRealizedPnl.byToken — exited positions keep their realized P&L row. */
export function perTokenStats(
  txs: CryptoTransaction[],
  livePrices: Record<string, number>,
  tickerMappings: Record<string, string>,
  isCash: (token: string) => boolean,
  todayIso: string,
): HoldingPerfRow[] {
  const holdings = computeHoldings(txs).filter((h) => !isCash(h.token));
  const holdingByToken = new Map(holdings.map((h) => [h.token, h]));
  const realizedByToken = new Map(
    computeRealizedPnl(txs).byToken.map((r) => [r.token, r.realizedPnlUsd]),
  );
  const tokens = [...new Set([...holdingByToken.keys(), ...realizedByToken.keys()])]
    .filter((t) => !isCash(t));

  const rows: HoldingPerfRow[] = tokens.map((token) => {
    const h = holdingByToken.get(token);
    const own = txs.filter((t) => t.token === token);
    const livePrice =
      livePrices[token] ?? livePrices[tickerMappings[token] ?? token];
    const lastTxPrice = [...own]
      .reverse()
      .find((t) => t.priceUsd != null)?.priceUsd ?? 0;
    const price = livePrice ?? lastTxPrice;
    const closed = h == null || Math.abs(h.amount) < 1e-6;
    const valueUsd = closed ? 0 : h!.amount * price;
    const realized = realizedByToken.get(token) ?? 0;
    const gainUsd = valueUsd - (h?.totalCostUsd ?? 0) + realized;
    const grossBuysUsd = own
      .filter((t) => t.type === "buy" && t.totalValueUsd != null)
      .reduce((s, t) => s + (t.totalValueUsd as number), 0);
    const flows: CashFlow[] = own
      .filter(
        (t) =>
          (t.type === "buy" || t.type === "sell") &&
          t.totalValueUsd != null &&
          Number.isFinite(t.totalValueUsd),
      )
      .map((t) => ({
        date: t.date.slice(0, 10),
        amount: t.type === "buy" ? -(t.totalValueUsd as number) : (t.totalValueUsd as number),
      }));
    if (!closed && valueUsd > 0) flows.push({ date: todayIso, amount: valueUsd });
    return {
      holdingId: `crypto-${token}`,
      name: token,
      ticker: token,
      isOrphan: false,
      accountType: "normal",
      investedUsd: h?.totalCostUsd ?? 0,
      valueUsd,
      gainUsd,
      returnPct: grossBuysUsd > 0 ? gainUsd / grossBuysUsd : null,
      xirrPct: xirr(flows),
      closed,
      badge: "CRYPTO",
    };
  });

  return rows.sort((a, b) => {
    if (a.xirrPct == null && b.xirrPct == null) return b.gainUsd - a.gainUsd;
    if (a.xirrPct == null) return 1;
    if (b.xirrPct == null) return -1;
    return b.xirrPct - a.xirrPct;
  });
}
```

NOTE: `computeHoldings` returns `totalCostUsd` as the REMAINING cost basis
(avg-buy × remaining amount) and handles unpriced transferIns by shifting
amount without cost — exactly the semantics the row needs. Check its JSDoc in
`lib/utils/crypto-csv.ts:229` if behavior looks surprising.

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run`
Expected: all green (both test files).

- [ ] **Step 6: Commit**

```bash
git add lib/utils/performance.ts lib/utils/crypto-performance.ts lib/utils/__tests__/crypto-performance.test.ts
git commit -m "feat(performance): per-token crypto stats shaped as holding rows"
```

---

### Task 3: BTC branch in the benchmark route

**Files:**
- Modify: `app/api/benchmark/route.ts`

**Interfaces:**
- Produces: `GET /api/benchmark?symbol=BTC&from=YYYY-MM-DD` → `{ symbol: "BTC", prices: {date, close}[] }` from Binance klines; `symbol=SPY` (or absent) unchanged via Yahoo; any other symbol → 400 `{ error }`.

- [ ] **Step 1: Rewrite the route with a symbol whitelist**

Replace the file body so `GET` dispatches by symbol (Yahoo fetch stays exactly as-is, moved into `fetchSpy`):

```ts
import { NextRequest, NextResponse } from "next/server";

// Daily-close history for benchmark indices. SPY proxies the same unofficial
// Yahoo chart endpoint the snapshot cron relies on; BTC uses Binance klines
// (the app's existing crypto price source, no key required).

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
};

async function fetchSpy(period1: number, period2: number) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&period1=${period1}&period2=${period2}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 21600 },
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const timestamps: number[] | undefined = result?.timestamp;
  const closes: (number | null)[] | undefined =
    result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;
  const prices: { date: string; close: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c !== "number" || !Number.isFinite(c)) continue;
    prices.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close: c,
    });
  }
  return prices;
}

async function fetchBtc(startMs: number) {
  // Binance caps limit at 1000 daily candles (~2.7y) — plenty for this app.
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${startMs}&limit=1000`,
    { signal: AbortSignal.timeout(8000), next: { revalidate: 21600 } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as unknown[];
  if (!Array.isArray(data)) return null;
  const prices: { date: string; close: number }[] = [];
  for (const k of data) {
    if (!Array.isArray(k)) continue;
    const close = parseFloat(k[4] as string);
    if (!Number.isFinite(close)) continue;
    prices.push({
      date: new Date(k[0] as number).toISOString().slice(0, 10),
      close,
    });
  }
  return prices;
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "SPY").toUpperCase();
  if (symbol !== "SPY" && symbol !== "BTC") {
    return NextResponse.json({ error: `unsupported symbol ${symbol}` }, { status: 400 });
  }
  const from = req.nextUrl.searchParams.get("from");
  const fromMs = from
    ? Date.parse(from + "T00:00:00Z") - 14 * 86400000
    : Date.parse("2020-01-01");
  const startMs = Number.isFinite(fromMs) ? fromMs : Date.parse("2020-01-01");

  try {
    const prices =
      symbol === "BTC"
        ? await fetchBtc(startMs)
        : await fetchSpy(Math.floor(startMs / 1000), Math.floor(Date.now() / 1000));
    if (!prices || prices.length === 0) {
      return NextResponse.json({ error: "upstream failed" }, { status: 502 });
    }
    return NextResponse.json({ symbol, prices }, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ error: "benchmark fetch failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Smoke-test both symbols**

Dev server (mind port collisions — use the printed port): `curl -s "http://localhost:<port>/api/benchmark?symbol=BTC&from=2026-03-01" | head -c 200` → `{"symbol":"BTC","prices":[{"date":"2026-02-…`. Repeat with `symbol=SPY` and with `symbol=DOGE` (expect 400).

- [ ] **Step 3: Commit**

```bash
git add app/api/benchmark/route.ts
git commit -m "feat(performance): BTC benchmark via Binance klines"
```

---

### Task 4: Chart + stats + table component generalization

**Files:**
- Modify: `app/(app)/performance/_components/growth-chart.tsx` (N benchmarks)
- Modify: `app/(app)/performance/_components/perf-stats.tsx` (generic vs-tile)
- Modify: `app/(app)/performance/_components/holdings-performance-table.tsx` (badge chip + unpriced footnote)
- Modify: `app/(app)/performance/_components/value-contributions-chart.tsx` (subtitle prop)

**Interfaces:**
- Produces (consumed by Task 5's page):
  - `GrowthChart({ twrSeries, benchmarks, isDark })` where `benchmarks: { name: string; color: string; dashType: "dashed" | "dotted"; series: { date: string; index: number }[] }[]`
  - `PerfStats({ xirrPct, twrPct, twrLabel, netGainUsd, gainSub, vs })` where `vs: { label: string; pct: number | null; sub: string }` and `gainSub: string`
  - `HoldingsPerformanceTable({ rows, removedExcluded, footnote })` — renders `row.badge` as a chip; optional `footnote?: string` muted line under the header
  - `ValueContributionsChart({ values, contributions, isDark, subtitle })`

- [ ] **Step 1: Validate the BTC line color (dataviz requirement)**

From the dataviz skill base directory, run for BOTH surfaces:

```bash
node scripts/validate_palette.js "#4d7cc7,#d47633,#c050b0" --mode light --surface "#f4f3ed"
node scripts/validate_palette.js "#4d7cc7,#d47633,#c050b0" --mode dark --surface "#242424"
```

`#c050b0` is ECHARTS_COLORS[13] (magenta), the BTC candidate next to blue [0] and orange [6]. If any check FAILs, try `#e06090` (rose, [8]) then `#7c5cc9` (violet, [9]) and use the first ALL-PASS. Record the winner in the commit message. A light-mode contrast WARN is acceptable ONLY because every benchmark has a legend entry, a distinct dash pattern, and a text stat (relief per the skill).

- [ ] **Step 2: Generalize GrowthChart**

Replace `spySeries` prop with `benchmarks`; the aligned-forward-fill loop runs per benchmark:

```tsx
export function GrowthChart({
  twrSeries,
  benchmarks,
  isDark,
}: {
  twrSeries: { date: string; index: number }[];
  benchmarks: {
    name: string;
    color: string;
    dashType: "dashed" | "dotted";
    series: { date: string; index: number }[];
  }[];
  isDark: boolean;
}) {
  const alignedAll = useMemo(
    () =>
      benchmarks.map((b) => {
        let si = -1;
        let level: number | null = null;
        return b.series.length
          ? twrSeries.map((p) => {
              while (si + 1 < b.series.length && b.series[si + 1].date <= p.date) {
                si++;
                level = b.series[si].index;
              }
              return level;
            })
          : null;
      }),
    [twrSeries, benchmarks],
  );
  // …series array becomes:
  // [ portfolio line (unchanged, ECHARTS_COLORS[0]),
  //   ...benchmarks.flatMap((b, i) => alignedAll[i] ? [{
  //       name: b.name, type: "line" as const, color: b.color,
  //       data: alignedAll[i]!.map((v) => (v == null ? null : Math.round(v * 100) / 100)),
  //       smooth: true, showSymbol: false,
  //       lineStyle: { width: 1.5, type: b.dashType },
  //     }] : []) ]
```

Update the header copy to "GROWTH OF 100" with subtitle unchanged; keep empty state. (Full-file rewrite is fine — keep everything else as it is today.)

- [ ] **Step 3: Generalize PerfStats**

Replace props `dividendsUsd`/`vsSpyPct` with `gainSub: string` and `vs: { label; pct; sub }`; tiles 3 and 4 become:

```tsx
    {
      label: "NET GAIN",
      value: `${gain >= 0 ? "+" : "-"}${format(Math.abs(gain))}`,
      tone: gain >= 0 ? "up" : "down",
      sub: gainSub,
    },
    {
      label: vs.label,
      value: vs.pct == null ? "—" : `${vs.pct >= 0 ? "+" : ""}${(vs.pct * 100).toFixed(1)}pp`,
      tone: vs.pct == null ? "muted" : vs.pct >= 0 ? "up" : "down",
      sub: vs.sub,
    },
```

(The page computes `gainSub` — dividends line in stocks scope, "value − net contributions" otherwise — and `vs` per scope.)

- [ ] **Step 4: Table badge + footnote**

In the name cell chips block add `{r.badge && <Chip>{r.badge}</Chip>}` before the NOT IN STATS chip; add optional `footnote` prop rendered under the header subtitle when set:

```tsx
{footnote && <p className="text-[11px] text-muted-foreground mt-1">{footnote}</p>}
```

- [ ] **Step 5: ValueContributionsChart subtitle prop**

Add `subtitle: string` prop; replace the hardcoded `<p className="text-xs …">` copy with `{subtitle}`.

- [ ] **Step 6: Compile check**

`npx tsc --noEmit` will FAIL in `page.tsx` (old props) — expected; Task 5 fixes the call sites. Verify the four component files themselves have no OTHER errors, then proceed (do NOT commit yet — Task 5 commits the working whole).

---

### Task 5: Page scope wiring

**Files:**
- Modify: `app/(app)/performance/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4 plus existing `parseCryptoCSV` (`@/lib/utils/crypto-csv`).
- Produces: user-facing Stocks | Crypto | All scopes, default All.

- [ ] **Step 1: New state + crypto data plumbing**

Add to imports: `parseCryptoCSV` from `@/lib/utils/crypto-csv`; `isCashLikeToken, cryptoNetFlowsByDay, stableBalanceByDay, cryptoPotValues, perTokenStats` from `@/lib/utils/crypto-performance`; `ECHARTS_COLORS` from `@/lib/utils/echarts`.

```tsx
type Scope = "stocks" | "crypto" | "all";
const SCOPES: { value: Scope; label: string }[] = [
  { value: "stocks", label: "Stocks" },
  { value: "crypto", label: "Crypto" },
  { value: "all", label: "All" },
];
// BTC benchmark line color — validated (Task 4 Step 1) against blue+orange.
const BTC_COLOR = "#c050b0"; // replace with the validator's winner if different
```

State + storage:

```tsx
  const [scope, setScope] = useState<Scope>("all");
  const [txCsvText] = useCloudStorage<string>("crypto_tx_csv_text", "");
  const [cryptoSnapshots] = useCloudStorage<SnapshotLike[]>("crypto_snapshots", []);
  const [stablecoinTags] = useCloudStorage<Record<string, boolean>>("crypto_stablecoin_tags", {});
  const [tickerMappings] = useCloudStorage<Record<string, string>>("crypto_ticker_mappings", {});
  const [cryptoPrices] = useCloudStorage<{ prices: Record<string, number> }>("crypto_prices", { prices: {} });
  const [btc, setBtc] = useState<SpyCache["prices"] | null>(null);
```

BTC fetch effect: duplicate the SPY effect with key `benchmark_btc_cache` and URL `/api/benchmark?symbol=BTC&from=2020-01-01` (extract a small `useBenchmark(symbol)`-style helper inline: one function `loadBenchmark(symbol: "SPY" | "BTC", cacheKey: string, set: (p: SpyCache["prices"]) => void)` called from one effect for both symbols).

- [ ] **Step 2: Crypto derived data**

```tsx
  const cryptoTxs = useMemo(() => (txCsvText ? parseCryptoCSV(txCsvText) : []), [txCsvText]);
  const isCash = useMemo(
    () => (token: string) => isCashLikeToken(token, stablecoinTags),
    [stablecoinTags],
  );
  const cryptoFlowsResult = useMemo(
    () => cryptoNetFlowsByDay(cryptoTxs, isCash),
    [cryptoTxs, isCash],
  );
  const cryptoValues = useMemo(() => {
    const snapVals = dailySnapshotValues(cryptoSnapshots, false);
    return cryptoPotValues(snapVals, stableBalanceByDay(cryptoTxs, isCash));
  }, [cryptoSnapshots, cryptoTxs, isCash]);
  const cryptoRows = useMemo(
    () => perTokenStats(cryptoTxs, cryptoPrices.prices ?? {}, tickerMappings, isCash, today),
    [cryptoTxs, cryptoPrices, tickerMappings, isCash, today],
  );
  const cryptoCurrentValueUsd = useMemo(
    () => cryptoRows.reduce((s, r) => s + r.valueUsd, 0),
    [cryptoRows],
  );
```

- [ ] **Step 3: Scope selection memos**

Rename existing stock derivations where needed (`flows` → `stockFlows`, `values` → `stockValues`, `holdingRows` → `stockRows`, `currentValueUsd` → `stockCurrentValueUsd`) then select:

```tsx
  const scopeFlows = useMemo(() => {
    if (scope === "stocks") return stockFlows;
    if (scope === "crypto") return cryptoFlowsResult.flows;
    const merged = new Map<string, number>();
    for (const f of [...stockFlows, ...cryptoFlowsResult.flows]) {
      merged.set(f.date, (merged.get(f.date) ?? 0) + f.amount);
    }
    return [...merged.entries()]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [scope, stockFlows, cryptoFlowsResult]);

  const scopeValues = useMemo(() => {
    if (scope === "stocks") return stockValues;
    if (scope === "crypto") return cryptoValues;
    // All: union of dates, forward-fill each side once it has appeared.
    const dates = [...new Set([...stockValues, ...cryptoValues].map((v) => v.date))].sort();
    const out: { date: string; value: number }[] = [];
    let si = -1, ci = -1, sLevel: number | null = null, cLevel: number | null = null;
    for (const d of dates) {
      while (si + 1 < stockValues.length && stockValues[si + 1].date <= d) { si++; sLevel = stockValues[si].value; }
      while (ci + 1 < cryptoValues.length && cryptoValues[ci + 1].date <= d) { ci++; cLevel = cryptoValues[ci].value; }
      if (sLevel != null && cLevel != null) out.push({ date: d, value: sLevel + cLevel });
    }
    return out;
  }, [scope, stockValues, cryptoValues]);

  const scopeCurrentValueUsd =
    scope === "stocks" ? stockCurrentValueUsd
    : scope === "crypto" ? cryptoCurrentValueUsd
    : stockCurrentValueUsd + cryptoCurrentValueUsd;

  const scopeRows = useMemo(() => {
    const rows =
      scope === "stocks" ? stockRows
      : scope === "crypto" ? cryptoRows
      : [...stockRows, ...cryptoRows];
    return [...rows].sort((a, b) => {
      if (a.isOrphan !== b.isOrphan) return a.isOrphan ? 1 : -1;
      if (a.xirrPct == null && b.xirrPct == null) return b.gainUsd - a.gainUsd;
      if (a.xirrPct == null) return 1;
      if (b.xirrPct == null) return -1;
      return b.xirrPct - a.xirrPct;
    });
  }, [scope, stockRows, cryptoRows]);
```

Downstream, `periodValues`/`firstFlowDate`/`twr`/`xirrAllTime`/`netContributedUsd`/`netGainUsd` all switch to `scopeFlows`/`scopeValues`/`scopeCurrentValueUsd` (same formulas — only the inputs renamed).

- [ ] **Step 4: Benchmarks per scope + stats props**

```tsx
  const benchIndex = (prices: SpyCache["prices"] | null) => {
    if (!prices || prices.length === 0 || twr.series.length < 2) return null;
    const start = twr.series[0].date;
    const end = twr.series[twr.series.length - 1].date;
    const inWindow = prices.filter((p) => p.date >= start && p.date <= end);
    if (inWindow.length < 2) return null;
    const base = inWindow[0].close;
    return {
      series: inWindow.map((p) => ({ date: p.date, index: (p.close / base) * 100 })),
      totalReturn: inWindow[inWindow.length - 1].close / base - 1,
    };
  };
  const spyStats = useMemo(() => benchIndex(spy), [spy, twr.series]);
  const btcStats = useMemo(() => benchIndex(btc), [btc, twr.series]);

  const growthBenchmarks = useMemo(() => {
    const list = [];
    if (scope === "crypto" && btcStats)
      list.push({ name: "BTC", color: BTC_COLOR, dashType: "dashed" as const, series: btcStats.series });
    if (spyStats)
      list.push({ name: "S&P 500", color: ECHARTS_COLORS[6], dashType: (scope === "crypto" ? "dotted" : "dashed") as "dashed" | "dotted", series: spyStats.series });
    return list;
  }, [scope, btcStats, spyStats]);

  const vs = useMemo(() => {
    const t = twr.totalReturn;
    if (scope === "crypto") {
      return {
        label: "VS BTC",
        pct: t != null && btcStats ? t - btcStats.totalReturn : null,
        sub:
          t != null && spyStats
            ? `vs S&P ${(t - spyStats.totalReturn) * 100 >= 0 ? "+" : ""}${((t - spyStats.totalReturn) * 100).toFixed(1)}pp`
            : "TWR minus BTC, same period",
      };
    }
    return {
      label: "VS S&P 500",
      pct: t != null && spyStats ? t - spyStats.totalReturn : null,
      sub: "TWR minus SPY, same period",
    };
  }, [scope, twr.totalReturn, btcStats, spyStats]);

  const gainSub =
    scope === "stocks" && dividendsUsd > 0
      ? `+ ${format(convert(dividendsUsd, "USD"))} dividends received`
      : scope === "crypto"
        ? "market gains + yield"
        : "value − net contributions";
```

- [ ] **Step 5: Render changes**

- Scope segmented control (same button-group styling as PERIODS) left of the toggles; Super/Removed buttons wrapped in `{scope !== "crypto" && (…)}`.
- Drift banner wrapped in `{scope !== "crypto" && drift.length > 0 && (…)}`.
- Crypto-scope note under the header subtitle: `{scope === "crypto" && (<p className="text-xs text-muted-foreground">Stablecoins count as cash; transfers count as yield.</p>)}`.
- Crypto empty state: `{scope !== "stocks" && cryptoTxs.length === 0 && (…finance-card: "No crypto transaction CSV uploaded — the Crypto page's Upload section feeds this scope."…)}` — and All scope silently equals stocks in that case (the memos already do).
- `<PerfStats … gainSub={gainSub} vs={vs} />`; `<ValueContributionsChart … subtitle={scope === "crypto" ? "The gap is market gains + yield your coins generated." : "The gap between the lines is money your investments actually made."} />`; `<GrowthChart twrSeries={twr.series} benchmarks={growthBenchmarks} isDark={isDark} />`; `<HoldingsPerformanceTable rows={scopeRows} removedExcluded={!includeRemoved} footnote={scope !== "stocks" && cryptoFlowsResult.skippedUnpriced > 0 ? `${cryptoFlowsResult.skippedUnpriced} unpriced crypto rows ignored in flows` : undefined} />`.
- Header subtitle: replace "Stocks only for now." with "Stocks, crypto, or everything — pick a scope."

- [ ] **Step 6: Verify compile + lint + tests**

`npx tsc --noEmit` (no errors outside `.worktrees`), `npx eslint "app/(app)/performance" app/api/benchmark lib/utils` (0 errors), `npx vitest run` (all green).

- [ ] **Step 7: Commit**

```bash
git add app/(app)/performance lib/utils app/api/benchmark
git commit -m "feat(performance): Stocks | Crypto | All scopes with BTC+SPY benchmarks"
```

---

### Task 6: Final verification against real data

- [ ] **Step 1: Full suite + build** — `pnpm test` all green; `pnpm build` succeeds.
- [ ] **Step 2: Replay check** — node script (scratchpad) replaying `cryptoNetFlowsByDay`+`cryptoPotValues`+`computeTwr` against the real Supabase data; confirm crypto TWR is finite/sane and flows total roughly matches non-cash buys−sells computed independently.
- [ ] **Step 3: Browser smoke** — dev server: all three scopes render; crypto scope shows BTC+SPY lines and vs-BTC stat; All matches stocks+crypto sum sanity; toggles hidden in crypto scope; screenshot each scope and EYEBALL (labels, legends, empty states).
- [ ] **Step 4: Update spec/memory if reality disagrees** — any real-data surprise gets the stocks-iteration treatment: diagnose with a replay script before changing math.
- [ ] **Step 5: Merge** — fast-forward `feat/crypto-performance` into main after green tests, delete branch.
