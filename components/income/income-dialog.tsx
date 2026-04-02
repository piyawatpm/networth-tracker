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
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INCOME_TYPE_LABELS,
  FREQUENCY_LABELS,
} from "@/lib/utils/constants";
import { useCurrency } from "@/components/providers/currency-provider";
import { getSydneyDateString } from "@/lib/utils/timezone";
import type {
  IncomeEntry,
  IncomeType,
  Currency,
  RecurringIncome,
  RecurringFrequency,
} from "@/lib/utils/types";

interface IncomeDialogProps {
  entry?: IncomeEntry;
  onSave: (entry: IncomeEntry) => void;
  onCreateRecurring?: (template: RecurringIncome) => void;
  trigger: React.ReactNode;
  categoryTypes?: string[];
  categoryLabels?: Record<string, string>;
}

export function IncomeDialog({ entry, onSave, onCreateRecurring, trigger, categoryTypes, categoryLabels }: IncomeDialogProps) {
  const { enabledCurrencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>(entry?.type ?? (categoryTypes?.[0] ?? "salary"));
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState(entry?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(entry?.currency ?? "AUD");
  const [source, setSource] = useState(entry?.source ?? "");
  const [date, setDate] = useState(entry?.date ?? getSydneyDateString());
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>("fortnightly");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setType(entry?.type ?? (categoryTypes?.[0] ?? "salary"));
      setDescription(entry?.description ?? "");
      setAmount(entry?.amount?.toString() ?? "");
      setCurrency(entry?.currency ?? "AUD");
      setSource(entry?.source ?? "");
      setDate(entry?.date ?? getSydneyDateString());
      setNotes(entry?.notes ?? "");
      setMakeRecurring(false);
      setFrequency("fortnightly");
      setTouched(false);
    }
  }, [open, entry]);

  const parsedAmount = parseFloat(amount);
  const isValid =
    description.trim().length > 0 &&
    !isNaN(parsedAmount) &&
    parsedAmount > 0;

  function handleSave() {
    setTouched(true);
    if (!isValid) return;

    const saved: IncomeEntry = {
      id: entry?.id ?? crypto.randomUUID(),
      type: type as IncomeType,
      description: description.trim(),
      amount: parsedAmount,
      currency,
      source: source.trim(),
      date,
      notes: notes.trim(),
      isRecurring: makeRecurring || entry?.isRecurring,
      recurringId: entry?.recurringId,
      createdAt: entry?.createdAt ?? Date.now(),
    };

    onSave(saved);

    if (makeRecurring && onCreateRecurring && !entry) {
      onCreateRecurring({
        id: crypto.randomUUID(),
        type: type as IncomeType,
        description: description.trim(),
        amount: parsedAmount,
        currency,
        source: source.trim(),
        notes: notes.trim(),
        frequency,
        startDate: date,
        lastGeneratedDate: date,
        active: true,
        createdAt: Date.now(),
      });
    }

    setOpen(false);
  }

  const TYPES = categoryTypes ?? (Object.keys(INCOME_TYPE_LABELS) as IncomeType[]);
  const LABELS: Record<string, string> = categoryLabels ?? INCOME_TYPE_LABELS;
  const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as RecurringFrequency[];
  const descError = touched && !description.trim();
  const amountError = touched && (isNaN(parsedAmount) || parsedAmount <= 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit Income" : "Add Income"}</DialogTitle>
          <DialogDescription>
            {entry ? "Update the details of this income entry." : "Record a new income entry."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Type */}
          <div className="grid gap-1.5">
            <Label htmlFor="income-type">Type</Label>
            <Select value={type} onValueChange={(v: string | null) => v && setType(v)}>
              <SelectTrigger className="w-full">
                <span>{LABELS[type] ?? type}</span>
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {LABELS[t] ?? t}
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
              className={descError ? "border-destructive" : ""}
            />
            {descError && (
              <p className="text-xs text-destructive">Description is required.</p>
            )}
          </div>

          {/* Amount + Currency */}
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
                className={`tabular-nums ${amountError ? "border-destructive" : ""}`}
              />
              {amountError && (
                <p className="text-xs text-destructive">Enter a valid amount.</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="income-currency">Currency</Label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v as Currency)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {enabledCurrencies.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Source */}
          <div className="grid gap-1.5">
            <Label htmlFor="income-source">Source</Label>
            <Input
              id="income-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Company name, platform"
            />
          </div>

          {/* Date */}
          <div className="grid gap-1.5">
            <Label htmlFor="income-date">Date</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>

          {/* Recurring toggle — only on new entries */}
          {!entry && onCreateRecurring && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={makeRecurring}
                  onChange={(e) => setMakeRecurring(e.target.checked)}
                  className="rounded border-border"
                />
                Make this recurring
              </label>
              {makeRecurring && (
                <Select value={frequency} onValueChange={(v) => v && setFrequency(v as RecurringFrequency)}>
                  <SelectTrigger className="w-full"><span>{FREQUENCY_LABELS[frequency]}</span></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

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
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={handleSave}>
            {entry ? "Save Changes" : "Add Income"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
