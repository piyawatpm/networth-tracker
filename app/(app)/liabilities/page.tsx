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

function getRemaining(debt: DebtRecord, transactions: DebtTransaction[]): number {
  const paid = getTotalPaid(debt.id, transactions);
  return Math.max(0, debt.originalAmount - paid);
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
      const remaining = getRemaining(debt, transactions);
      if (remaining <= 0) continue;

      const converted = convert(remaining, debt.currency);
      if (debt.direction === "owed_to_me") {
        owedToMe += converted;
      } else {
        iOwe += converted;
      }
    }

    return { owedToMe, iOwe, net: owedToMe - iOwe };
  }, [debts, transactions, convert]);

  // ------ Sorted debts: active first, then completed ------
  const sortedDebts = useMemo(() => {
    const active: DebtRecord[] = [];
    const completed: DebtRecord[] = [];

    for (const debt of debts) {
      const remaining = getRemaining(debt, transactions);
      if (remaining > 0) {
        active.push(debt);
      } else {
        completed.push(debt);
      }
    }

    // Within each group, newest first
    active.sort((a, b) => b.createdAt - a.createdAt);
    completed.sort((a, b) => b.createdAt - a.createdAt);

    return [...active, ...completed];
  }, [debts, transactions]);

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
            const remaining = getRemaining(debt, transactions);
            const progressPct = getProgressPercent(debt, transactions);
            const totalPaid = getTotalPaid(debt.id, transactions);
            const payments = getDebtPayments(debt.id, transactions);
            const isExpanded = expandedIds.has(debt.id);
            const isCompleted = remaining <= 0;
            const isOwedToMe = debt.direction === "owed_to_me";
            const sym = CURRENCY_SYMBOLS[debt.currency];

            return (
              <BlurFade key={debt.id} delay={0.1 + idx * 0.03}>
                <div
                  className={cn(
                    "finance-card p-5 space-y-4",
                    isCompleted && "opacity-60"
                  )}
                >
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
                        isOwedToMe
                          ? "bg-income/10 text-income"
                          : "bg-expense/10 text-expense"
                      )}
                    >
                      {isOwedToMe ? (
                        <ArrowDownLeft className="h-3 w-3" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3" />
                      )}
                      {isOwedToMe ? "Owed to Me" : "I Owe"}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1.5">
                    <Progress value={progressPct}>
                      <span className="label-mono">
                        {isCompleted ? "Settled" : "Progress"}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        {progressPct.toFixed(0)}%
                      </span>
                    </Progress>
                  </div>

                  {/* Remaining vs Original */}
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="tabular-nums font-medium">
                      {sym}
                      {remaining.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      <span className="text-muted-foreground font-normal">
                        / {sym}
                        {debt.originalAmount.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        remaining
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {sym}
                      {totalPaid.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      paid
                    </span>
                  </div>

                  {/* Notes */}
                  {debt.notes && (
                    <p className="text-xs text-muted-foreground italic">
                      {debt.notes}
                    </p>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {!isCompleted && (
                      <PaymentDialog
                        debtId={debt.id}
                        onSave={handleSaveTransaction}
                        trigger={
                          <Button size="sm" variant="outline" className="gap-1">
                            <Plus className="h-3.5 w-3.5" />
                            Record Payment
                          </Button>
                        }
                      />
                    )}

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
                      <p className="label-mono">Payment History</p>
                      {payments.map((txn) => (
                        <div
                          key={txn.id}
                          className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "text-sm font-medium tabular-nums",
                                  txn.amount >= 0
                                    ? "text-income"
                                    : "text-expense"
                                )}
                              >
                                {txn.amount >= 0 ? "+" : ""}
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
                      ))}
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
