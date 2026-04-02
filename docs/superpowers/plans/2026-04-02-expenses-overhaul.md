# Expenses Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the expenses page from basic CRUD into a comprehensive expense analysis tool with recurring expenses, date filtering, search, spending trends, payment methods, image attachments, comparison views, and income ratio analysis.

**Architecture:** Hybrid layout — persistent hero section with 3 tabbed content areas (Breakdown, Records, Trends & Insights). New components are extracted into `components/expenses/`. Data model extends `ExpenseEntry` with backward-compatible fields and adds a new `RecurringExpense` type. All charts use ECharts (existing lib). All dates use Sydney timezone (existing pattern).

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, @base-ui/react (headless UI), ECharts via echarts-for-react, lucide-react icons, motion (animations), localStorage persistence.

**Spec:** `docs/superpowers/specs/2026-04-02-expenses-overhaul-design.md`

---

### Task 1: Types & Constants Foundation

**Files:**
- Modify: `lib/utils/types.ts:1-65`
- Modify: `lib/utils/constants.ts:1-103`

- [ ] **Step 1: Add PaymentMethod type and update ExpenseEntry in types.ts**

Add after line 37 (after `ExpenseType`):

```typescript
export type PaymentMethod = "cash" | "debit_card" | "credit_card" | "bank_transfer" | "other";

export type RecurringFrequency = "weekly" | "fortnightly" | "monthly" | "yearly";
```

Update `ExpenseEntry` interface (lines 54-65) to:

```typescript
export interface ExpenseEntry {
  id: string;
  type: ExpenseType;
  description: string;
  amount: number;
  currency: Currency;
  vendor: string;
  date: string; // YYYY-MM-DD
  notes: string;
  images: string[]; // base64 data URLs
  createdAt: number;
  paymentMethod: PaymentMethod;
  isRecurring?: boolean;
  recurringId?: string;
}
```

Add `RecurringExpense` interface after `ExpenseEntry`:

```typescript
export interface RecurringExpense {
  id: string;
  type: ExpenseType;
  description: string;
  amount: number;
  currency: Currency;
  vendor: string;
  paymentMethod: PaymentMethod;
  notes: string;
  frequency: RecurringFrequency;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  lastGeneratedDate?: string; // YYYY-MM-DD
  active: boolean;
  createdAt: number;
}
```

- [ ] **Step 2: Add constants for new types in constants.ts**

Add after line 103 (after `EXPENSE_TYPE_COLORS`):

```typescript
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  debit_card: "Debit Card",
  credit_card: "Credit Card",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

export const PAYMENT_METHOD_COLORS: Record<PaymentMethod, string> = {
  cash: "#2e8b57",
  debit_card: "#4d7cc7",
  credit_card: "#c9503f",
  bank_transfer: "#d4a033",
  other: "#708090",
};

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  yearly: "Yearly",
};
```

Add the imports at top of constants.ts:

```typescript
import type { IncomeType, ExpenseType, HoldingType, Currency, PaymentMethod, RecurringFrequency } from "./types";
```

- [ ] **Step 3: Add normalizeExpenseEntry helper in types.ts**

Add at the bottom of `types.ts`:

```typescript
/** Normalize old ExpenseEntry records that lack new fields */
export function normalizeExpenseEntry(e: Record<string, unknown>): ExpenseEntry {
  return {
    id: e.id as string,
    type: (e.type as ExpenseType) ?? "other",
    description: (e.description as string) ?? "",
    amount: (e.amount as number) ?? 0,
    currency: (e.currency as Currency) ?? "AUD",
    vendor: (e.vendor as string) ?? "",
    date: (e.date as string) ?? "",
    notes: (e.notes as string) ?? "",
    images: (e.images as string[]) ?? [],
    createdAt: (e.createdAt as number) ?? Date.now(),
    paymentMethod: (e.paymentMethod as PaymentMethod) ?? "other",
    isRecurring: (e.isRecurring as boolean) ?? false,
    recurringId: e.recurringId as string | undefined,
  };
}
```

- [ ] **Step 4: Verify the app compiles**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx next build --no-lint 2>&1 | tail -5`

Expected: Build succeeds (existing code still works because new fields are optional / have defaults at usage sites).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/types.ts lib/utils/constants.ts
git commit -m "feat: add PaymentMethod, RecurringExpense types and constants"
```

---

### Task 2: Timezone & Date Helpers

**Files:**
- Modify: `lib/utils/timezone.ts:1-108`

- [ ] **Step 1: Add date range helpers**

Add these functions at the end of `lib/utils/timezone.ts`:

```typescript
/** Get the number of days in a given YYYY-MM month key */
export function getDaysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

/** Get today's day-of-month in Sydney timezone (1-based) */
export function getSydneyDayOfMonth(): number {
  const dateStr = getSydneyDateString(); // YYYY-MM-DD
  return parseInt(dateStr.split("-")[2], 10);
}

/** Get start and end date strings for a given month key (YYYY-MM) */
export function getMonthDateRange(monthKey: string): { from: string; to: string } {
  const days = getDaysInMonth(monthKey);
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(days).padStart(2, "0")}`,
  };
}

