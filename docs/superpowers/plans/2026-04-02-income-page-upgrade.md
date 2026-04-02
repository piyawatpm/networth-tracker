# Income Page Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the income page to feature parity with the expenses page — tabs, date range filtering, recurring income, trend charts, search, pagination, sortable columns, and bug fixes.

**Architecture:** Mirror the expenses page structure: hero section + 3-tab layout (Breakdown/Records/Trends). Reuse existing shared components (`DateRangeFilter`, `Tabs`, chart utilities). Create income-specific versions of trend charts and recurring engine by adapting the expense equivalents. Note: for income, UP is good (green/`text-income`) and DOWN is bad (red/`text-expense`) — inverse of expenses color logic.

**Tech Stack:** Next.js 15 (App Router), React 19, base-ui, ECharts (echarts-for-react), Tailwind CSS, localStorage persistence.

---

## Task 1: Update Data Model

**Files:**
- Modify: `lib/utils/types.ts`

- [ ] **Step 1: Add RecurringIncome type and update IncomeEntry**

Add these to `lib/utils/types.ts` after the existing `IncomeEntry` interface (after line 56):

```typescript
export interface RecurringIncome {
  id: string;
  type: IncomeType;
  description: string;
  amount: number;
  currency: Currency;
  source: string;
  notes: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate?: string;
  lastGeneratedDate?: string;
  active: boolean;
  createdAt: number;
}
```

Update the `IncomeEntry` interface (lines 47-56) to add new fields:

```typescript
export interface IncomeEntry {
  id: string;
  type: IncomeType;
  description: string;
  amount: number;
  currency: Currency;
  date: string;
  source: string;
  notes: string;
  isRecurring?: boolean;
  recurringId?: string;
  createdAt: number;
}
```

Add a `normalizeIncomeEntry` function at the end of the file (after `normalizeExpenseEntry`):

```typescript
/** Normalize old IncomeEntry records that lack new fields */
export function normalizeIncomeEntry(e: Record<string, unknown>): IncomeEntry {
  return {
    id: e.id as string,
    type: (e.type as IncomeType) ?? "other",
    description: (e.description as string) ?? "",
    amount: (e.amount as number) ?? 0,
    currency: (e.currency as Currency) ?? "AUD",
    date: (e.date as string) ?? "",
    source: (e.source as string) ?? "",
    notes: (e.notes as string) ?? "",
    isRecurring: (e.isRecurring as boolean) ?? false,
    recurringId: e.recurringId as string | undefined,
    createdAt: (e.createdAt as number) ?? Date.now(),
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx tsc --noEmit 2>&1 | head -30`

Expected: Type errors in `income-dialog.tsx` and `income/page.tsx` because they don't pass `source` yet — this is expected and will be fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/types.ts
git commit -m "feat(income): add RecurringIncome type, source field, and normalizeIncomeEntry"
```

---

## Task 2: Create Recurring Income Hook

**Files:**
- Create: `hooks/use-recurring-income.ts`

- [ ] **Step 1: Write the hook**

Create `hooks/use-recurring-income.ts` — mirrors `hooks/use-recurring-expenses.ts` but uses `IncomeEntry` and `RecurringIncome` types:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useLocalStorage } from "./use-local-storage";
import type { RecurringIncome, IncomeEntry } from "@/lib/utils/types";
import { getSydneyDateString, computeOccurrences } from "@/lib/utils/timezone";

export function useRecurringIncome(
  entries: IncomeEntry[],
  setEntries: (value: IncomeEntry[] | ((prev: IncomeEntry[]) => IncomeEntry[])) => void,
) {
  const [templates, setTemplates] = useLocalStorage<RecurringIncome[]>(
    "recurring_income",
    [],
  );
  const hasGenerated = useRef(false);

  useEffect(() => {
    if (hasGenerated.current) return;
    if (templates.length === 0) return;

    hasGenerated.current = true;
    const today = getSydneyDateString();
    const newEntries: IncomeEntry[] = [];
    const updatedTemplates = templates.map((t) => ({ ...t }));

    for (const template of updatedTemplates) {
      if (!template.active) continue;
      if (template.endDate && template.endDate < today) continue;

      const fromDate = template.lastGeneratedDate
        ? nextDay(template.lastGeneratedDate)
        : template.startDate;

      if (fromDate > today) continue;

      const occurrences = computeOccurrences(
        template.startDate,
        template.frequency,
        fromDate,
        today,
      );

      const existingDates = new Set(
        entries
          .filter((e) => e.recurringId === template.id)
          .map((e) => e.date),
      );

      for (const date of occurrences) {
        if (existingDates.has(date)) continue;
        newEntries.push({
          id: crypto.randomUUID(),
          type: template.type,
          description: template.description,
          amount: template.amount,
          currency: template.currency,
          source: template.source,
          date,
          notes: template.notes,
          createdAt: Date.now(),
          isRecurring: true,
          recurringId: template.id,
        });
      }

      if (occurrences.length > 0) {
        template.lastGeneratedDate = occurrences[occurrences.length - 1];
      }
    }

    if (newEntries.length > 0) {
      setEntries((prev) => [...prev, ...newEntries]);
      setTemplates(updatedTemplates);
    }
  }, [templates, entries, setEntries, setTemplates]);

  function addTemplate(template: RecurringIncome) {
    setTemplates((prev) => [...prev, template]);
  }

  function updateTemplate(updated: RecurringIncome) {
    setTemplates((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t)),
    );
  }

  function deleteTemplate(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  function toggleTemplate(id: string) {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)),
    );
  }

  return {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTemplate,
  };
}

function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/use-recurring-income.ts
git commit -m "feat(income): add useRecurringIncome hook for auto-generating entries"
```

