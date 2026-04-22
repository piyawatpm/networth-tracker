"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CryptoDeposit, CryptoHolding } from "@/lib/utils/types";

interface DepositLogFormProps {
  holdings: CryptoHolding[];
  livePrices: Record<string, number>;
  onSaved: (deposit: CryptoDeposit) => void;
}

export function DepositLogForm({ holdings, livePrices, onSaved }: DepositLogFormProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [usdValue, setUsdValue] = useState<string>("");
  const [kind, setKind] = useState<"stablecoin" | "crypto">("stablecoin");
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function autoFillUsd(nextToken: string, nextAmount: string) {
    const price = livePrices[nextToken];
    const amt = parseFloat(nextAmount);
    if (price != null && Number.isFinite(amt)) setUsdValue((price * amt).toFixed(2));
  }

  async function submit() {
    setError(null);
    if (!token || !amount || !usdValue) { setError("Fill token, amount, and USD value."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/crypto/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, amount: parseFloat(amount), usdValueAtDeposit: parseFloat(usdValue),
          kind, date: `${date}T00:00:00Z`, notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      const { deposit } = await res.json();
      onSaved(deposit);
      setOpen(false);
      setAmount(""); setUsdValue(""); setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setOpen(true)}>
        + Add deposit
      </Button>
    );
  }

  return (
    <div className="finance-card p-4 space-y-3">
      <p className="label-mono">Log Crypto Deposit</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="space-y-1">
          <span className="label-mono block">Token</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={token}
            onChange={(e) => { setToken(e.target.value); autoFillUsd(e.target.value, amount); }}
          >
            <option value="">Select…</option>
            {holdings.map((h) => <option key={h.token} value={h.token}>{h.token}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label-mono block">Kind</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={kind}
            onChange={(e) => setKind(e.target.value as "stablecoin" | "crypto")}
          >
            <option value="stablecoin">Stablecoin</option>
            <option value="crypto">Crypto</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="label-mono block">Amount</span>
          <input
            type="number" step="any"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); autoFillUsd(token, e.target.value); }}
          />
        </label>
        <label className="space-y-1">
          <span className="label-mono block">USD value</span>
          <input
            type="number" step="any"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
            value={usdValue}
            onChange={(e) => setUsdValue(e.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="label-mono block">Date</span>
          <input
            type="date"
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={date} onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="label-mono block">Notes</span>
          <input
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="text-xs text-expense">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save deposit"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
