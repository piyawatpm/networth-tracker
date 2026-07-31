import type { PortfolioTransaction, RealizedSaleEvent } from "./types";

export interface DerivedPosition {
  /** Net units held according to the transaction log (buys − sells). */
  units: number;
  /** Remaining cost basis (average-cost method), in `targetCurrency`. */
  costBasis: number;
  /** Locked-in profit/loss from past sells, in `targetCurrency`. */
  realizedPnl: number;
  /** Gross units ever bought. */
  totalBought: number;
  /** Gross units ever sold. */
  totalSold: number;
}

/**
 * Replay a holding's transactions oldest → newest using the average-cost
 * method to derive net units, remaining cost basis and realized P&L.
 *
 * Realized P&L on a sell = proceeds − (avgCost × unitsSold). The remaining
 * cost basis is reduced by the same `avgCost × unitsSold`, so the per-unit
 * cost of the leftover position stays put (matches how brokers report it and
 * mirrors the crypto page's avg-buy-price logic).
 *
 * Each leg's amount is converted into `targetCurrency` so the result can be
 * compared across holdings or displayed without further conversion. Sorting by
 * date is required so each sell uses the average cost as it stood at that time.
 */
export function derivePosition(
  transactions: PortfolioTransaction[],
  targetCurrency: string,
  convert: (amount: number, from: string, to?: string) => number,
): DerivedPosition {
  return replayTransactions(transactions, targetCurrency, convert);
}

/**
 * The shared replay behind both `derivePosition` and `deriveRealizedSales`.
 *
 * `onSale` fires once per sell with that sell's own realized P&L, so the
 * per-event breakdown and the aggregate always come from the same arithmetic —
 * they cannot drift. It stays optional so the aggregate-only callers (which run
 * this in per-holding loops on the performance page) allocate nothing extra.
 */
function replayTransactions(
  transactions: PortfolioTransaction[],
  targetCurrency: string,
  convert: (amount: number, from: string, to?: string) => number,
  onSale?: (tx: PortfolioTransaction, realized: number) => void,
): DerivedPosition {
  const sorted = [...transactions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt,
  );

  let units = 0;
  let costBasis = 0;
  let realizedPnl = 0;
  let totalBought = 0;
  let totalSold = 0;

  for (const tx of sorted) {
    const amount = convert(tx.totalAmount, tx.currency, targetCurrency);
    if (tx.type === "buy") {
      units += tx.units;
      costBasis += amount;
      totalBought += tx.units;
    } else {
      // Can't realize P&L against units that aren't in the log; clamp so a
      // stray oversell doesn't invent a cost basis.
      const soldUnits = units > 0 ? Math.min(tx.units, units) : 0;
      const avgCost = units > 0 ? costBasis / units : 0;
      const costOfSold = avgCost * soldUnits;
      const gain = amount - costOfSold;
      realizedPnl += gain;
      costBasis = Math.max(0, costBasis - costOfSold);
      units -= tx.units;
      totalSold += tx.units;
      onSale?.(tx, gain);
    }
  }

  // Squash floating-point dust so "sell all" lands cleanly on zero.
  if (Math.abs(units) < 1e-9) units = 0;
  if (costBasis < 1e-9) costBasis = 0;

  return { units, costBasis, realizedPnl, totalBought, totalSold };
}

/** Gains below this are rounding dust, not something worth a row on the income page. */
const DUST_THRESHOLD = 0.01;

/**
 * Project the buy/sell log into one realized-gain event per sell.
 *
 * Each holding is replayed in its own quote currency (taken from its earliest
 * transaction) rather than a shared display currency, so the event carries a
 * native amount and the income page can convert it at render time like any
 * hand-entered row. Transactions are grouped by `holdingId`, so a holding that
 * has since been deleted still contributes its history.
 *
 * Summing the events of one holding reproduces `derivePosition(...).realizedPnl`
 * for that holding, minus any sub-cent rows filtered as dust.
 */
export function deriveRealizedSales(
  transactions: PortfolioTransaction[],
  convert: (amount: number, from: string, to?: string) => number,
  tickerFor?: (holdingId: string) => string | undefined,
): RealizedSaleEvent[] {
  const byHolding = new Map<string, PortfolioTransaction[]>();
  for (const tx of transactions) {
    const group = byHolding.get(tx.holdingId);
    if (group) group.push(tx);
    else byHolding.set(tx.holdingId, [tx]);
  }

  const events: RealizedSaleEvent[] = [];
  for (const [holdingId, group] of byHolding) {
    // Earliest leg defines the holding's quote currency (see the currency
    // invariant: every leg of a holding is stamped with the same currency).
    const baseCurrency = group.reduce((earliest, tx) =>
      tx.date < earliest.date ||
      (tx.date === earliest.date && tx.createdAt < earliest.createdAt)
        ? tx
        : earliest,
    ).currency;

    replayTransactions(group, baseCurrency, convert, (tx, realized) => {
      if (Math.abs(realized) < DUST_THRESHOLD) return;
      events.push({
        id: `rp-stocks-${tx.id}`,
        source: "stocks",
        date: tx.date,
        label: tx.holdingName,
        ticker: tickerFor?.(holdingId) || tx.holdingName,
        realized,
        currency: baseCurrency,
      });
    });
  }

  return events;
}

export function getTransactionsForHolding(
  transactions: PortfolioTransaction[],
  holdingId: string,
): PortfolioTransaction[] {
  return transactions.filter((t) => t.holdingId === holdingId);
}

export function getTransactionsInDateRange(
  transactions: PortfolioTransaction[],
  from: string,
  to: string,
): PortfolioTransaction[] {
  return transactions.filter((t) => t.date >= from && t.date <= to);
}

export function totalInvestedInRange(
  transactions: PortfolioTransaction[],
  from: string,
  to: string,
  convert: (amount: number, currency: string) => number,
): number {
  return transactions
    .filter((t) => t.type === "buy" && t.date >= from && t.date <= to)
    .reduce((sum, tx) => sum + convert(tx.totalAmount, tx.currency), 0);
}
