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
import type { ExpenseEntry, ExpenseType, Currency } from "@/lib/utils/types";
import { EXPENSE_TYPE_LABELS, CURRENCIES } from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";

interface ExpenseDialogProps {
  entry?: ExpenseEntry;
  onSave: (entry: ExpenseEntry) => void;
  trigger: React.ReactNode;
}

const EXPENSE_TYPES = Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[];

export function ExpenseDialog({ entry, onSave, trigger }: ExpenseDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ExpenseType>(entry?.type ?? "food");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState(entry?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(entry?.currency ?? "AUD");
  const [vendor, setVendor] = useState(entry?.vendor ?? "");
  const [date, setDate] = useState(entry?.date ?? getSydneyDateString());
  const [notes, setNotes] = useState(entry?.notes ?? "");

  // Reset form when dialog opens (for new entries) or when entry changes
  useEffect(() => {
    if (open) {
      setType(entry?.type ?? "food");
      setDescription(entry?.description ?? "");
      setAmount(entry?.amount?.toString() ?? "");
      setCurrency(entry?.currency ?? "AUD");
      setVendor(entry?.vendor ?? "");
      setDate(entry?.date ?? getSydneyDateString());
      setNotes(entry?.notes ?? "");
    }
  }, [open, entry]);

  function handleSave() {
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;

    const saved: ExpenseEntry = {
      id: entry?.id ?? crypto.randomUUID(),
      type,
      description: description.trim(),
      amount: parsedAmount,
      currency,
      vendor: vendor.trim(),
      date,
      notes: notes.trim(),
      images: entry?.images ?? [],
      createdAt: entry?.createdAt ?? Date.now(),
    };

    onSave(saved);
    setOpen(false);
  }

  const isValid =
    description.trim().length > 0 &&
    !isNaN(parseFloat(amount)) &&
    parseFloat(amount) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit Expense" : "Add Expense"}</DialogTitle>
          <DialogDescription>
            {entry
              ? "Update the details of this expense."
              : "Record a new expense entry."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Type */}
          <div className="grid gap-2">
            <Label htmlFor="expense-type">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => v && setType(v as ExpenseType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {EXPENSE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="expense-description">Description</Label>
            <Input
              id="expense-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Lunch at cafe"
            />
          </div>

          {/* Amount + Currency */}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="grid gap-2">
              <Label htmlFor="expense-amount">Amount</Label>
              <Input
                id="expense-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expense-currency">Currency</Label>
              <Select
                value={currency}
                onValueChange={(v) => v && setCurrency(v as Currency)}
              >
                <SelectTrigger>
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

          {/* Vendor */}
          <div className="grid gap-2">
            <Label htmlFor="expense-vendor">Vendor</Label>
            <Input
              id="expense-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Woolworths, Uber Eats"
            />
          </div>

          {/* Date */}
          <div className="grid gap-2">
            <Label htmlFor="expense-date">Date</Label>
            <Input
              id="expense-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="grid gap-2">
            <Label htmlFor="expense-notes">Notes (optional)</Label>
            <Textarea
              id="expense-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional details..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={handleSave} disabled={!isValid}>
            {entry ? "Update" : "Add Expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
