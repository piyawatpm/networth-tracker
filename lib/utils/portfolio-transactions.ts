import type { PortfolioTransaction } from "./types";

const STORAGE_KEY = "portfolio_transactions";
const MAX_ENTRIES = 500;

export function getTransactions(): PortfolioTransaction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTransactions(txns: PortfolioTransaction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(txns.slice(0, MAX_ENTRIES)));
}

export function addTransaction(tx: PortfolioTransaction): void {
  const txns = getTransactions();
  txns.unshift(tx);
  saveTransactions(txns);
}

export function getTransactionsForHolding(holdingId: string): PortfolioTransaction[] {
  return getTransactions().filter((t) => t.holdingId === holdingId);
}

export function getTransactionsInDateRange(from: string, to: string): PortfolioTransaction[] {
  return getTransactions().filter((t) => t.date >= from && t.date <= to);
}

export function getBuysInDateRange(from: string, to: string): PortfolioTransaction[] {
  return getTransactionsInDateRange(from, to).filter((t) => t.type === "buy");
}

export function totalInvestedInRange(
  from: string,
  to: string,
  convert: (amount: number, currency: string) => number,
): number {
  return getBuysInDateRange(from, to).reduce(
    (sum, tx) => sum + convert(tx.totalAmount, tx.currency),
    0,
  );
}
