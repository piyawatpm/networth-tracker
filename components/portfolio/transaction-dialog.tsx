"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrency } from "@/components/providers/currency-provider";
import { getSydneyDateString } from "@/lib/utils/timezone";
import type { PortfolioHolding, PortfolioTransaction, Currency } from "@/lib/utils/types";

interface TransactionDialogProps {
  holding: PortfolioHolding;
  onSave: (tx: PortfolioTransaction) => void;
  trigger: React.ReactNode;
}

export function TransactionDialog({
  holding,
  onSave,
  trigger,
}: TransactionDialogProps) {
  const { enabledCurrencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const [txType, setTxType] = useState<"buy" | "sell">("buy");
  const [units, setUnits] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [currency, setCurrency] = useState<Currency>(holding.currency);
  const [date, setDate] = useState(getSydneyDateString());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTxType("buy");
      setUnits("");
      const prefill =
        holding.units > 0
          ? (holding.currentValue / holding.units).toFixed(4)
          : "";
      setPricePerUnit(prefill);
      setCurrency(holding.currency);
      setDate(getSydneyDateString());
      setNotes("");
      setError("");
    }
  }, [open, holding]);

  const parsedUnits = parseFloat(units);
  const parsedPrice = parseFloat(pricePerUnit);
  const totalAmount =
    !isNaN(parsedUnits) && !isNaN(parsedPrice)
      ? parsedUnits * parsedPrice
      : 0;

  function handleSave() {
    setError("");

    if (isNaN(parsedUnits) || parsedUnits <= 0) {
      setError("Units must be greater than 0.");
      return;
    }
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setError("Price per unit must be 0 or greater.");
      return;
    }
    if (txType === "sell" && parsedUnits > holding.units) {
      setError(
        `Cannot sell more than held (${holding.units} units available).`
      );
      return;
    }

    const tx: PortfolioTransaction = {
      id: crypto.randomUUID(),
      holdingId: holding.id,
      holdingName: holding.name,
      type: txType,
      units: parsedUnits,
      pricePerUnit: parsedPrice,
      totalAmount,
      currency,
      date,
      notes: notes.trim(),
      createdAt: Date.now(),
    };

    onSave(tx);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log Transaction</DialogTitle>
          <DialogDescription>
            {holding.name} ({holding.ticker})
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Buy / Sell toggle */}
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={txType === "buy" ? "default" : "outline"}
                className={
                  txType === "buy"
                    ? "bg-income/90 hover:bg-income text-income-foreground"
                    : ""
                }
                onClick={() => setTxType("buy")}
              >
                Buy
              </Button>
              <Button
                type="button"
                variant={txType === "sell" ? "default" : "outline"}
                className={
                  txType === "sell"
                    ? "bg-expense/90 hover:bg-expense text-expense-foreground"
                    : ""
                }
                onClick={() => setTxType("sell")}
              >
                Sell
              </Button>
            </div>
          </div>

          {/* Units */}
          <div className="grid gap-1.5">
            <Label htmlFor="tx-units">Units</Label>
            <Input
              id="tx-units"
              type="number"
              min="0"
              step="any"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </div>

          {/* Price per Unit + Currency */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tx-price">Price per Unit</Label>
              <Input
                id="tx-price"
                type="number"
                min="0"
                step="any"
                value={pricePerUnit}
                onChange={(e) => setPricePerUnit(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <Select
                value={currency}
                onValueChange={(v) => v && setCurrency(v as Currency)}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enabledCurrencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Total Amount (computed, read-only) */}
          <div className="grid gap-1.5">
            <Label>Total Amount</Label>
            <Input
              readOnly
              value={totalAmount > 0 ? totalAmount.toFixed(2) : ""}
              placeholder="0.00"
              className="tabular-nums bg-muted/50"
            />
          </div>

          {/* Date */}
          <div className="grid gap-1.5">
            <Label htmlFor="tx-date">Date</Label>
            <Input
              id="tx-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="grid gap-1.5">
            <Label htmlFor="tx-notes">Notes (optional)</Label>
            <Textarea
              id="tx-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes"
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-expense font-medium">{error}</p>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={handleSave}>
            {txType === "buy" ? "Log Buy" : "Log Sell"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
