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
import type {
  ExpenseEntry,
  Currency,
  PaymentMethod,
  RecurringFrequency,
  RecurringExpense,
} from "@/lib/utils/types";
import {
  CURRENCIES,
  PAYMENT_METHOD_LABELS,
  FREQUENCY_LABELS,
} from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { ImageUpload } from "./image-upload";

interface ExpenseDialogProps {
  entry?: ExpenseEntry;
  onSave: (entry: ExpenseEntry) => void;
  onCreateRecurring?: (template: RecurringExpense) => void;
  trigger: React.ReactNode;
  /** Ordered list of all category type keys */
  categoryTypes?: string[];
  /** Map of type key → display label */
  categoryLabels?: Record<string, string>;
}

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];
const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as RecurringFrequency[];

export function ExpenseDialog({ entry, onSave, onCreateRecurring, trigger, categoryTypes, categoryLabels }: ExpenseDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>(entry?.type ?? "food");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState(entry?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(entry?.currency ?? "AUD");
  const [vendor, setVendor] = useState(entry?.vendor ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(entry?.paymentMethod ?? "other");
  const [date, setDate] = useState(entry?.date ?? getSydneyDateString());
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [images, setImages] = useState<string[]>(entry?.images ?? []);

  // Recurring fields (only for new entries)
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setType(entry?.type ?? (categoryTypes?.[0] ?? "food"));
      setDescription(entry?.description ?? "");
      setAmount(entry?.amount?.toString() ?? "");
      setCurrency(entry?.currency ?? "AUD");
      setVendor(entry?.vendor ?? "");
      setPaymentMethod(entry?.paymentMethod ?? "other");
      setDate(entry?.date ?? getSydneyDateString());
      setNotes(entry?.notes ?? "");
      setImages(entry?.images ?? []);
      setMakeRecurring(false);
      setFrequency("monthly");
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
      paymentMethod,
      date,
      notes: notes.trim(),
      images,
      createdAt: entry?.createdAt ?? Date.now(),
    };

    onSave(saved);

    // If "make recurring" is checked and this is a new entry, create a template
    if (!entry && makeRecurring && onCreateRecurring) {
      const template: RecurringExpense = {
        id: crypto.randomUUID(),
        type,
        description: description.trim(),
        amount: parsedAmount,
        currency,
        vendor: vendor.trim(),
        paymentMethod,
        notes: notes.trim(),
        frequency,
        startDate: date,
        lastGeneratedDate: date,
        active: true,
        createdAt: Date.now(),
      };
      onCreateRecurring(template);
    }

    setOpen(false);
  }

  const isValid =
    description.trim().length > 0 &&
    !isNaN(parseFloat(amount)) &&
    parseFloat(amount) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
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
              onValueChange={(v) => v && setType(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(categoryTypes ?? []).map((t) => (
                  <SelectItem key={t} value={t}>
                    {categoryLabels?.[t] ?? t}
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

          {/* Payment Method */}
          <div className="grid gap-2">
            <Label htmlFor="expense-payment-method">Payment Method</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          {/* Recurring toggle (new entries only) */}
          {!entry && onCreateRecurring && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={makeRecurring}
                  onChange={(e) => setMakeRecurring(e.target.checked)}
                  className="rounded border-border"
                />
                <span>Make this recurring</span>
              </label>
              {makeRecurring && (
                <Select
                  value={frequency}
                  onValueChange={(v) => v && setFrequency(v as RecurringFrequency)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FREQUENCY_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

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

          {/* Image Upload */}
          <div className="grid gap-2">
            <Label>Attachments (optional)</Label>
            <ImageUpload images={images} onChange={setImages} maxImages={3} />
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