---

## Task 3: Create Recurring Income Dialog

**Files:**
- Create: `components/income/recurring-dialog.tsx`

- [ ] **Step 1: Write the component**

Create `components/income/recurring-dialog.tsx` — adapted from the expenses version for income types:

```typescript
"use client";

import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import type {
  RecurringIncome,
  IncomeType,
  Currency,
  RecurringFrequency,
} from "@/lib/utils/types";
import {
  CURRENCIES,
  INCOME_TYPE_LABELS,
  FREQUENCY_LABELS,
} from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { Plus, Pencil, Trash2, Pause, Play } from "lucide-react";

// ---------------------------------------------------------------------------
// Template Form
// ---------------------------------------------------------------------------

function RecurringForm({
  template,
  onSave,
  onCancel,
}: {
  template?: RecurringIncome;
  onSave: (t: RecurringIncome) => void;
  onCancel: () => void;
}) {
  const TYPES = Object.keys(INCOME_TYPE_LABELS) as IncomeType[];
  const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as RecurringFrequency[];

  const [type, setType] = useState<IncomeType>(template?.type ?? "salary");
  const [description, setDescription] = useState(template?.description ?? "");
  const [amount, setAmount] = useState(template?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(template?.currency ?? "AUD");
  const [source, setSource] = useState(template?.source ?? "");
  const [frequency, setFrequency] = useState<RecurringFrequency>(template?.frequency ?? "fortnightly");
  const [startDate, setStartDate] = useState(template?.startDate ?? getSydneyDateString());
  const [endDate, setEndDate] = useState(template?.endDate ?? "");

  const isValid =
    description.trim().length > 0 &&
    !isNaN(parseFloat(amount)) &&
    parseFloat(amount) > 0;

  function handleSave() {
    if (!isValid) return;
    onSave({
      id: template?.id ?? crypto.randomUUID(),
      type,
      description: description.trim(),
      amount: parseFloat(amount),
      currency,
      source: source.trim(),
      notes: "",
      frequency,
      startDate,
      endDate: endDate || undefined,
      lastGeneratedDate: template?.lastGeneratedDate,
      active: template?.active ?? true,
      createdAt: template?.createdAt ?? Date.now(),
    });
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => v && setType(v as IncomeType)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>{INCOME_TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Fortnightly salary" />
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="grid gap-2">
          <Label>Amount</Label>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="tabular-nums" />
        </div>
        <div className="grid gap-2">
          <Label>Currency</Label>
          <Select value={currency} onValueChange={(v) => v && setCurrency(v as Currency)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Source</Label>
        <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Employer name" />
      </div>

      <div className="grid gap-2">
        <Label>Frequency</Label>
        <Select value={frequency} onValueChange={(v) => v && setFrequency(v as RecurringFrequency)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (<SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-2">
          <Label>Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>End Date (optional)</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!isValid}>
          {template ? "Update" : "Add Template"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dialog
// ---------------------------------------------------------------------------

interface RecurringIncomeDialogProps {
  templates: RecurringIncome[];
  onAdd: (t: RecurringIncome) => void;
  onUpdate: (t: RecurringIncome) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  trigger: React.ReactNode;
}

export function RecurringIncomeDialog({
  templates,
  onAdd,
  onUpdate,
  onDelete,
  onToggle,
  trigger,
}: RecurringIncomeDialogProps) {
  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [editTarget, setEditTarget] = useState<RecurringIncome | undefined>();

  function handleStartEdit(t: RecurringIncome) {
    setEditTarget(t);
    setMode("edit");
  }

  function handleSaveNew(t: RecurringIncome) {
    onAdd(t);
    setMode("list");
  }

  function handleSaveEdit(t: RecurringIncome) {
    onUpdate(t);
    setMode("list");
    setEditTarget(undefined);
  }

  return (
    <Dialog onOpenChange={() => { setMode("list"); setEditTarget(undefined); }}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recurring Income</DialogTitle>
          <DialogDescription>
            Manage your recurring income templates. Active templates auto-generate entries.
          </DialogDescription>
        </DialogHeader>

        {mode === "list" && (
          <div className="space-y-3">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No recurring income set up yet.
              </p>
            ) : (
              templates.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition-opacity ${
                    !t.active ? "opacity-50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{t.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-[10px]">
                        {FREQUENCY_LABELS[t.frequency]}
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t.currency} {t.amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon-xs" onClick={() => onToggle(t.id)} title={t.active ? "Pause" : "Resume"}>
                      {t.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => handleStartEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive" onClick={() => onDelete(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setMode("add")}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Recurring Income
            </Button>
          </div>
        )}

        {mode === "add" && (
          <RecurringForm onSave={handleSaveNew} onCancel={() => setMode("list")} />
        )}

        {mode === "edit" && editTarget && (
          <RecurringForm
            template={editTarget}
            onSave={handleSaveEdit}
            onCancel={() => { setMode("list"); setEditTarget(undefined); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/income/recurring-dialog.tsx
git commit -m "feat(income): add RecurringIncomeDialog component"
```

