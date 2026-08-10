// "What if I had put the same money, on the same days, into an index instead?"
//
// This is a different question from the TWR-vs-index tile. TWR deliberately
// strips out the size and timing of deposits to isolate picking skill; this
// module keeps them, because the money-in-your-pocket answer depends on when
// the cash actually landed. With lumpy weekly contributions the two can point
// opposite ways — you can beat the index per-unit-of-time and still have less
// money than a DCA into it, if your good stretch happened while you had little
// capital deployed.
//
// Both sides are measured as PROFIT AND LOSS, not ending value. Capital you
// deposited is not performance, so it is subtracted from both:
//
//     P&L = endValue − startValue − netFlows(start, end]
//
// The counterfactual deploys exactly the same capital on exactly the same
// dates, so `invested` is identical across every row and the P&L columns are
// directly comparable.

import type { DailyFlow } from "./performance";

export interface PricePoint {
  date: string;
  /** Adjusted close — dividends folded in, so this is a total-return series. */
  close: number;
}

export interface DcaOutcome {
  /** Opening value + net flows over the window. Same for you and every index. */
  invested: number;
  /** What the position is worth at the end of the window. */
  endValue: number;
  /** endValue − invested. The comparable number. */
  pnl: number;
  /** pnl / |invested|, or null when no capital was deployed. */
  pnlPct: number | null;
}

/**
 * Price on `date`, or the most recent one before it (forward-fill over
 * weekends and holidays). Null when `date` precedes the whole series.
 * `prices` must be ascending by date.
 */
export function priceAsOf(prices: PricePoint[], date: string): number | null {
  let lo = 0;
  let hi = prices.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid].date <= date) {
      found = prices[mid].close;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Value of a series on `date`, forward-filled. Used to read the portfolio's
 * own level at the window edges from its snapshot history.
 */
export function valueAsOf(
  values: { date: string; value: number }[],
  date: string,
): number | null {
  return valueRowAsOf(values, date)?.value ?? null;
}

/**
 * Same forward-fill, but keeps the reading's own date. Callers use it to
 * decide whether the opening value genuinely reads from the start day or is
 * a stale fill from earlier — which changes whether start-day flows count
 * (see `includeStartFlows`).
 */
export function valueRowAsOf(
  values: { date: string; value: number }[],
  date: string,
): { date: string; value: number } | null {
  let lo = 0;
  let hi = values.length - 1;
  let found: { date: string; value: number } | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid].date <= date) {
      found = values[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Net external flow in `(start, end]` — or `[start, end]` with
 * `includeStartFlows`.
 *
 * Pass `includeStartFlows: true` when the opening value was forward-filled
 * from BEFORE the start day (`valueRowAsOf(values, start).date < start`):
 * the window then begins on a flow day whose money is in neither the opening
 * value nor the strict-after flows, and excluding it books that whole deposit
 * as fake profit. When the opening reading is the start day itself it already
 * contains the money, and counting the flow again would double it.
 */
export function netFlowsInWindow(
  flows: DailyFlow[],
  start: string,
  end: string,
  includeStartFlows = false,
): number {
  return flows.reduce(
    (sum, f) =>
      (f.date > start || (includeStartFlows && f.date === start)) && f.date <= end
        ? sum + f.amount
        : sum,
    0,
  );
}

/**
 * Your actual P&L over the window, on the same definition the counterfactual
 * uses. Null when the value series has no reading at or before `start` — that
 * means the window opens before any tracked history, and a P&L computed off a
 * phantom opening balance would be worse than no number at all.
 */
export function windowPnl(
  values: { date: string; value: number }[],
  flows: DailyFlow[],
  start: string,
  end: string,
  endValueOverride?: number,
  includeStartFlows = false,
): DcaOutcome | null {
  const startValue = valueAsOf(values, start);
  if (startValue == null) return null;
  const endValue = endValueOverride ?? valueAsOf(values, end);
  if (endValue == null) return null;

  const net = netFlowsInWindow(flows, start, end, includeStartFlows);
  const invested = startValue + net;
  const pnl = endValue - invested;
  return {
    invested,
    endValue,
    pnl,
    pnlPct: Math.abs(invested) > 1e-9 ? pnl / Math.abs(invested) : null,
  };
}

/**
 * Replay the same capital into an index.
 *
 * The opening balance is treated as a lump-sum purchase on `start` (it was
 * already deployed on day one), and every later net flow buys or sells index
 * units at that day's close. Units are allowed to go negative only in the sense
 * that a withdrawal larger than the position is clamped — selling more index
 * than you hold is not a scenario the comparison can represent, and letting it
 * go short would silently invert the result.
 *
 * Returns null when the index has no price at or before `start`.
 */
export function simulateDca(
  openingValue: number,
  flows: DailyFlow[],
  prices: PricePoint[],
  start: string,
  end: string,
  includeStartFlows = false,
): DcaOutcome | null {
  const startPrice = priceAsOf(prices, start);
  const endPrice = priceAsOf(prices, end);
  if (startPrice == null || endPrice == null || startPrice <= 0) return null;

  let units = openingValue / startPrice;
  let invested = openingValue;

  // Must mirror windowPnl's flag exactly — `invested` being identical across
  // the "You" row and every index row is the module's core promise.
  const inWindow = flows
    .filter(
      (f) =>
        (f.date > start || (includeStartFlows && f.date === start)) &&
        f.date <= end,
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const f of inWindow) {
    const px = priceAsOf(prices, f.date);
    if (px == null || px <= 0) continue;
    const delta = f.amount / px;
    // A withdrawal bigger than the position would flip this short.
    units = Math.max(0, units + delta);
    invested += f.amount;
  }

  const endValue = units * endPrice;
  const pnl = endValue - invested;
  return {
    invested,
    endValue,
    pnl,
    pnlPct: Math.abs(invested) > 1e-9 ? pnl / Math.abs(invested) : null,
  };
}
