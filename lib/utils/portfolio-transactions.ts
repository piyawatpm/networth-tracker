import type { PortfolioTransaction } from "./types";

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