---

## Task 4: Update Income Dialog (Bug Fixes + Source Field + Recurring Toggle)

**Files:**
- Modify: `components/income/income-dialog.tsx`

This task fixes: type select showing raw keys, silent validation, and adds the source field + recurring toggle.

- [ ] **Step 1: Rewrite income-dialog.tsx**

Replace the entire contents of `components/income/income-dialog.tsx` with:

```typescript
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
import {
  INCOME_TYPE_LABELS,
  CURRENCIES,
  FREQUENCY_LABELS,
} from "@/lib/utils/constants";
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
}

export function IncomeDialog({ entry, onSave, onCreateRecurring, trigger }: IncomeDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<IncomeType>(entry?.type ?? "salary");
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
      setType(entry?.type ?? "salary");
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
      type,
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
        type,
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

  const TYPES = Object.keys(INCOME_TYPE_LABELS) as IncomeType[];
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
            <Select value={type} onValueChange={(v) => v && setType(v as IncomeType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
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
                  {CURRENCIES.map((c) => (
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
            <Input
              id="income-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
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
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
```

- [ ] **Step 2: Commit**

```bash
git add components/income/income-dialog.tsx
git commit -m "fix(income): add source field, validation feedback, recurring toggle, fix type select"
```

---

## Task 5: Create Income Trend Chart

**Files:**
- Create: `components/income/income-trend.tsx`

- [ ] **Step 1: Write the component**

Create `components/income/income-trend.tsx` — adapted from `expenses/spending-trend.tsx`:

```typescript
"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry } from "@/lib/utils/types";
import { INCOME_TYPE_LABELS, INCOME_TYPE_COLORS } from "@/lib/utils/constants";
import { getLastNMonthKeys, monthKeyToLabel, getMonthKey } from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";

interface IncomeTrendProps {
  entries: IncomeEntry[];
}

export function IncomeTrend({ entries }: IncomeTrendProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert } = useCurrency();
  const [byCategory, setByCategory] = useState(false);

  const monthKeys = useMemo(() => getLastNMonthKeys(12), []);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark);

    if (!byCategory) {
      const data = monthKeys.map((mk) =>
        entries
          .filter((e) => getMonthKey(e.date) === mk)
          .reduce((sum, e) => sum + convert(e.amount, e.currency), 0),
      );

      return {
        ...base,
        xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys.map(monthKeyToLabel) },
        yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
        series: [{
          type: "bar" as const,
          data,
          itemStyle: { color: isDark ? "#2e8b57" : "#2e7d5b", borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 32,
        }],
      };
    }

    // Stacked by category (top 5 + other)
    const categoryTotals: Record<string, number> = {};
    for (const e of entries) {
      categoryTotals[e.type] = (categoryTotals[e.type] ?? 0) + convert(e.amount, e.currency);
    }
    const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5).map(([t]) => t);
    const hasOther = sorted.length > 5;

    const series = top5.map((t) => ({
      name: INCOME_TYPE_LABELS[t as keyof typeof INCOME_TYPE_LABELS] ?? t,
      type: "line" as const,
      stack: "total",
      areaStyle: { opacity: 0.3 },
      lineStyle: { width: 1.5 },
      itemStyle: { color: INCOME_TYPE_COLORS[t as keyof typeof INCOME_TYPE_COLORS] ?? "#708090" },
      data: monthKeys.map((mk) =>
        entries
          .filter((e) => getMonthKey(e.date) === mk && e.type === t)
          .reduce((sum, e) => sum + convert(e.amount, e.currency), 0),
      ),
    }));

    if (hasOther) {
      const otherTypes = new Set(sorted.slice(5).map(([t]) => t));
      series.push({
        name: "Other",
        type: "line" as const,
        stack: "total",
        areaStyle: { opacity: 0.2 },
        lineStyle: { width: 1 },
        itemStyle: { color: "#708090" },
        data: monthKeys.map((mk) =>
          entries
            .filter((e) => getMonthKey(e.date) === mk && otherTypes.has(e.type))
            .reduce((sum, e) => sum + convert(e.amount, e.currency), 0),
        ),
      });
    }

    return {
      ...base,
      xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys.map(monthKeyToLabel) },
      yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
      legend: { show: true, bottom: 0, textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 } },
      grid: { ...base.grid, bottom: 48 },
      series,
    };
  }, [entries, convert, isDark, monthKeys, byCategory]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="label-mono">Monthly Income (12 months)</p>
        <button
          onClick={() => setByCategory((v) => !v)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            byCategory
              ? "bg-foreground text-background"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
        >
          By Category
        </button>
      </div>
      <ReactECharts option={option} style={{ height: "280px" }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/income/income-trend.tsx
git commit -m "feat(income): add IncomeTrend 12-month chart component"
```

---

## Task 6: Create Income Cumulative Pace Chart

**Files:**
- Create: `components/income/cumulative-pace-chart.tsx`

- [ ] **Step 1: Write the component**

