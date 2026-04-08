"use client";

import { useState } from "react";
import type { PortfolioHolding, PortfolioTransaction } from "@/lib/utils/types";
import { formatDateString } from "@/lib/utils/timezone";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, Trash2 } from "lucide-react";

interface TransactionHistoryProps {
  holdings: PortfolioHolding[];
  transactions: PortfolioTransaction[];
  holdingId: string | null;
  setHoldingId: (id: string | null) => void;
  format: (value: number, currency?: string) => string;
  onDeleteTransaction?: (id: string) => void;
}

export function TransactionHistory({
  holdings,
  transactions,
  holdingId,
  setHoldingId,
  format,
  onDeleteTransaction,
}: TransactionHistoryProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const holding = holdings.find((h) => h.id === holdingId);
  const entries = transactions
    .filter((tx) => tx.holdingId === holdingId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const totalBought = entries.filter((tx) => tx.type === "buy").reduce((s, tx) => s + tx.units, 0);
  const totalSold = entries.filter((tx) => tx.type === "sell").reduce((s, tx) => s + tx.units, 0);
  const totalInvested = entries.filter((tx) => tx.type === "buy").reduce((s, tx) => s + tx.totalAmount, 0);

  return (
    <Dialog open={holdingId !== null} onOpenChange={(open) => { if (!open) setHoldingId(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transaction History &mdash; {holding?.name ?? ""}</DialogTitle>
          <DialogDescription>{holding?.ticker ?? ""} transactions</DialogDescription>
        </DialogHeader>

        {/* Summary */}
        {entries.length > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Bought</p>
              <p className="text-sm font-semibold tabular-nums text-income">{totalBought.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Sold</p>
              <p className="text-sm font-semibold tabular-nums text-expense">{totalSold.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Invested</p>
              <p className="text-sm font-semibold tabular-nums">{format(totalInvested, holding?.currency)}</p>
            </div>
          </div>
        )}

        {/* Transaction list */}
        {entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No transactions recorded yet.</div>
        ) : (
          <div className="max-h-72 overflow-y-auto -mx-1 px-1">
            <div className="divide-y divide-border">
              {entries.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-2.5 text-sm group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {tx.type === "buy" ? (
                      <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-income bg-income/10 px-1.5 py-0.5 rounded shrink-0">
                        <TrendingUp className="h-2.5 w-2.5" /> buy
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-expense bg-expense/10 px-1.5 py-0.5 rounded shrink-0">
                        <TrendingDown className="h-2.5 w-2.5" /> sell
                      </span>
                    )}
                    <span className="font-mono tabular-nums text-xs truncate">
                      {tx.units} @ ${tx.pricePerUnit.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono tabular-nums text-xs font-medium">
                      {format(tx.totalAmount, tx.currency)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {formatDateString(tx.date)}
                    </span>
                    {onDeleteTransaction && (
                      deleteConfirmId === tx.id ? (
                        <div className="flex items-center gap-1">
                          <Button variant="destructive" size="xs" onClick={() => { onDeleteTransaction(tx.id); setDeleteConfirmId(null); }}>
                            Delete
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => setDeleteConfirmId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteConfirmId(tx.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
