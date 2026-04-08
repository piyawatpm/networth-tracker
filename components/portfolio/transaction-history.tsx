"use client";

import { useState } from "react";
import type { PortfolioHolding, PortfolioTransaction } from "@/lib/utils/types";
import { formatDateString } from "@/lib/utils/timezone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, Trash2, Pencil, Check, X } from "lucide-react";

interface TransactionHistoryProps {
  holdings: PortfolioHolding[];
  transactions: PortfolioTransaction[];
  holdingId: string | null;
  setHoldingId: (id: string | null) => void;
  format: (value: number, currency?: string) => string;
  convert: (amount: number, from: string) => number;
  displayCurrency: string;
  onDeleteTransaction?: (id: string) => void;
  onEditTransaction?: (tx: PortfolioTransaction) => void;
}

export function TransactionHistory({
  holdings, transactions, holdingId, setHoldingId,
  format, convert, displayCurrency,
  onDeleteTransaction, onEditTransaction,
}: TransactionHistoryProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUnits, setEditUnits] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDate, setEditDate] = useState("");

  const holding = holdings.find((h) => h.id === holdingId);
  const entries = transactions
    .filter((tx) => tx.holdingId === holdingId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const totalBought = entries.filter((tx) => tx.type === "buy").reduce((s, tx) => s + tx.units, 0);
  const totalSold = entries.filter((tx) => tx.type === "sell").reduce((s, tx) => s + tx.units, 0);
  const totalInvested = entries.filter((tx) => tx.type === "buy").reduce((s, tx) => s + tx.totalAmount, 0);

  function startEdit(tx: PortfolioTransaction) {
    setEditingId(tx.id);
    setEditUnits(tx.units.toString());
    setEditPrice(tx.pricePerUnit.toString());
    setEditDate(tx.date);
  }

  function saveEdit(tx: PortfolioTransaction) {
    const units = parseFloat(editUnits);
    const price = parseFloat(editPrice);
    if (isNaN(units) || isNaN(price) || units <= 0 || price < 0) return;
    onEditTransaction?.({
      ...tx,
      units,
      pricePerUnit: price,
      totalAmount: units * price,
      date: editDate || tx.date,
    });
    setEditingId(null);
  }

  return (
    <Dialog open={holdingId !== null} onOpenChange={(open) => { if (!open) { setHoldingId(null); setEditingId(null); } }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transactions — {holding?.name ?? ""}</DialogTitle>
          <DialogDescription>{holding?.ticker ?? ""}</DialogDescription>
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

        {entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</div>
        ) : (
          <div className="space-y-1">
            {entries.map((tx) => {
              const isEditing = editingId === tx.id;

              if (isEditing) {
                return (
                  <div key={tx.id} className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase mb-0.5">Units</p>
                        <Input type="number" value={editUnits} onChange={(e) => setEditUnits(e.target.value)}
                          className="h-7 text-xs tabular-nums" step="any" min="0" />
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase mb-0.5">Price (USD)</p>
                        <Input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)}
                          className="h-7 text-xs tabular-nums" step="any" min="0" />
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase mb-0.5">Date</p>
                        <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                          className="h-7 text-xs" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="xs" onClick={() => setEditingId(null)}><X className="h-3 w-3 mr-1" />Cancel</Button>
                      <Button size="xs" onClick={() => saveEdit(tx)}><Check className="h-3 w-3 mr-1" />Save</Button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={tx.id} className="flex items-center justify-between py-2 px-1 rounded-md hover:bg-muted/20 transition-colors group">
                  <div className="flex items-center gap-2 min-w-0">
                    {tx.type === "buy" ? (
                      <span className="text-[9px] font-mono uppercase tracking-wider text-income bg-income/10 px-1.5 py-0.5 rounded shrink-0">BUY</span>
                    ) : (
                      <span className="text-[9px] font-mono uppercase tracking-wider text-expense bg-expense/10 px-1.5 py-0.5 rounded shrink-0">SELL</span>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-mono tabular-nums truncate">
                        {tx.units.toLocaleString(undefined, { maximumFractionDigits: 4 })} × ${tx.pricePerUnit.toFixed(2)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{formatDateString(tx.date)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-mono tabular-nums font-medium">{format(tx.totalAmount, tx.currency)}</p>
                      {tx.currency !== displayCurrency && (
                        <p className="text-[9px] text-muted-foreground tabular-nums">({format(convert(tx.totalAmount, tx.currency))})</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onEditTransaction && (
                        <Button variant="ghost" size="icon-xs" onClick={() => startEdit(tx)}>
                          <Pencil className="h-2.5 w-2.5" />
                        </Button>
                      )}
                      {onDeleteTransaction && (
                        deleteConfirmId === tx.id ? (
                          <div className="flex gap-0.5">
                            <Button variant="destructive" size="xs" className="h-5 text-[9px]" onClick={() => { onDeleteTransaction(tx.id); setDeleteConfirmId(null); }}>Del</Button>
                            <Button variant="ghost" size="xs" className="h-5 text-[9px]" onClick={() => setDeleteConfirmId(null)}>No</Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteConfirmId(tx.id)}>
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