Create `components/income/cumulative-pace-chart.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry } from "@/lib/utils/types";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getMonthKey,
  getDaysInMonth,
  monthKeyToFullLabel,
} from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";

interface IncomePaceChartProps {
  entries: IncomeEntry[];
}

export function IncomePaceChart({ entries }: IncomePaceChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert } = useCurrency();

  const currentMonth = getCurrentMonthKey();
  const lastMonth = getLastMonthKey();

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    const daysInCurrent = getDaysInMonth(currentMonth);
    const daysInLast = getDaysInMonth(lastMonth);
    const maxDays = Math.max(daysInCurrent, daysInLast);

    function buildCumulative(monthKey: string, maxDay: number): (number | null)[] {
      const monthEntries = entries.filter((e) => getMonthKey(e.date) === monthKey);
      const dailyTotals: number[] = Array(maxDay).fill(0);

      for (const e of monthEntries) {
        const day = parseInt(e.date.split("-")[2], 10);
        if (day >= 1 && day <= maxDay) {
          dailyTotals[day - 1] += convert(e.amount, e.currency);
        }
      }

      const cumulative: (number | null)[] = [];
      let running = 0;
      for (let i = 0; i < maxDay; i++) {
        running += dailyTotals[i];
        cumulative.push(Math.round(running * 100) / 100);
      }
      return cumulative;
    }

    const currentData = buildCumulative(currentMonth, daysInCurrent);
    const lastData = buildCumulative(lastMonth, daysInLast);
    const days = Array.from({ length: maxDays }, (_, i) => i + 1);

    return {
      ...base,
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: days,
        axisLabel: { ...base.xAxis.axisLabel, interval: 4 },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) },
      },
      legend: {
        show: true,
        bottom: 0,
        textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 },
      },
      grid: { ...base.grid, bottom: 40 },
      series: [
        {
          name: monthKeyToFullLabel(currentMonth),
          type: "line" as const,
          data: currentData,
          smooth: true,
          lineStyle: { width: 2.5 },
          showSymbol: false,
          itemStyle: { color: isDark ? "#4ade80" : "#2e8b57" },
        },
        {
          name: monthKeyToFullLabel(lastMonth),
          type: "line" as const,
          data: lastData,
          smooth: true,
          lineStyle: { width: 1.5, type: "dashed" as const },
          showSymbol: false,
          itemStyle: { color: isDark ? "#666" : "#aaa" },
        },
      ],
    };
  }, [entries, convert, isDark, currentMonth, lastMonth]);

  return (
    <div className="space-y-3">
      <p className="label-mono">Income Pace (This vs Last Month)</p>
      <ReactECharts option={option} style={{ height: "240px" }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/income/cumulative-pace-chart.tsx
git commit -m "feat(income): add IncomePaceChart cumulative day-by-day chart"
```

---

## Task 7: Create Income Comparison View

**Files:**
- Create: `components/income/comparison-view.tsx`

- [ ] **Step 1: Write the component**

Create `components/income/comparison-view.tsx` — note inverted color logic (up=green for income):

