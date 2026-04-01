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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INCOME_TYPE_LABELS, CURRENCIES } from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";
import type { IncomeEntry, IncomeType, Currency } from "@/lib/utils/types";

interface IncomeDialogProps {
  entry?: IncomeEntry;
  onSave: (entry: IncomeEntry) => void;
  trigger: React.ReactNode;
}

export function IncomeDialog({ entry, onSave, trigger }: IncomeDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<IncomeType>(entry?.type ?? "salary");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState(entry?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(entry?.currency ?? "AUD");
  const [date, setDate] = useState(entry?.date ?? getSydneyDateString());
  const [notes, setNotes] = useState(entry?.notes ?? "");

  // Reset form when opening for a new entry or switching entry
  useEffect(() => {
    if (open) {
      setType(entry?.type ?? "salary");
      setDescription(entry?.description ?? "");
      setAmount(entry?.amount?.toString() ?? "");
      setCurrency(entry?.currency ?? "AUD");
      setDate(entry?.date ?? getSydneyDateString());
      setNotes(entry?.notes ?? "");
    }
  }, [open, entry]);

  function handleSave() {
    const parsedAmount = parseFloat(amount);
    if (!type || !description.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    const saved: IncomeEntry = {
      id: entry?.id ?? crypto.randomUUID(),
      type,
      description: description.trim(),
      amount: parsedAmount,
      currency,
      date,
      notes: notes.trim(),
      createdAt: entry?.createdAt ?? Date.now(),
    };

    onSave(saved);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit Income" : "Add Income"}</DialogTitle>
          <DialogDescription>
            {entry
              ? "Update the details of this income entry."
              : "Record a new income entry."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Type */}
          <div className="grid gap-1.5">
            <Label htmlFor="income-type">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => v && setType(v as IncomeType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(INCOME_TYPE_LABELS) as IncomeType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {INCOME_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="grid gap-1.5">
            <Label htmlFor="income-desc">Description</Label>
            <Input
              id="income-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Fortnightly pay"
            />
          </div>

          {/* Amount + Currency row */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="income-amount">Amount</Label>
              <Input
                id="income-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="income-currency">Currency</Label>
              <Select
                value={currency}
                onValueChange={(v) => v && setCurrency(v as Currency)}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date */}
          <div className="grid gap-1.5">
            <Label htmlFor="income-date">Date</Label>
            <Input
              id="income-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="grid gap-1.5">
            <Label htmlFor="income-notes">Notes (optional)</Label>
            <Input
              id="income-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={handleSave}>
            {entry ? "Save Changes" : "Add Income"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
