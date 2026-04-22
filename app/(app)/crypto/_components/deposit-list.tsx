"use client";

import { Trash2 } from "lucide-react";
import type { CryptoDeposit } from "@/lib/utils/types";

interface DepositListProps {
  deposits: CryptoDeposit[];
  onDeleted: (id: string) => void;
}

export function DepositList({ deposits, onDeleted }: DepositListProps) {
  if (deposits.length === 0) {
    return (
      <div className="finance-card p-4 text-xs text-muted-foreground">
        No deposits logged yet. Use “+ Add deposit” to record stablecoin or crypto inflows.
      </div>
    );
  }

  async function remove(id: string) {
    const ok = window.confirm("Delete this deposit?");
    if (!ok) return;
    const res = await fetch(`/api/crypto/deposits/${id}`, { method: "DELETE" });
    if (res.ok) onDeleted(id);
  }

  return (
    <div className="finance-card p-4 space-y-2">
      <p className="label-mono mb-2">Logged Deposits</p>
      <div className="grid grid-cols-[1fr_80px_100px_110px_60px_28px] gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>Date</span><span>Token</span><span className="text-right">Amount</span>
        <span className="text-right">USD value</span><span>Kind</span><span />
      </div>
      {deposits.map((d) => (
        <div key={d.id} className="grid grid-cols-[1fr_80px_100px_110px_60px_28px] gap-2 text-xs items-center">
          <span>{d.date.slice(0, 10)}</span>
          <span className="font-mono">{d.token}</span>
          <span className="text-right font-mono tabular-nums">{d.amount.toLocaleString()}</span>
          <span className="text-right font-mono tabular-nums">${d.usdValueAtDeposit.toFixed(2)}</span>
          <span className="text-[10px] uppercase text-muted-foreground">{d.kind}</span>
          <button onClick={() => remove(d.id)} className="text-muted-foreground hover:text-expense">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