/** Get all month keys that have data, sorted newest first */
export function getMonthKeysFromEntries(entries: { date: string }[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    if (e.date) set.add(e.date.slice(0, 7));
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

/** Get last N month keys from current month (inclusive), ordered oldest→newest */
export function getLastNMonthKeys(n: number): string[] {
  const today = getSydneyDateString();
  const [year, month] = today.split("-").map(Number);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let m = month - i;
    let y = year;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

/** Get YYYY-MM-DD for the first day of the current year (Sydney) */
export function getYTDStartDate(): string {
  return `${getCurrentYearKey()}-01-01`;
}

/** Format a month key (YYYY-MM) to "Mar 2026" format */
export function monthKeyToFullLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1);
  return date.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

/** Compute occurrence dates for a recurring expense between two dates */
export function computeOccurrences(
  startDate: string,
  frequency: "weekly" | "fortnightly" | "monthly" | "yearly",
  fromDate: string,
  toDate: string,
): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const to = new Date(ty, tm - 1, td);

  if (frequency === "weekly" || frequency === "fortnightly") {
    const stepDays = frequency === "weekly" ? 7 : 14;
    let current = new Date(start);
    // Advance to the first occurrence on or after fromDate
    while (current < from) {
      current.setDate(current.getDate() + stepDays);
    }
    while (current <= to) {
      dates.push(formatToDateString(current));
      current.setDate(current.getDate() + stepDays);
    }
  } else if (frequency === "monthly") {
    const targetDay = sd;
    let y = from.getFullYear();
    let m = from.getMonth(); // 0-based
    // Start from the month of startDate if it's after fromDate's month
    if (new Date(sy, sm - 1, 1) > from) {
      y = sy;
      m = sm - 1;
    }
    while (true) {
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const day = Math.min(targetDay, daysInMonth);
      const candidate = new Date(y, m, day);
      if (candidate > to) break;
      if (candidate >= from && candidate >= start) {
        dates.push(formatToDateString(candidate));
      }
      m++;
      if (m > 11) { m = 0; y++; }
    }
  } else if (frequency === "yearly") {
    const targetMonth = sm - 1;
    const targetDay = sd;
    let y = from.getFullYear();
    if (new Date(y, targetMonth, targetDay) < from) y++;
    while (true) {
      const daysInMonth = new Date(y, targetMonth + 1, 0).getDate();
      const day = Math.min(targetDay, daysInMonth);
      const candidate = new Date(y, targetMonth, day);
      if (candidate > to) break;
      if (candidate >= start) {
        dates.push(formatToDateString(candidate));
      }
      y++;
    }
  }

  return dates;
}

function formatToDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx next build --no-lint 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add lib/utils/timezone.ts
git commit -m "feat: add date range and recurring occurrence helpers"
```

---

### Task 3: Image Upload & Viewer Components

**Files:**
- Create: `components/expenses/image-upload.tsx`
- Create: `components/expenses/image-viewer.tsx`

- [ ] **Step 1: Create ImageUpload component**

Create `components/expenses/image-upload.tsx`:

```typescript
"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ImagePlus, X } from "lucide-react";

interface ImageUploadProps {
  images: string[];
  onChange: (images: string[]) => void;
  maxImages?: number;
}

export function ImageUpload({ images, onChange, maxImages = 3 }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const remaining = maxImages - images.length;
    const toProcess = Array.from(files).slice(0, remaining);

    for (const file of toProcess) {
      if (!file.type.startsWith("image/")) continue;
      // Skip files > 500KB
      if (file.size > 500 * 1024) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        onChange([...images, result]);
      };
      reader.readAsDataURL(file);
    }

    // Reset input so same file can be selected again
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleRemove(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <div key={i} className="relative group">
            <img
              src={src}
              alt={`Attachment ${i + 1}`}
              className="h-12 w-12 rounded-md object-cover border border-border"
            />
            <button
              type="button"
              onClick={() => handleRemove(i)}
              className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
      {images.length < maxImages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          className="text-xs"
        >
          <ImagePlus className="h-3.5 w-3.5 mr-1" />
          Add Image
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
```

- [ ] **Step 2: Create ImageViewer component**

Create `components/expenses/image-viewer.tsx`:

```typescript
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageViewerProps {
  images: string[];
  description: string;
}

export function ImageViewer({ images, description }: ImageViewerProps) {
  if (images.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attachments</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Attachment ${i + 1}`}
              className="w-full rounded-lg border border-border"
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/expenses/image-upload.tsx components/expenses/image-viewer.tsx
git commit -m "feat: add ImageUpload and ImageViewer components"
```

---

### Task 4: Updated Expense Dialog

**Files:**
- Modify: `components/expenses/expense-dialog.tsx:1-212`

- [ ] **Step 1: Rewrite expense-dialog.tsx with new fields**

Replace the entire contents of `components/expenses/expense-dialog.tsx`:

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
  ExpenseType,
  Currency,
  PaymentMethod,
  RecurringFrequency,
  RecurringExpense,
} from "@/lib/utils/types";
import {
  EXPENSE_TYPE_LABELS,
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
}

const EXPENSE_TYPES = Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[];
const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];
const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as RecurringFrequency[];

export function ExpenseDialog({ entry, onSave, onCreateRecurring, trigger }: ExpenseDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ExpenseType>(entry?.type ?? "food");
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
      setType(entry?.type ?? "food");
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
        lastGeneratedDate: date, // already created the first entry manually
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
```

- [ ] **Step 2: Verify the dev server compiles the dialog**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx next build --no-lint 2>&1 | tail -10`

Note: The page may have type errors since it passes `handleSave` which expects old shape. This is expected — we'll fix when rewriting the page.

- [ ] **Step 3: Commit**

```bash
git add components/expenses/expense-dialog.tsx
git commit -m "feat: add payment method, recurring toggle, image upload to expense dialog"
```

---

### Task 5: Recurring Expenses Management

**Files:**
- Create: `hooks/use-recurring-expenses.ts`
- Create: `components/expenses/recurring-dialog.tsx`

- [ ] **Step 1: Create the useRecurringExpenses hook**

Create `hooks/use-recurring-expenses.ts`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useLocalStorage } from "./use-local-storage";
import type { RecurringExpense, ExpenseEntry } from "@/lib/utils/types";
import { getSydneyDateString, computeOccurrences } from "@/lib/utils/timezone";

export function useRecurringExpenses(
  entries: ExpenseEntry[],
  setEntries: (value: ExpenseEntry[] | ((prev: ExpenseEntry[]) => ExpenseEntry[])) => void,
) {
  const [templates, setTemplates] = useLocalStorage<RecurringExpense[]>(
    "recurring_expenses",
    [],
  );
  const hasGenerated = useRef(false);

  // Auto-generate missing entries on mount
  useEffect(() => {
    if (hasGenerated.current) return;
    if (templates.length === 0) return;

    hasGenerated.current = true;
    const today = getSydneyDateString();
    const newEntries: ExpenseEntry[] = [];
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

      // Filter out dates that already have an entry with this recurringId
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
          vendor: template.vendor,
          paymentMethod: template.paymentMethod,
          date,
          notes: template.notes,
          images: [],
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

  function addTemplate(template: RecurringExpense) {
    setTemplates((prev) => [...prev, template]);
  }

  function updateTemplate(updated: RecurringExpense) {
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

- [ ] **Step 2: Create RecurringDialog component**

Create `components/expenses/recurring-dialog.tsx`:

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
import { Badge } from "@/components/ui/badge";
import type {
  RecurringExpense,
  ExpenseType,
  Currency,
  PaymentMethod,
  RecurringFrequency,
} from "@/lib/utils/types";
import {
  EXPENSE_TYPE_LABELS,
  CURRENCIES,
  PAYMENT_METHOD_LABELS,
  FREQUENCY_LABELS,
} from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { RefreshCw, Plus, Pencil, Trash2, Pause, Play } from "lucide-react";

// ---------------------------------------------------------------------------
// Template Form (used for add/edit)
// ---------------------------------------------------------------------------

function RecurringForm({
  template,
  onSave,
  onCancel,
}: {
  template?: RecurringExpense;
  onSave: (t: RecurringExpense) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<ExpenseType>(template?.type ?? "food");
  const [description, setDescription] = useState(template?.description ?? "");
  const [amount, setAmount] = useState(template?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(template?.currency ?? "AUD");
  const [vendor, setVendor] = useState(template?.vendor ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(template?.paymentMethod ?? "other");
  const [frequency, setFrequency] = useState<RecurringFrequency>(template?.frequency ?? "monthly");
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
      vendor: vendor.trim(),
      paymentMethod,
      notes: "",
      frequency,
      startDate,
      endDate: endDate || undefined,
      lastGeneratedDate: template?.lastGeneratedDate,
      active: template?.active ?? true,
      createdAt: template?.createdAt ?? Date.now(),
    });
  }

  const EXPENSE_TYPES = Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[];
  const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];
  const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as RecurringFrequency[];

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => v && setType(v as ExpenseType)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {EXPENSE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{EXPENSE_TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Monthly rent" />
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

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-2">
          <Label>Vendor</Label>
          <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Landlord" />
        </div>
        <div className="grid gap-2">
          <Label>Payment Method</Label>
          <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (<SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
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
// Main Recurring Dialog
// ---------------------------------------------------------------------------

interface RecurringDialogProps {
  templates: RecurringExpense[];
  onAdd: (t: RecurringExpense) => void;
  onUpdate: (t: RecurringExpense) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  trigger: React.ReactNode;
}

export function RecurringDialog({
  templates,
  onAdd,
  onUpdate,
  onDelete,
  onToggle,
  trigger,
}: RecurringDialogProps) {
  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [editTarget, setEditTarget] = useState<RecurringExpense | undefined>();

  function handleStartEdit(t: RecurringExpense) {
    setEditTarget(t);
    setMode("edit");
  }

  function handleSaveNew(t: RecurringExpense) {
    onAdd(t);
    setMode("list");
  }

  function handleSaveEdit(t: RecurringExpense) {
    onUpdate(t);
    setMode("list");
    setEditTarget(undefined);
  }

  return (
    <Dialog onOpenChange={() => { setMode("list"); setEditTarget(undefined); }}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recurring Expenses</DialogTitle>
          <DialogDescription>
            Manage your recurring expense templates. Active templates auto-generate entries.
          </DialogDescription>
        </DialogHeader>

        {mode === "list" && (
          <div className="space-y-3">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No recurring expenses set up yet.
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
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onToggle(t.id)}
                      title={t.active ? "Pause" : "Resume"}
                    >
                      {t.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleStartEdit(t)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDelete(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setMode("add")}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Recurring Expense
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

- [ ] **Step 3: Commit**

```bash
git add hooks/use-recurring-expenses.ts components/expenses/recurring-dialog.tsx
git commit -m "feat: add recurring expenses hook and management dialog"
```

---

### Task 6: Date Range Filter Component

**Files:**
- Create: `components/expenses/date-range-filter.tsx`

- [ ] **Step 1: Create DateRangeFilter**

Create `components/expenses/date-range-filter.tsx`:

```typescript
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getMonthDateRange,
  getYTDStartDate,
  getSydneyDateString,
} from "@/lib/utils/timezone";

export type DatePreset = "this_month" | "last_month" | "last_90" | "ytd" | "custom";

export interface DateRange {
  from: string;
  to: string;
}

interface DateRangeFilterProps {
  value: DatePreset;
  customRange: DateRange;
  onChange: (preset: DatePreset, range: DateRange) => void;
}

function getPresetRange(preset: DatePreset): DateRange {
  const today = getSydneyDateString();
  switch (preset) {
    case "this_month":
      return getMonthDateRange(getCurrentMonthKey());
    case "last_month":
      return getMonthDateRange(getLastMonthKey());
    case "last_90": {
      const to = today;
      const d = new Date();
      d.setDate(d.getDate() - 89);
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { from, to };
    }
    case "ytd":
      return { from: getYTDStartDate(), to: today };
    default:
      return { from: today, to: today };
  }
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "last_90", label: "Last 90 Days" },
  { key: "ytd", label: "YTD" },
  { key: "custom", label: "Custom" },
];

export function DateRangeFilter({ value, customRange, onChange }: DateRangeFilterProps) {
  function handlePresetClick(preset: DatePreset) {
    if (preset === "custom") {
      onChange("custom", customRange);
    } else {
      onChange(preset, getPresetRange(preset));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => handlePresetClick(p.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              value === p.key
                ? "bg-foreground text-background"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customRange.from}
            onChange={(e) => onChange("custom", { ...customRange, from: e.target.value })}
            className="w-auto text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={customRange.to}
            onChange={(e) => onChange("custom", { ...customRange, to: e.target.value })}
            className="w-auto text-xs"
          />
        </div>
      )}
    </div>
  );
}

export { getPresetRange };
```

- [ ] **Step 2: Commit**

```bash
git add components/expenses/date-range-filter.tsx
git commit -m "feat: add DateRangeFilter component with presets"
```

---

### Task 7: Trend & Analysis Chart Components

**Files:**
- Create: `components/expenses/spending-trend.tsx`
- Create: `components/expenses/comparison-view.tsx`
- Create: `components/expenses/cumulative-pace-chart.tsx`
- Create: `components/expenses/payment-method-breakdown.tsx`

- [ ] **Step 1: Create SpendingTrend chart**

Create `components/expenses/spending-trend.tsx`:

```typescript
"use client";

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ExpenseEntry, ExpenseType } from "@/lib/utils/types";
import { EXPENSE_TYPE_LABELS, EXPENSE_TYPE_COLORS } from "@/lib/utils/constants";
import { getLastNMonthKeys, monthKeyToLabel, getMonthKey } from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";
import { cn } from "@/lib/utils";

interface SpendingTrendProps {
  entries: ExpenseEntry[];
}

export function SpendingTrend({ entries }: SpendingTrendProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, format: formatCur } = useCurrency();
  const [byCategory, setByCategory] = useState(false);

  const monthKeys = useMemo(() => getLastNMonthKeys(12), []);

  const option = useMemo(() => {
    const base = getCartesianBaseOption(isDark);

    if (!byCategory) {
      // Single area line
      const data = monthKeys.map((mk) => {
        return entries
          .filter((e) => getMonthKey(e.date) === mk)
          .reduce((sum, e) => sum + convert(e.amount, e.currency), 0);
      });

      return {
        ...base,
        xAxis: { ...base.xAxis, type: "category" as const, data: monthKeys.map(monthKeyToLabel) },
        yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatAxisValue(v) } },
        series: [{
          type: "line" as const,
          data,
          smooth: true,
          areaStyle: { opacity: 0.15 },
          lineStyle: { width: 2 },
        }],
      };
    }

    // Stacked by category (top 5 + other)
    const categoryTotals: Record<string, number> = {};
    for (const e of entries) {
      categoryTotals[e.type] = (categoryTotals[e.type] ?? 0) + convert(e.amount, e.currency);
    }
    const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5).map(([t]) => t as ExpenseType);
    const hasOther = sorted.length > 5;

    const series = top5.map((t) => ({
      name: EXPENSE_TYPE_LABELS[t],
      type: "line" as const,
      stack: "total",
      areaStyle: { opacity: 0.3 },
      lineStyle: { width: 1.5 },
      itemStyle: { color: EXPENSE_TYPE_COLORS[t] },
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
        <p className="label-mono">Monthly Spending (12 months)</p>
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

- [ ] **Step 2: Create ComparisonView**

Create `components/expenses/comparison-view.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ExpenseEntry, ExpenseType } from "@/lib/utils/types";
import {
  EXPENSE_TYPE_LABELS,
  EXPENSE_TYPE_COLORS,
} from "@/lib/utils/constants";
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

interface ComparisonViewProps {
  entries: ExpenseEntry[];
  monthA: string;
  monthB: string;
  onMonthAChange: (v: string) => void;
  onMonthBChange: (v: string) => void;
}

export function ComparisonView({
  entries,
  monthA,
  monthB,
  onMonthAChange,
  onMonthBChange,
}: ComparisonViewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, format: formatCur } = useCurrency();

  const monthKeys = useMemo(() => getMonthKeysFromEntries(entries), [entries]);

  const { totalA, totalB, categoryData } = useMemo(() => {
    const entriesA = entries.filter((e) => getMonthKey(e.date) === monthA);
    const entriesB = entries.filter((e) => getMonthKey(e.date) === monthB);

    const tA = entriesA.reduce((s, e) => s + convert(e.amount, e.currency), 0);
    const tB = entriesB.reduce((s, e) => s + convert(e.amount, e.currency), 0);

    // Build per-category comparison
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
      .map(([type, { a, b }]) => ({ type: type as ExpenseType, a, b }))
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b))
      .slice(0, 8);

    return { totalA: tA, totalB: tB, categoryData: data };
  }, [entries, monthA, monthB, convert]);

  const chartOption = useMemo(() => {
    const base = getCartesianBaseOption(isDark);
    const categories = categoryData.map((d) => EXPENSE_TYPE_LABELS[d.type]);

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
          itemStyle: { color: isDark ? "#4da8b8" : "#4d7cc7", borderRadius: [3, 3, 0, 0] },
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
          <Select value={monthA} onValueChange={onMonthAChange}>
            <SelectTrigger className="w-[120px]" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthKeys.map((mk) => (
                <SelectItem key={mk} value={mk}>{monthKeyToFullLabel(mk)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">vs</span>
          <Select value={monthB} onValueChange={onMonthBChange}>
            <SelectTrigger className="w-[120px]" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthKeys.map((mk) => (
                <SelectItem key={mk} value={mk}>{monthKeyToFullLabel(mk)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="finance-card p-3 text-center">
          <p className="label-mono mb-1">{monthKeyToFullLabel(monthA)}</p>
          <p className="text-lg font-semibold tabular-nums">{formatCur(totalA)}</p>
        </div>
        <div className="finance-card p-3 text-center">
          <p className="label-mono mb-1">{monthKeyToFullLabel(monthB)}</p>
          <p className="text-lg font-semibold tabular-nums">{formatCur(totalB)}</p>
          {totalA > 0 && (
            <span className={`inline-flex items-center gap-0.5 text-xs mt-1 ${pctChange > 0 ? "text-expense" : pctChange < 0 ? "text-income" : "text-muted-foreground"}`}>
              {pctChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : pctChange < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {Math.abs(pctChange).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      {categoryData.length > 0 && (
        <ReactECharts option={chartOption} style={{ height: "280px" }} />
      )}

      {/* Per-category deltas */}
      {categoryData.length > 0 && (
        <div className="space-y-1.5">
          {categoryData.map((d) => {
            const delta = d.a > 0 ? ((d.b - d.a) / d.a) * 100 : 0;
            return (
              <div key={d.type} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EXPENSE_TYPE_COLORS[d.type] }} />
                  <span>{EXPENSE_TYPE_LABELS[d.type]}</span>
                </div>
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="text-muted-foreground">{formatCur(d.a)}</span>
                  <span>→</span>
                  <span>{formatCur(d.b)}</span>
                  {d.a > 0 && (
                    <span className={delta > 0 ? "text-expense" : delta < 0 ? "text-income" : "text-muted-foreground"}>
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

- [ ] **Step 3: Create CumulativePaceChart**

Create `components/expenses/cumulative-pace-chart.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ExpenseEntry } from "@/lib/utils/types";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getMonthKey,
  getDaysInMonth,
  monthKeyToFullLabel,
} from "@/lib/utils/timezone";
import { getCartesianBaseOption, formatAxisValue } from "@/lib/utils/echarts";

interface CumulativePaceChartProps {
  entries: ExpenseEntry[];
}

export function CumulativePaceChart({ entries }: CumulativePaceChartProps) {
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
          itemStyle: { color: isDark ? "#e09770" : "#c95f3f" },
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
      <p className="label-mono">Spending Pace (This vs Last Month)</p>
      <ReactECharts option={option} style={{ height: "240px" }} />
    </div>
  );
}
```

- [ ] **Step 4: Create PaymentMethodBreakdown**

Create `components/expenses/payment-method-breakdown.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ExpenseEntry, PaymentMethod } from "@/lib/utils/types";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLORS } from "@/lib/utils/constants";
import { getPieBaseOption } from "@/lib/utils/echarts";

interface PaymentMethodBreakdownProps {
  entries: ExpenseEntry[];
}

export function PaymentMethodBreakdown({ entries }: PaymentMethodBreakdownProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { convert, format: formatCur } = useCurrency();

  const breakdown = useMemo(() => {
    const map: Partial<Record<PaymentMethod, number>> = {};
    for (const e of entries) {
      const method = e.paymentMethod ?? "other";
      map[method] = (map[method] ?? 0) + convert(e.amount, e.currency);
    }
    return Object.entries(map)
      .filter(([_, v]) => (v as number) > 0)
      .map(([method, value]) => ({
        method: method as PaymentMethod,
        label: PAYMENT_METHOD_LABELS[method as PaymentMethod],
        value: value as number,
        color: PAYMENT_METHOD_COLORS[method as PaymentMethod],
      }))
      .sort((a, b) => b.value - a.value);
  }, [entries, convert]);

  // Only show if there's at least one entry with a non-'other' method
  const hasRealMethods = breakdown.some((b) => b.method !== "other");
  if (!hasRealMethods && breakdown.length <= 1) return null;

  const total = breakdown.reduce((s, b) => s + b.value, 0);

  return (
    <div className="space-y-3">
      <p className="label-mono">By Payment Method</p>
      <div className="space-y-2">
        {breakdown.map((item) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div key={item.method} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                </div>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatCur(item.value)} ({pct.toFixed(0)}%)
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: item.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add components/expenses/spending-trend.tsx components/expenses/comparison-view.tsx components/expenses/cumulative-pace-chart.tsx components/expenses/payment-method-breakdown.tsx
git commit -m "feat: add spending trend, comparison, pace, and payment method charts"
```

---

### Task 8: Rewrite Main Expenses Page

**Files:**
- Modify: `app/(app)/expenses/page.tsx:1-469`

This is the biggest task — wires everything together with the hero + tabs layout.

- [ ] **Step 1: Rewrite expenses/page.tsx**

Replace the entire contents of `app/(app)/expenses/page.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import { useTheme } from "next-themes";
import ReactECharts from "echarts-for-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import { useRecurringExpenses } from "@/hooks/use-recurring-expenses";
import type {
  ExpenseEntry,
  ExpenseType,
  IncomeEntry,
  PaymentMethod,
} from "@/lib/utils/types";
import { normalizeExpenseEntry, CURRENCY_SYMBOLS } from "@/lib/utils/types";
import {
  EXPENSE_TYPE_LABELS,
  EXPENSE_TYPE_COLORS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/utils/constants";
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
  Receipt,
  Search,
  RefreshCw,
} from "lucide-react";

// Feature components
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { RecurringDialog } from "@/components/expenses/recurring-dialog";
import { ImageViewer } from "@/components/expenses/image-viewer";
import {
  DateRangeFilter,
  getPresetRange,
  type DatePreset,
  type DateRange,
} from "@/components/expenses/date-range-filter";
import { PaymentMethodBreakdown } from "@/components/expenses/payment-method-breakdown";
import { SpendingTrend } from "@/components/expenses/spending-trend";
import { ComparisonView } from "@/components/expenses/comparison-view";
import { CumulativePaceChart } from "@/components/expenses/cumulative-pace-chart";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPENSE_TYPES = Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[];

function sumConverted(
  entries: ExpenseEntry[],
  convert: (amount: number, from: ExpenseEntry["currency"]) => number,
) {
  return entries.reduce((acc, e) => acc + convert(e.amount, e.currency), 0);
}

function filterByDateRange(entries: ExpenseEntry[], range: DateRange): ExpenseEntry[] {
  return entries.filter((e) => e.date >= range.from && e.date <= range.to);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExpensesPage() {
  const [rawEntries, setEntries] = useLocalStorage<ExpenseEntry[]>(
    "expense_entries",
    [],
  );
  // Normalize old entries missing new fields
  const entries = useMemo(
    () => rawEntries.map((e) => normalizeExpenseEntry(e as Record<string, unknown>)),
    [rawEntries],
  );

  const [incomeEntries] = useLocalStorage<IncomeEntry[]>("income_entries", []);
  const { currency, format, convert, symbol } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Recurring expenses
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTemplate,
  } = useRecurringExpenses(entries, setEntries);

  // ---- State ----------------------------------------------------------------

  // Records tab filters
  const [typeFilter, setTypeFilter] = useState<ExpenseType | "all">("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

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
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntry | null>(null);

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

  // Daily average & velocity
  const daysElapsed = getSydneyDayOfMonth();
  const dailyAvg = daysElapsed > 0 ? thisMonthTotal / daysElapsed : 0;
  const daysInMonth = getDaysInMonth(currentMonth);
  const monthlyPace = dailyAvg * daysInMonth;
  const paceVsLast =
    lastMonthTotal > 0 ? ((monthlyPace - lastMonthTotal) / lastMonthTotal) * 100 : 0;

  // Breakdown by type (date-range-filtered)
  const dateFilteredEntries = useMemo(
    () => filterByDateRange(entries, activeDateRange),
    [entries, activeDateRange],
  );
  const dateFilteredTotal = sumConverted(dateFilteredEntries, convert);

  const breakdownByType = useMemo(() => {
    const map: Record<ExpenseType, number> = {} as Record<ExpenseType, number>;
    for (const t of EXPENSE_TYPES) map[t] = 0;
    for (const e of dateFilteredEntries) {
      map[e.type] += convert(e.amount, e.currency);
    }
    return EXPENSE_TYPES.filter((t) => map[t] > 0)
      .map((t) => ({
        type: t,
        label: EXPENSE_TYPE_LABELS[t],
        value: map[t],
        color: EXPENSE_TYPE_COLORS[t],
      }))
      .sort((a, b) => b.value - a.value);
  }, [dateFilteredEntries, convert]);

  // Income for ratio
  const dateFilteredIncome = useMemo(() => {
    return incomeEntries
      .filter((e) => e.date >= activeDateRange.from && e.date <= activeDateRange.to)
      .reduce((sum, e) => sum + convert(e.amount, e.currency), 0);
  }, [incomeEntries, activeDateRange, convert]);

  // Pie chart option
  const pieOption = useMemo(() => {
    const base = getPieBaseOption(isDark);
    return {
      ...base,
      series: [
        {
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
        },
      ],
    };
  }, [breakdownByType, isDark]);

  // Records tab: smart filter pills + search + method filter
  const typesPresent = useMemo(() => {
    const set = new Set<ExpenseType>();
    entries.forEach((e) => set.add(e.type));
    return Array.from(set);
  }, [entries]);

  const methodsPresent = useMemo(() => {
    const set = new Set<PaymentMethod>();
    entries.forEach((e) => {
      if (e.paymentMethod && e.paymentMethod !== "other") set.add(e.paymentMethod);
    });
    return Array.from(set);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    let result = [...entries];
    if (typeFilter !== "all") result = result.filter((e) => e.type === typeFilter);
    if (methodFilter !== "all")
      result = result.filter((e) => (e.paymentMethod ?? "other") === methodFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          (e.vendor ?? "").toLowerCase().includes(q),
      );
    }
    return result.sort(
      (a, b) =>
        (b.date ?? "").localeCompare(a.date ?? "") || b.createdAt - a.createdAt,
    );
  }, [entries, typeFilter, methodFilter, searchQuery]);

  // ---- Handlers -------------------------------------------------------------

  function handleSave(saved: ExpenseEntry) {
    setEntries((prev: ExpenseEntry[]) => {
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
    setEntries((prev: ExpenseEntry[]) => prev.filter((e) => e.id !== id));
    setDeleteTarget(null);
  }

  function handleDateRangeChange(preset: DatePreset, range: DateRange) {
    setDatePreset(preset);
    setCustomRange(range);
  }

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ================================================================= */}
      {/* Hero Section (always visible)                                     */}
      {/* ================================================================= */}
      <BlurFade delay={0}>
        <section className="space-y-4">
          <p className="label-mono">This Month&rsquo;s Expenses</p>
          <div className="display-number text-expense">
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
              <p className="label-mono mb-1">Daily Avg</p>
              <p className="font-semibold tabular-nums">{format(dailyAvg)}/day</p>
            </div>
            <div className="px-5 py-3 text-center">
              <p className="label-mono mb-1">Monthly Pace</p>
              <p
                className={cn(
                  "font-semibold tabular-nums",
                  paceVsLast > 10
                    ? "text-expense"
                    : paceVsLast < -10
                      ? "text-income"
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
      {/* Tabbed Content                                                    */}
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
                <RecurringDialog
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
                <ExpenseDialog
                  onSave={handleSave}
                  onCreateRecurring={addTemplate}
                  trigger={
                    <Button size="sm">
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add Expense
                    </Button>
                  }
                />
              </div>
            </div>

            {/* Donut + progress bars */}
            {breakdownByType.length === 0 ? (
              <div className="finance-card flex flex-col items-center justify-center py-16 text-center">
                <Receipt className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No expenses in this period.
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Tap &ldquo;Add Expense&rdquo; to get started.
                </p>
              </div>
            ) : (
              <div className="finance-card p-6">
                <div className="grid gap-6 md:grid-cols-[240px_1fr]">
                  {/* Donut Chart */}
                  <div className="mx-auto aspect-square w-full max-w-[240px]">
                    <ReactECharts
                      option={pieOption}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>

                  {/* Progress bars with income ratio */}
                  <div className="flex flex-col justify-center gap-2.5">
                    {breakdownByType.map((item) => {
                      const pct =
                        dateFilteredTotal > 0
                          ? (item.value / dateFilteredTotal) * 100
                          : 0;
                      const incomeRatio =
                        dateFilteredIncome > 0
                          ? (item.value / dateFilteredIncome) * 100
                          : null;
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
                              {incomeRatio !== null && (
                                <span className="ml-1.5 text-muted-foreground/60">
                                  · {incomeRatio.toFixed(1)}% of income
                                </span>
                              )}
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

                    {/* Expense-to-income summary */}
                    {dateFilteredIncome > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">
                          Total: {format(dateFilteredTotal)} of{" "}
                          {format(dateFilteredIncome)} income (
                          {((dateFilteredTotal / dateFilteredIncome) * 100).toFixed(1)}
                          %) — Savings rate:{" "}
                          <span className="text-income font-medium">
                            {(
                              ((dateFilteredIncome - dateFilteredTotal) /
                                dateFilteredIncome) *
                              100
                            ).toFixed(1)}
                            %
                          </span>
                        </p>
                      </div>
                    )}
                    {dateFilteredIncome === 0 && dateFilteredTotal > 0 && (
                      <p className="text-xs text-muted-foreground/60 mt-2 pt-2 border-t border-border/50">
                        Add income data for ratio analysis.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Payment method breakdown */}
            <div className="finance-card p-6">
              <PaymentMethodBreakdown entries={dateFilteredEntries} />
            </div>
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
                placeholder="Search by description or vendor..."
                className="pl-9"
              />
            </div>

            {/* Type filter pills (smart — only types with data) */}
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
                  {EXPENSE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Payment method filter pills */}
            {methodsPresent.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setMethodFilter("all")}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    methodFilter === "all"
                      ? "bg-foreground text-background"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  All Methods
                </button>
                {methodsPresent.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethodFilter(m)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      methodFilter === m
                        ? "bg-foreground text-background"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                    )}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            )}

            {/* Add expense button */}
            <div className="flex justify-end">
              <ExpenseDialog
                onSave={handleSave}
                onCreateRecurring={addTemplate}
                trigger={
                  <Button size="sm">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add Expense
                  </Button>
                }
              />
            </div>

            {/* Table */}
            {filteredEntries.length === 0 ? (
              <div className="finance-card flex flex-col items-center justify-center py-12 text-center">
                <Receipt className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No records found.</p>
              </div>
            ) : (
              <div className="finance-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left">
                        <th className="px-4 py-3 font-medium text-muted-foreground">
                          Date
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">
                          Type
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                          Description
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
                          Vendor
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground text-right">
                          Amount
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">
                          Method
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((entry) => (
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
                                <RefreshCw className="h-3 w-3 text-muted-foreground" title="Recurring" />
                              )}
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor: EXPENSE_TYPE_COLORS[entry.type],
                                }}
                              />
                              {EXPENSE_TYPE_LABELS[entry.type]}
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className="line-clamp-1">
                              {entry.description}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                            {entry.vendor || "\u2014"}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span className="font-mono tabular-nums text-expense">
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
                          <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                            {PAYMENT_METHOD_LABELS[entry.paymentMethod ?? "other"]}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {entry.images && entry.images.length > 0 && (
                                <ImageViewer
                                  images={entry.images}
                                  description={entry.description}
                                />
                              )}
                              <ExpenseDialog
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
              </div>
            )}
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Tab 3: Trends & Insights                                        */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="trends" className="space-y-6 pt-4">
            <div className="finance-card p-6">
              <SpendingTrend entries={entries} />
            </div>

            <div className="finance-card p-6">
              <CumulativePaceChart entries={entries} />
            </div>

            <div className="finance-card p-6">
              <ComparisonView
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
            <DialogTitle>Delete Expense</DialogTitle>
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

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx next build --no-lint 2>&1 | tail -10`

Then manually open `http://localhost:3001/expenses` and verify:
- Hero section shows with 4 tiles (This Month, Last Month, Daily Avg, Monthly Pace)
- 3 tabs appear: Breakdown, Records, Trends & Insights
- Breakdown tab has date range pills, donut chart area, payment method section
- Records tab has search, smart filter pills, table
- Trends tab has spending trend, cumulative pace, comparison view

- [ ] **Step 3: Commit**

```bash
git add app/(app)/expenses/page.tsx
git commit -m "feat: rewrite expenses page with hero + tabs layout and all new features"
```

---

### Task 9: Fix PaymentMethodBreakdown Empty State

**Files:**
- Modify: `app/(app)/expenses/page.tsx`

- [ ] **Step 1: Handle empty payment method breakdown gracefully**

In `app/(app)/expenses/page.tsx`, the PaymentMethodBreakdown component inside the Breakdown tab is wrapped in a `finance-card` div. The component returns `null` when there are no real payment methods. Wrap it to avoid rendering an empty card:

Find the payment method section in the Breakdown tab and change it from:

```tsx
            {/* Payment method breakdown */}
            <div className="finance-card p-6">
              <PaymentMethodBreakdown entries={dateFilteredEntries} />
            </div>
```

To:

```tsx
            {/* Payment method breakdown */}
            {dateFilteredEntries.some((e) => e.paymentMethod && e.paymentMethod !== "other") && (
              <div className="finance-card p-6">
                <PaymentMethodBreakdown entries={dateFilteredEntries} />
              </div>
            )}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/expenses/page.tsx
git commit -m "fix: hide payment method card when no methods are set"
```

---

### Task 10: Final Verification & Cleanup

- [ ] **Step 1: Run build to verify no type errors**

Run: `cd /Users/piyawatmahattanasawat/Desktop/personal-project/life-investment && npx next build --no-lint 2>&1 | tail -20`

- [ ] **Step 2: Manual smoke test**

Open `http://localhost:3001/expenses` and verify:

1. Hero: NumberTicker animates, all 4 tiles show values, Monthly Pace has color coding
2. Breakdown tab:
   - Date range filter pills work (switch between This Month, Last Month, etc.)
   - Custom date range inputs appear when "Custom" is selected
   - Donut chart updates with date range
   - Progress bars show "% of income" when income data exists
   - Savings rate line appears below
   - Payment method breakdown only shows if methods are tagged
3. Records tab:
   - Search filters by description and vendor
   - Only types with data show as filter pills
   - Payment method filter pills appear if methods are tagged
   - Recurring entries show ↻ icon
   - Paperclip icon shows for entries with images
   - Edit/delete work
4. Trends tab:
   - 12-month spending trend chart renders
   - "By Category" toggle switches to stacked area
   - Cumulative pace chart shows current vs last month
   - Comparison view has two month selectors
   - Grouped bar chart and delta list render
5. Add Expense dialog:
   - Payment Method field is present
   - "Make this recurring" checkbox works (add mode only)
   - Image upload lets you attach up to 3 images
   - Thumbnails show with remove button
6. Recurring dialog:
   - Accessible from Breakdown tab header
   - Can add/edit/delete/pause templates
7. Existing data loads correctly (backward compat)

- [ ] **Step 3: Fix any issues found during smoke test**

Address any compilation errors, runtime errors, or visual bugs found.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues from smoke testing expenses overhaul"
```
