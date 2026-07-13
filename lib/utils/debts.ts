/**
 * Shared debt math — the single source of truth for how a debt's balance is
 * computed everywhere (liabilities page, dashboard, cron + manual snapshots).
 *
 * A debt's net position is SIGNED from my perspective: positive = they owe me,
 * negative = I owe them. Overpaying a loan flips the sign, so an "owed to me"
 * record that was paid back more than it was borrowed correctly becomes
 * something I owe them. Totals classify each debt by the sign of its net —
 * never by the record's stored `direction` — otherwise an overpaid ledger gets
 * clamped to zero and further +/- transactions stop affecting net worth.
 *
 * Structural parameter types (rather than DebtRecord/DebtTransaction) let the
 * server-side snapshot routes, which parse loosely-typed JSON, share the math.
 */

interface DebtLike {
  id: string;
  direction: string; // "owed_to_me" | "i_owe"
  originalAmount: number;
}

interface DebtTxLike {
  debtId: string;
  amount: number; // positive = repayment (reduces the loan), negative = borrowed more
}

export interface DebtTotals {
  owedToMe: number;
  iOwe: number;
}

/** Signed net position from my perspective: positive = they owe me, negative = I owe them. */
export function debtNetToMe(debt: DebtLike, transactions: readonly DebtTxLike[]): number {
  const paid = transactions
    .filter((t) => t.debtId === debt.id)
    .reduce((sum, t) => sum + t.amount, 0);
  const loanBalance = debt.originalAmount - paid; // remaining on the original loan (signed)
  return debt.direction === "owed_to_me" ? loanBalance : -loanBalance;
}

/**
 * Total owedToMe / iOwe across all debts, each converted via `convert`
 * (e.g. to the display currency client-side, or to USD in snapshot routes).
 */
export function computeDebtTotals<C extends string>(
  debts: readonly (DebtLike & { currency: C })[],
  transactions: readonly DebtTxLike[],
  convert: (amount: number, currency: C) => number,
): DebtTotals {
  let owedToMe = 0;
  let iOwe = 0;
  for (const debt of debts) {
    const net = debtNetToMe(debt, transactions);
    if (net === 0) continue;
    const converted = convert(Math.abs(net), debt.currency);
    if (net > 0) owedToMe += converted;
    else iOwe += converted;
  }
  return { owedToMe, iOwe };
}

/**
 * Reconstructs debt totals as they stood on a historical date by replaying
 * records and transactions: a debt only counts if it was created on/before
 * `date`, and transactions only count if dated on/before `date`. This lets the
 * dashboard's debt overlay work even for snapshots from before debt tracking
 * was added, so long as the records & transactions still exist.
 *
 * `date` may be a bare "YYYY-MM-DD" or a snapshot timestamp
 * "YYYY-MM-DD HH:MM" — only the day part is used, inclusively.
 */
export function computeDebtTotalsAtDate<C extends string>(
  date: string,
  debts: readonly (DebtLike & { currency: C; createdAt: number })[],
  transactions: readonly (DebtTxLike & { date: string })[],
  convert: (amount: number, currency: C) => number,
): DebtTotals {
  const day = date.slice(0, 10);
  // `createdAt` is a unix-ms timestamp; comparing against end-of-day captures
  // any debt created earlier that day (avoids off-by-one excludes).
  const endOfDayMs = new Date(`${day}T23:59:59`).getTime();
  const debtsAsOf = debts.filter((d) => d.createdAt <= endOfDayMs);
  const txsAsOf = transactions.filter((t) => t.date.slice(0, 10) <= day);
  return computeDebtTotals(debtsAsOf, txsAsOf, convert);
}
