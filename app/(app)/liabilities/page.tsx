"use client";

import { useState, useMemo } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import { cn } from "@/lib/utils";
import { formatDateString } from "@/lib/utils/timezone";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Handshake,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
} from "lucide-react";
import type { DebtRecord, DebtTransaction } from "@/lib/utils/types";
import { CURRENCY_SYMBOLS } from "@/lib/utils/types";
import {
  LiabilityDialog,
  PaymentDialog,
  DeleteConfirmDialog,
} from "@/components/liabilities/liability-dialogs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDebtPayments(
  debtId: string,
  transactions: DebtTransaction[]
): DebtTransaction[] {
  return transactions
    .filter((t) => t.debtId === debtId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getTotalPaid(debtId: string, transactions: DebtTransaction[]): number {
  return transactions
    .filter((t) => t.debtId === debtId)
    .reduce((sum, t) => sum + t.amount, 0);
}

// Signed net position from *my* perspective: positive = others owe me,
// negative = I owe others. Overpaying a loan flips the sign, which is how an
// entry that was paid back more than it was borrowed correctly becomes
// something I owe them — without discarding the original amount or payments.
function getNetToMe(debt: DebtRecord, transactions: DebtTransaction[]): number {
  const paid = getTotalPaid(debt.id, transactions);
  const loanBalance = debt.originalAmount - paid; // remaining on the original loan (signed)
  return debt.direction === "owed_to_me" ? loanBalance : -loanBalance;
}

function getProgressPercent(
  debt: DebtRecord,
  transactions: DebtTransaction[]
): number {
  const paid = getTotalPaid(debt.id, transactions);
  if (debt.originalAmount <= 0) return 100;
  return Math.min(100, Math.max(0, (paid / debt.originalAmount) * 100));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LiabilitiesPage() {
  const [debts, setDebts] = useCloudStorage<DebtRecord[]>("debt_records", []);
  const [transactions, setTransactions] = useCloudStorage<DebtTransaction[]>(
    "debt_transactions",
    []
  );
  const { convert, currency } = useCurrency();

  // Track which debt cards have expanded payment history
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // ------ Totals (converted to display currency) ------
  const convertedTotals = useMemo(() => {
    let owedToMe = 0;
    let iOwe = 0;

    for (const debt of debts) {
      const netToMe = getNetToMe(debt, transactions);
      if (netToMe === 0) continue;

      const converted = convert(Math.abs(netToMe), debt.currency);
      if (netToMe > 0) {
        owedToMe += converted;
      } else {
        iOwe += converted;
      }
    }

    return { owedToMe, iOwe, net: owedToMe - iOwe };
  }, [debts, transactions, convert]);

  // ------ Sorted debts: newest first (paid-off entries stay put, never retired) ------
  const sortedDebts = useMemo(() => {
    return [...debts].sort((a, b) => b.createdAt - a.createdAt);
  }, [debts]);

  // ------ Handlers ------
  function handleSaveDebt(saved: DebtRecord) {
    setDebts((prev) => {
      const idx = prev.findIndex((d) => d.id === saved.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = saved;
        return updated;
      }
      return [...prev, saved];
    });
  }

  function handleDeleteDebt(id: string) {
    setDebts((prev) => prev.filter((d) => d.id !== id));
    // Clean up associated transactions
    setTransactions((prev) => prev.filter((t) => t.debtId !== id));
  }

  // Flip a debt between "Owed to Me" and "I Owe", keeping all payments intact.
  function handleReverseDirection(id: string) {
    setDebts((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, direction: d.direction === "i_owe" ? "owed_to_me" : "i_owe" }
          : d
      )
    );
  }

  function handleSaveTransaction(saved: DebtTransaction) {
    setTransactions((prev) => [...prev, saved]);
  }

  function handleDeleteTransaction(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <BlurFade delay={0}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="label-mono mb-2">Liabilities</p>
              <div className={cn(
                "display-number",
                convertedTotals.net >= 0 ? "text-income" : "text-expense"
              )}>
                {convertedTotals.net >= 0 ? "+" : "-"}
                {CURRENCY_SYMBOLS[currency]}
                <NumberTicker value={Math.abs(convertedTotals.net)} decimalPlaces={2} />
              </div>
            </div>
            <LiabilityDialog
              onSave={handleSaveDebt}
              trigger={
                <Button className="gap-1.5 rounded-full px-4">
                  <Plus className="h-4 w-4" data-icon="inline-start" />
                  Add Entry
                </Button>
              }
            />
          </div>

          <div className="finance-card p-5">
            <div className="grid grid-cols-3 gap-4 md:gap-0 md:divide-x md:divide-border">
              <div className="md:pr-6">
                <p className="label-mono mb-1">Owed to Me</p>
                <p className="text-lg font-semibold tabular-nums text-income">
                  {CURRENCY_SYMBOLS[currency]}{convertedTotals.owedToMe.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="md:px-6">
                <p className="label-mono mb-1">I Owe</p>
                <p className="text-lg font-semibold tabular-nums text-expense">
                  {CURRENCY_SYMBOLS[currency]}{convertedTotals.iOwe.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="md:pl-6">
                <p className="label-mono mb-1">Net Balance</p>
                <p className={cn(
                  "text-lg font-semibold tabular-nums",
                  convertedTotals.net >= 0 ? "text-income" : "text-expense"
                )}>
                  {convertedTotals.net >= 0 ? "+" : ""}{CURRENCY_SYMBOLS[currency]}{Math.abs(convertedTotals.net).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </BlurFade>

      {/* Debt Cards */}
      {sortedDebts.length === 0 ? (
        <BlurFade delay={0.1}>
          <div className="finance-card p-12 text-center">
            <Handshake className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm">
              No liabilities recorded yet. Add one to get started.
            </p>
          </div>
        </BlurFade>
      ) : (
        <div className="space-y-4">
          {sortedDebts.map((debt, idx) => {
            const progressPct = getProgressPercent(debt, transactions);
            const totalPaid = getTotalPaid(debt.id, transactions);
            const payments = getDebtPayments(debt.id, transactions);
            const isExpanded = expandedIds.has(debt.id);
            // `loanIsOwedToMe` anchors transaction labels to the original loan;
            // `displayIsOwedToMe` follows the live net so an overpaid entry flips
            // the card to show what I now owe them.
            const loanIsOwedToMe = debt.direction === "owed_to_me";
            const netToMe = getNetToMe(debt, transactions);
            const displayIsOwedToMe =
              netToMe > 0 || (netToMe === 0 && loanIsOwedToMe);
            const headlineAmount = Math.abs(netToMe);
            const isOverpaid = totalPaid > debt.originalAmount;
            const sym = CURRENCY_SYMBOLS[debt.currency];

            return (
              <BlurFade key={debt.id} delay={0.1 + idx * 0.03}>
                <div className="finance-card p-5 space-y-4">
                  {/* Top row: person + direction badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <h3 className="font-semibold text-base truncate">
                        {debt.person}
                      </h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {debt.reason}
                      </p>
                    </div>

                    <span
                      className={cn(
                        "inline-flex items-center gap-1 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        displayIsOwedToMe
                          ? "bg-income/10 text-income"
                          : "bg-expense/10 text-expense"
                      )}
                    >
                      {displayIsOwedToMe ? (
                        <ArrowDownLeft className="h-3 w-3" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3" />
                      )}
                      {displayIsOwedToMe ? "Owed to Me" : "I Owe"}
                    </span>
                  </div>

                  {/* Remaining amount — the key number */}
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                        {isOverpaid
                          ? displayIsOwedToMe
                            ? "Net owed to me"
                            : "Net I owe"
                          : "Remaining"}
                      </p>
                      <p className={cn("text-xl font-bold tabular-nums", displayIsOwedToMe ? "text-income" : "text-expense")}>
                        {sym}{headlineAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Original</p>
                      <p className="text-sm font-medium tabular-nums text-muted-foreground">
                        {sym}{debt.originalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <Progress value={progressPct}>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {sym}{totalPaid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid
                      </span>
                      {isOverpaid ? (
                        <span className="ml-auto text-[10px] font-medium text-expense tabular-nums">
                          Overpaid by {sym}{(totalPaid - debt.originalAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                          {progressPct.toFixed(0)}%
                        </span>
                      )}
                    </Progress>
                  </div>

                  {/* Notes */}
                  {debt.notes && (
                    <p className="text-xs text-muted-foreground italic">
                      {debt.notes}
                    </p>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <PaymentDialog
                      debtId={debt.id}
                      direction={debt.direction}
                      personName={debt.person}
                      onSave={handleSaveTransaction}
                      trigger={
                        <Button size="sm" variant="outline" className="gap-1">
                          <Plus className="h-3.5 w-3.5" />
                          Add Transaction
                        </Button>
                      }
                    />

                    {payments.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-muted-foreground"
                        onClick={() => toggleExpanded(debt.id)}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {payments.length} payment{payments.length !== 1 && "s"}
                      </Button>
                    )}

                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        title={
                          displayIsOwedToMe
                            ? "Reverse to “I Owe”"
                            : "Reverse to “Owed to Me”"
                        }
                        aria-label="Reverse direction"
                        onClick={() => handleReverseDirection(debt.id)}
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                      </Button>

                      <LiabilityDialog
                        debt={debt}
                        onSave={handleSaveDebt}
                        trigger={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-muted-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />

                      <DeleteConfirmDialog
                        title="Delete Entry"
                        description={`Are you sure you want to delete the record with ${debt.person}? This will also remove all associated payment records. This action cannot be undone.`}
                        onConfirm={() => handleDeleteDebt(debt.id)}
                        trigger={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                    </div>
                  </div>

                  {/* Expandable payment history */}
                  {isExpanded && payments.length > 0 && (
                    <div className="border-t border-border/60 pt-3 space-y-2">
                      <p className="label-mono">Transaction History</p>
                      {payments.map((txn) => {
                        const isPay = txn.amount >= 0;
                        const txLabel = isPay
                          ? (loanIsOwedToMe ? "Paid back" : "You paid")
                          : (loanIsOwedToMe ? "Borrowed more" : "You borrowed");
                        return (
                        <div
                          key={txn.id}
                          className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded",
                                isPay ? "text-income bg-income/10" : "text-expense bg-expense/10"
                              )}>
                                {txLabel}
                              </span>
                              <span
                                className={cn(
                                  "text-sm font-medium tabular-nums",
                                  isPay ? "text-income" : "text-expense"
                                )}
                              >
                                {sym}
                                {Math.abs(txn.amount).toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatDateString(txn.date)}
                              </span>
                            </div>
                            {txn.notes && (
                              <p className="text-xs text-muted-foreground truncate">
                                {txn.notes}
                              </p>
                            )}
                          </div>

                          <DeleteConfirmDialog
                            title="Delete Payment"
                            description="Are you sure you want to delete this payment record? This action cannot be undone."
                            onConfirm={() => handleDeleteTransaction(txn.id)}
                            trigger={
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            }
                          />
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </BlurFade>
            );
          })}
        </div>
      )}
    </div>
  );
}