```typescript
"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { IncomeEntry } from "@/lib/utils/types";
import { INCOME_TYPE_LABELS, INCOME_TYPE_COLORS } from "@/lib/utils/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getMonthKey,
  getMonthKeysFromEntries,
  monthKeyToFullLabel,
} from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface IncomeComparisonViewProps {
  entries: IncomeEntry[];
  monthA: string;
  monthB: string;
  onMonthAChange: (v: string) => void;
  onMonthBChange: (v: string) => void;
}

export function IncomeComparisonView({
  entries,
  monthA,
  monthB,
  onMonthAChange,
  onMonthBChange,
}: IncomeComparisonViewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, format: formatCur } = useCurrency();

  const monthKeys = useMemo(() => getMonthKeysFromEntries(entries), [entries]);

  const { totalA, totalB, categoryData } = useMemo(() => {
    const entriesA = entries.filter((e) => getMonthKey(e.date) === monthA);
    const entriesB = entries.filter((e) => getMonthKey(e.date) === monthB);

    const tA = entriesA.reduce((s, e) => s + convert(e.amount, e.currency), 0);
    const tB = entriesB.reduce((s, e) => s + convert(e.amount, e.currency), 0);

    const catMap: Record<string, { a: number; b: number }> = {};
    for (const e of entriesA) {
      catMap[e.type] = catMap[e.type] ?? { a: 0, b: 0 };
      catMap[e.type].a += convert(e.amount, e.currency);
    }
    for (const e of entriesB) {
      catMap[e.type] = catMap[e.type] ?? { a: 0, b: 0 };
      catMap[e.type].b += convert(e.amount, e.currency);
    }

    const data = Object.entries(catMap)
      .map(([type, { a, b }]) => ({ type, a, b }))
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b))
      .slice(0, 8);

    return { totalA: tA, totalB: tB, categoryData: data };
  }, [entries, monthA, monthB, convert]);

  const chartOption = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    const categories = categoryData.map((d) => INCOME_TYPE_LABELS[d.type as keyof typeof INCOME_TYPE_LABELS] ?? d.type);

    return {
      ...base,
      grid: { ...base.grid, left: 80, bottom: 32 },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: categories,
        axisLabel: { ...base.xAxis.axisLabel, rotate: 30 },
      },
      yAxis: {
        ...base.yAxis,
        type: "value" as const,
        axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) },
      },
      legend: {
        show: true,
        bottom: 0,
        textStyle: { color: isDark ? "#888" : "#968360", fontSize: 10 },
      },
      series: [
        {
          name: monthKeyToFullLabel(monthA),
          type: "bar" as const,
          data: categoryData.map((d) => d.a),
          barGap: "10%",
          itemStyle: { color: isDark ? "#e09770" : "#c95f3f", borderRadius: [3, 3, 0, 0] },
        },
        {
          name: monthKeyToFullLabel(monthB),
          type: "bar" as const,
          data: categoryData.map((d) => d.b),
          itemStyle: { color: isDark ? "#4ade80" : "#2e8b57", borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [categoryData, monthA, monthB, isDark]);

  const pctChange = totalA > 0 ? ((totalB - totalA) / totalA) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="label-mono">Compare Months</p>
        <div className="flex items-center gap-2">
          <Select value={monthA} onValueChange={(v: string | null) => v && onMonthAChange(v)}>
            <SelectTrigger className="w-[120px]" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthKeys.map((mk) => (
                <SelectItem key={mk} value={mk}>{monthKeyToFullLabel(mk)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">vs</span>
          <Select value={monthB} onValueChange={(v: string | null) => v && onMonthBChange(v)}>
            <SelectTrigger className="w-[120px]" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthKeys.map((mk) => (
                <SelectItem key={mk} value={mk}>{monthKeyToFullLabel(mk)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards — income: up is GOOD (green), down is BAD (red) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="finance-card p-3 text-center">
          <p className="label-mono mb-1">{monthKeyToFullLabel(monthA)}</p>
          <p className="text-lg font-semibold tabular-nums">{formatCur(totalA)}</p>
        </div>
        <div className="finance-card p-3 text-center">
          <p className="label-mono mb-1">{monthKeyToFullLabel(monthB)}</p>
          <p className="text-lg font-semibold tabular-nums">{formatCur(totalB)}</p>
          {totalA > 0 && (
            <span className={`inline-flex items-center gap-0.5 text-xs mt-1 ${pctChange > 0 ? "text-income" : pctChange < 0 ? "text-expense" : "text-muted-foreground"}`}>
              {pctChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : pctChange < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {Math.abs(pctChange).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {categoryData.length > 0 && (
        <ReactECharts option={chartOption} style={{ height: "280px" }} />
      )}

      {categoryData.length > 0 && (
        <div className="space-y-1.5">
          {categoryData.map((d) => {
            const delta = d.a > 0 ? ((d.b - d.a) / d.a) * 100 : 0;
            const color = INCOME_TYPE_COLORS[d.type as keyof typeof INCOME_TYPE_COLORS] ?? "#708090";
            const label = INCOME_TYPE_LABELS[d.type as keyof typeof INCOME_TYPE_LABELS] ?? d.type;
            return (
              <div key={d.type} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <span>{label}</span>
                </div>
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="text-muted-foreground">{formatCur(d.a)}</span>
                  <span>→</span>
                  <span>{formatCur(d.b)}</span>
                  {d.a > 0 && (
                    <span className={delta > 0 ? "text-income" : delta < 0 ? "text-expense" : "text-muted-foreground"}>
                      {delta > 0 ? "↑" : delta < 0 ? "↓" : "—"} {Math.abs(delta).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/income/comparison-view.tsx
git commit -m "feat(income): add IncomeComparisonView month-vs-month chart"
```

---

## Task 8: Rewrite Income Page

**Files:**
- Modify: `app/(app)/income/page.tsx`

This is the main integration task. Rewrites the page with: tabs, hero with weekly avg + pace, date-range-filtered breakdown, records with search + pagination + sortable columns, trends tab, and savings summary.

- [ ] **Step 1: Rewrite the entire page**

Replace `app/(app)/income/page.tsx` with the full new implementation:

```typescript
"use client";

import { useState, useMemo } from "react";
import { useTheme } from "next-themes";
import ReactECharts from "echarts-for-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import { useRecurringIncome } from "@/hooks/use-recurring-income";
import type { IncomeEntry, IncomeType, ExpenseEntry } from "@/lib/utils/types";
import { normalizeIncomeEntry, CURRENCY_SYMBOLS } from "@/lib/utils/types";
import { INCOME_TYPE_LABELS, INCOME_TYPE_COLORS } from "@/lib/utils/constants";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getMonthKey,
  formatDateString,
  getDaysInMonth,
  getSydneyDayOfMonth,
} from "@/lib/utils/timezone";
import { getPieBaseOption } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";

// UI
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";

// Icons
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from "lucide-react";

// Feature components
import { IncomeDialog } from "@/components/income/income-dialog";
import { RecurringIncomeDialog } from "@/components/income/recurring-dialog";
import {
  DateRangeFilter,
  getPresetRange,
  type DatePreset,
  type DateRange,
} from "@/components/expenses/date-range-filter";
import { IncomeTrend } from "@/components/income/income-trend";
import { IncomePaceChart } from "@/components/income/cumulative-pace-chart";
import { IncomeComparisonView } from "@/components/income/comparison-view";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumConverted(
  entries: IncomeEntry[],
  convert: (amount: number, from: IncomeEntry["currency"]) => number,
) {
  return entries.reduce((acc, e) => acc + convert(e.amount, e.currency), 0);
}

function filterByDateRange(entries: IncomeEntry[], range: DateRange): IncomeEntry[] {
  return entries.filter((e) => e.date >= range.from && e.date <= range.to);
}

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IncomePage() {
  const [rawEntries, setEntries] = useLocalStorage<IncomeEntry[]>(
    "income_entries",
    [],
  );
  const entries = useMemo(
    () => rawEntries.map((e) => normalizeIncomeEntry(e as unknown as Record<string, unknown>)),
    [rawEntries],
  );

  const [expenseEntries] = useLocalStorage<ExpenseEntry[]>("expense_entries", []);
  const { currency, format, convert, symbol } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Recurring income
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTemplate,
  } = useRecurringIncome(entries, setEntries);

  // ---- State ----------------------------------------------------------------

  // Records tab
  const [typeFilter, setTypeFilter] = useState<IncomeType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  // Breakdown tab date range
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [customRange, setCustomRange] = useState<DateRange>(
    getPresetRange("this_month"),
  );
  const activeDateRange =
    datePreset === "custom" ? customRange : getPresetRange(datePreset);

  // Comparison tab
  const currentMonth = getCurrentMonthKey();
  const lastMonth = getLastMonthKey();
  const [compMonthA, setCompMonthA] = useState(lastMonth);
  const [compMonthB, setCompMonthB] = useState(currentMonth);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<IncomeEntry | null>(null);

  // ---- Derived data ---------------------------------------------------------

  const thisMonthEntries = useMemo(
    () => entries.filter((e) => getMonthKey(e.date ?? "") === currentMonth),
    [entries, currentMonth],
  );
  const lastMonthEntries = useMemo(
    () => entries.filter((e) => getMonthKey(e.date ?? "") === lastMonth),
    [entries, lastMonth],
  );

  const thisMonthTotal = sumConverted(thisMonthEntries, convert);
  const lastMonthTotal = sumConverted(lastMonthEntries, convert);

  // Weekly avg & pace
  const daysElapsed = getSydneyDayOfMonth();
  const weeksElapsed = Math.max(1, daysElapsed / 7);
  const weeklyAvg = thisMonthTotal / weeksElapsed;
  const daysInMonth = getDaysInMonth(currentMonth);
  const dailyAvg = daysElapsed > 0 ? thisMonthTotal / daysElapsed : 0;
  const monthlyPace = dailyAvg * daysInMonth;
  // For income: up is GOOD (green), down is BAD (red)
  const paceVsLast =
    lastMonthTotal > 0 ? ((monthlyPace - lastMonthTotal) / lastMonthTotal) * 100 : 0;

  // Breakdown by type (date-range-filtered)
  const dateFilteredEntries = useMemo(
    () => filterByDateRange(entries, activeDateRange),
    [entries, activeDateRange],
  );
  const dateFilteredTotal = sumConverted(dateFilteredEntries, convert);

  const breakdownByType = useMemo(() => {
    const map: Partial<Record<IncomeType, number>> = {};
    for (const e of dateFilteredEntries) {
      map[e.type] = (map[e.type] ?? 0) + convert(e.amount, e.currency);
    }
    return Object.entries(map)
      .filter(([, v]) => (v as number) > 0)
      .map(([t, value]) => ({
        type: t as IncomeType,
        label: INCOME_TYPE_LABELS[t as IncomeType],
        value: value as number,
        color: INCOME_TYPE_COLORS[t as IncomeType],
      }))
      .sort((a, b) => b.value - a.value);
  }, [dateFilteredEntries, convert]);

  // Expenses for savings ratio
  const dateFilteredExpenses = useMemo(() => {
    return expenseEntries
      .filter((e) => e.date >= activeDateRange.from && e.date <= activeDateRange.to)
      .reduce((sum, e) => sum + convert(e.amount, e.currency), 0);
  }, [expenseEntries, activeDateRange, convert]);

  // Pie chart
  const pieOption = useMemo(() => {
    const base = getPieBaseOption(isDark);
    return {
      ...base,
      series: [{
        type: "pie" as const,
        radius: ["60%", "85%"],
        center: ["50%", "50%"],
        padAngle: 2,
        data: breakdownByType.map((item) => ({
          name: item.label,
          value: item.value,
          itemStyle: { color: item.color },
        })),
        label: { show: false },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.3)",
          },
        },
      }],
    };
  }, [breakdownByType, isDark]);

  // Records tab filters
  const typesPresent = useMemo(() => {
    const set = new Set<IncomeType>();
    entries.forEach((e) => set.add(e.type));
    return Array.from(set);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    let result = [...entries];
    if (typeFilter !== "all") result = result.filter((e) => e.type === typeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          (e.source ?? "").toLowerCase().includes(q) ||
          (e.notes ?? "").toLowerCase().includes(q),
      );
    }
    result.sort((a, b) => {
      if (sortField === "date") {
        const cmp = (a.date ?? "").localeCompare(b.date ?? "");
        return sortDir === "desc" ? -cmp : cmp;
      }
      const aVal = convert(a.amount, a.currency);
      const bVal = convert(b.amount, b.currency);
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [entries, typeFilter, searchQuery, sortField, sortDir, convert]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const pagedEntries = filteredEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filters change
  useMemo(() => { setPage(0); }, [typeFilter, searchQuery, sortField, sortDir]);

  // ---- Handlers -------------------------------------------------------------

  function handleSave(saved: IncomeEntry) {
    setEntries((prev: IncomeEntry[]) => {
      const existing = prev.findIndex((e) => e.id === saved.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = saved;
        return updated;
      }
      return [...prev, saved];
    });
  }

  function handleDelete(id: string) {
    setEntries((prev: IncomeEntry[]) => prev.filter((e) => e.id !== id));
    setDeleteTarget(null);
  }

  function handleDateRangeChange(preset: DatePreset, range: DateRange) {
    setDatePreset(preset);
    setCustomRange(range);
  }

  function toggleSort(field: "date" | "amount") {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ================================================================= */}
      {/* Hero Section                                                       */}
      {/* ================================================================= */}
      <BlurFade delay={0}>
        <section className="space-y-4">
          <p className="label-mono">This Month&rsquo;s Income</p>
          <div className="display-number text-income">
            <NumberTicker
              value={thisMonthTotal}
              prefix={symbol}
              decimalPlaces={2}
            />
          </div>

          {/* Summary tiles */}
          <div className="finance-card inline-flex flex-wrap divide-x divide-border text-sm">
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">This Month</p>
              <p className="font-semibold tabular-nums">{format(thisMonthTotal)}</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">Last Month</p>
              <p className="font-semibold tabular-nums">{format(lastMonthTotal)}</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">Weekly Avg</p>
              <p className="font-semibold tabular-nums">{format(weeklyAvg)}/wk</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">Monthly Pace</p>
              <p
                className={cn(
                  "font-semibold tabular-nums",
                  paceVsLast > 10
                    ? "text-income"
                    : paceVsLast < -10
                      ? "text-expense"
                      : "text-foreground",
                )}
              >
                → {format(monthlyPace)}
              </p>
            </div>
          </div>
        </section>
      </BlurFade>

      {/* ================================================================= */}
      {/* Tabbed Content                                                     */}
      {/* ================================================================= */}
      <BlurFade delay={0.08}>
        <Tabs defaultValue="breakdown">
          <TabsList variant="line">
            <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
            <TabsTrigger value="records">Records</TabsTrigger>
            <TabsTrigger value="trends">Trends & Insights</TabsTrigger>
          </TabsList>

          {/* -------------------------------------------------------------- */}
          {/* Tab 1: Breakdown                                                */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="breakdown" className="space-y-6 pt-4">
            {/* Date range + actions */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <DateRangeFilter
                value={datePreset}
                customRange={customRange}
                onChange={handleDateRangeChange}
              />
              <div className="flex gap-2 shrink-0">
                <RecurringIncomeDialog
                  templates={templates}
                  onAdd={addTemplate}
                  onUpdate={updateTemplate}
                  onDelete={deleteTemplate}
                  onToggle={toggleTemplate}
                  trigger={
                    <Button variant="ghost" size="sm">
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Recurring
                    </Button>
                  }
                />
                <IncomeDialog
                  onSave={handleSave}
                  onCreateRecurring={addTemplate}
                  trigger={
                    <Button size="sm">
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add Income
                    </Button>
                  }
                />
              </div>
            </div>

            {/* Donut + progress bars */}
            {breakdownByType.length === 0 ? (
              <div className="finance-card flex flex-col items-center justify-center py-16 text-center">
                <TrendingUp className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No income in this period.
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Tap &ldquo;Add Income&rdquo; to get started.
                </p>
              </div>
            ) : (
              <div className="finance-card p-6">
                <div className="grid gap-6 md:grid-cols-[240px_1fr]">
                  <div className="mx-auto aspect-square w-full max-w-[240px]">
                    <ReactECharts
                      option={pieOption}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>

                  <div className="flex flex-col justify-center gap-2.5">
                    {breakdownByType.map((item) => {
                      const pct =
                        dateFilteredTotal > 0
                          ? (item.value / dateFilteredTotal) * 100
                          : 0;
                      return (
                        <div key={item.type} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: item.color }}
                              />
                              <span>{item.label}</span>
                            </div>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {format(item.value)} ({pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: item.color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Savings summary */}
                    {dateFilteredExpenses > 0 && dateFilteredTotal > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">
                          Earned {format(dateFilteredTotal)} — Spent{" "}
                          {format(dateFilteredExpenses)} — Saved{" "}
                          <span className="text-income font-medium">
                            {format(dateFilteredTotal - dateFilteredExpenses)} (
                            {(
                              ((dateFilteredTotal - dateFilteredExpenses) /
                                dateFilteredTotal) *
                              100
                            ).toFixed(1)}
                            %)
                          </span>
                        </p>
                      </div>
                    )}
                    {dateFilteredExpenses === 0 && dateFilteredTotal > 0 && (
                      <p className="text-xs text-muted-foreground/60 mt-2 pt-2 border-t border-border/50">
                        Add expense data for savings analysis.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Tab 2: Records                                                  */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="records" className="space-y-4 pt-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by description, source, or notes..."
                className="pl-9"
              />
            </div>

            {/* Type filter pills */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setTypeFilter("all")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  typeFilter === "all"
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                )}
              >
                All
              </button>
              {typesPresent.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    typeFilter === t
                      ? "bg-foreground text-background"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  {INCOME_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Add income button */}
            <div className="flex justify-end">
              <IncomeDialog
                onSave={handleSave}
                onCreateRecurring={addTemplate}
                trigger={
                  <Button size="sm">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add Income
                  </Button>
                }
              />
            </div>

            {/* Table */}
            {filteredEntries.length === 0 ? (
              <div className="finance-card flex flex-col items-center justify-center py-12 text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No records found.</p>
              </div>
            ) : (
              <div className="finance-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left">
                        <th
                          className="px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none"
                          onClick={() => toggleSort("date")}
                        >
                          <span className="inline-flex items-center gap-1">
                            Date
                            {sortField === "date" && (
                              <ArrowUpDown className="h-3 w-3" />
                            )}
                          </span>
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">
                          Type
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
                          Source
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                          Description
                        </th>
                        <th
                          className="px-4 py-3 font-medium text-muted-foreground text-right cursor-pointer select-none"
                          onClick={() => toggleSort("amount")}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Amount
                            {sortField === "amount" && (
                              <ArrowUpDown className="h-3 w-3" />
                            )}
                          </span>
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEntries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                            {formatDateString(entry.date)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {entry.isRecurring && (
                                <RefreshCw className="h-3 w-3 text-muted-foreground" />
                              )}
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor: INCOME_TYPE_COLORS[entry.type],
                                }}
                              />
                              {INCOME_TYPE_LABELS[entry.type]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                            {entry.source || "\u2014"}
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <div>
                              <span className="line-clamp-1">{entry.description}</span>
                              {entry.notes && (
                                <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                  {entry.notes}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span className="font-mono tabular-nums text-income">
                              {CURRENCY_SYMBOLS[entry.currency]}
                              {entry.amount.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                            {entry.currency !== currency && (
                              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                                ({format(entry.amount, entry.currency)})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <IncomeDialog
                                entry={entry}
                                onSave={handleSave}
                                trigger={
                                  <Button variant="ghost" size="icon-xs">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                }
                              />
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setDeleteTarget(entry)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-border/40 px-4 py-3">
                    <p className="text-xs text-muted-foreground">
                      {filteredEntries.length} records · Page {page + 1} of {totalPages}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Tab 3: Trends & Insights                                        */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="trends" className="space-y-6 pt-4">
            <div className="finance-card p-6">
              <IncomeTrend entries={entries} />
            </div>

            <div className="finance-card p-6">
              <IncomePaceChart entries={entries} />
            </div>

            <div className="finance-card p-6">
              <IncomeComparisonView
                entries={entries}
                monthA={compMonthA}
                monthB={compMonthB}
                onMonthAChange={setCompMonthA}
                onMonthBChange={setCompMonthB}
              />
            </div>
          </TabsContent>
        </Tabs>
      </BlurFade>

      {/* ================================================================= */}
      {/* Delete Confirmation Dialog                                         */}
      {/* ================================================================= */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Income Entry</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;
              {deleteTarget?.description}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app compiles and loads**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx tsc --noEmit 2>&1 | head -20`

Then open http://localhost:3001/income in the browser and verify:
- Hero section shows with animated total, summary tiles (This Month, Last Month, Weekly Avg, Monthly Pace)
- Three tabs render: Breakdown, Records, Trends & Insights
- Breakdown tab shows date range filter pills, Recurring/Add Income buttons, donut chart
- Records tab shows search bar, filter pills, sortable table headers, pagination
- Trends tab shows 3 chart cards
- Add Income dialog shows Source field, validation errors, recurring toggle
- Delete uses controlled dialog that auto-closes

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/income/page.tsx
git commit -m "feat(income): complete page rewrite with tabs, search, pagination, sorting, trends, recurring, savings summary"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Tab structure (Breakdown/Records/Trends) matching expenses
- ✅ Hero with Weekly Avg + Monthly Pace (color-coded, inverted for income: up=green)
- ✅ DateRangeFilter reused from expenses (5 presets + custom)
- ✅ Recurring income engine + dialog
- ✅ Income trends (12mo bar chart with category toggle)
- ✅ Cumulative pace chart (current vs last month)
- ✅ Comparison view (month vs month with % change)
- ✅ Search (description + source + notes)
- ✅ Sortable columns (date, amount)
- ✅ Pagination (20 per page)
- ✅ Notes visible below description in table rows
- ✅ Source field in dialog and table
- ✅ Savings summary ("Earned X — Spent Y — Saved Z (N%)")
- ✅ Bug fix: type select displays labels via SelectItem children
- ✅ Bug fix: validation shows red borders + error messages
- ✅ Bug fix: delete uses controlled dialog (auto-closes)
- ✅ Bug fix: removed all commented-out code
- ✅ Recurring icon (RefreshCw) on auto-generated entries
- ✅ normalizeIncomeEntry for forward-compat

**Placeholder scan:** No TBD, TODO, or placeholder text found.

**Type consistency:** `IncomeEntry`, `RecurringIncome`, `IncomeType`, `Currency`, `RecurringFrequency` — consistent across all files. `normalizeIncomeEntry` signature matches usage in page. Hook `useRecurringIncome` matches the pattern of `useRecurringExpenses`.
