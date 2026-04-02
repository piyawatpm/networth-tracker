# Expenses Page Overhaul — Design Spec

## Overview

Transform the expenses page from a basic CRUD tracker into a comprehensive expense analysis tool. 13 features organized via a Hybrid layout: persistent hero section + 3 tabbed content areas.

## Data Model Changes

### New Type: `PaymentMethod`

```typescript
type PaymentMethod = 'cash' | 'debit_card' | 'credit_card' | 'bank_transfer' | 'other';
```

Constants needed: `PAYMENT_METHOD_LABELS`, `PAYMENT_METHOD_COLORS`.

### Modified: `ExpenseEntry`

```typescript
interface ExpenseEntry {
  // existing fields unchanged
  id: string;
  type: ExpenseType;
  description: string;
  amount: number;
  currency: Currency;
  vendor: string;
  date: string;
  notes: string;
  images: string[];        // NOW wired to UI (was dead field)
  createdAt: number;
  // new fields (backward-compatible defaults)
  paymentMethod: PaymentMethod;  // default: 'other'
  isRecurring?: boolean;         // true if auto-generated
  recurringId?: string;          // links to RecurringExpense.id
}
```

### New Type: `RecurringExpense`

```typescript
interface RecurringExpense {
  id: string;
  type: ExpenseType;
  description: string;
  amount: number;
  currency: Currency;
  vendor: string;
  paymentMethod: PaymentMethod;
  notes: string;
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'yearly';
  startDate: string;           // YYYY-MM-DD
  endDate?: string;            // optional stop date
  lastGeneratedDate?: string;  // last date an entry was auto-created
  active: boolean;
  createdAt: number;
}
```

Constants needed: `FREQUENCY_LABELS` map.

### New localStorage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `"recurring_expenses"` | `RecurringExpense[]` | Recurring expense templates |

Existing key `"expense_entries"` gains new optional fields. Old entries without `paymentMethod` default to `'other'` at read time.

---

## Page Layout: Hybrid (C)

```
┌─────────────────────────────────────────────────┐
│  HERO SECTION (always visible, not in tabs)      │
│  ┌─────────────────────────────────────────────┐ │
│  │ "This Month's Expenses"  NumberTicker       │ │
│  │ ┌───────────┬───────────┬──────────┬──────┐ │ │
│  │ │This Month │Last Month │Daily Avg │Pace  │ │ │
│  │ └───────────┴───────────┴──────────┴──────┘ │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─[Breakdown]──[Records]──[Trends & Insights]─┐ │
│  │                                               │ │
│  │  (tab content rendered here)                  │ │
│  │                                               │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Feature 16: Revised Summary Tiles

Replace the 4-tile row:

| Position | Old | New | Computation |
|----------|-----|-----|-------------|
| 1 | This Month | **This Month** (keep) | Sum of entries in current Sydney calendar month |
| 2 | Last Month | **Last Month** (keep) | Sum of entries in previous Sydney calendar month |
| 3 | YTD | **Daily Average** | This month total / days elapsed in month (min 1) |
| 4 | All Time | **Monthly Pace** | Daily average × total days in current month. Color: green if < last month, amber if within 10%, red if > 110% of last month |

---

## Feature 13: Spending Velocity (Hero Enhancement)

The "Monthly Pace" tile IS the velocity indicator. Shows projected month-end total.

Computation:
```
daysElapsed = today.getDate()  // Sydney time
dailyAvg = thisMonthTotal / max(daysElapsed, 1)
pace = dailyAvg * daysInMonth
```

Visual treatment:
- Show as `→ A$X,XXX` with arrow prefix
- Color coding vs last month: green (on track to spend less), amber (similar), red (on track to spend more)
- Tooltip: "At your current daily average of A$X/day, you'll spend A$X,XXX this month"

---

## Tab 1: Breakdown

### Feature 3 + 17: Date Range Filter

**UI:** Row of pill buttons above the donut chart.

Presets: `This Month | Last Month | Last 90 Days | YTD | Custom`

Custom range: two `<input type="date">` fields appear inline when "Custom" is selected.

**State:** `dateRange: { from: string; to: string }` derived from the selected preset or custom inputs.

**Scope:** The date range filter affects ONLY Tab 1 content:
- Donut chart
- Category progress bars
- Expense-to-income ratio
- Payment method breakdown

The hero tiles always show current/last month (fixed). The Records tab has its own independent filtering.

### Feature 17: Date-Aware Donut Chart

The existing donut chart filters entries by the selected date range instead of hardcoded current month. Label updates to reflect the range (e.g., "Last 90 Days Breakdown" vs "This Month Breakdown").

### Feature 15: Expense-to-Income Ratio

Below the category progress bars, add a section:

**Per-category ratio:** Each progress bar label extends to show: `Food — A$450 (18%) · 12% of income`

The income percentage is computed by reading `income_entries` from localStorage for the same date range, summing income, then: `(categoryTotal / totalIncome * 100)`.

**Summary line below all bars:**
```
Total: A$2,340 of A$6,500 income (36%) — Savings rate: 64%
```

If no income data exists for the period, show "—" for income ratios and a subtle note: "Add income data for ratio analysis."

### Feature 8: Payment Method Breakdown

Below the expense-to-income summary, a small horizontal stacked bar chart showing spend distribution by payment method.

Only renders if at least one entry in the date range has a non-`'other'` payment method. Uses `PAYMENT_METHOD_COLORS` for segments.

Each segment shows: method label + amount + percentage on hover (tooltip).

---

## Tab 2: Records

### Feature 4: Search

**UI:** Single text input with `Search` (lucide) icon prefix, full width above the filter pills.

Placeholder: `"Search by description or vendor..."`

Behavior:
- Filters entries where `description` OR `vendor` contains the search term (case-insensitive)
- Applied client-side, no debounce needed for localStorage-sized datasets
- Combines with type filter and payment method filter (AND logic)

### Feature 10: Smart Filter Pills

Change from showing all 13 types to only types present in the data:

```typescript
const typesPresent = new Set(entries.map(e => e.type));
// Only render pills for types in typesPresent, plus "All"
```

Matches the existing income page pattern.

### Payment Method Filter

Second row of smaller pills below the type pills. Only shows payment methods present in data. Filters combine with type filter and search (AND logic).

### Feature 9: Receipt/Image Upload

**In ExpenseDialog:**
- New section below Notes: "Attachments"
- File input accepting `image/*`, multiple files
- On select: convert to base64 data URLs, store in `images[]`
- Show thumbnails (48x48) with X button to remove
- Max 3 images per entry (base64 in localStorage is expensive)
- Show total size warning if > 500KB

**In Records Table:**
- Paperclip icon (lucide `Paperclip`) appears in the row if `images.length > 0`
- Click opens a simple overlay/dialog showing the full images

### Recurring Badge

Entries with `isRecurring: true` show a small `↻` (RefreshCw icon from lucide, 12px) next to the type badge in the table. Tooltip: "Auto-generated from recurring: {description}".

### Table Columns

| Column | Mobile | Tablet+ | Notes |
|--------|--------|---------|-------|
| Date | visible | visible | |
| Type | visible | visible | color dot + label |
| Description | hidden sm | visible | truncate at 30ch |
| Vendor | hidden | visible md+ | |
| Amount | visible | visible | native + converted |
| Method | hidden | visible lg+ | icon only on lg, label on xl |
| Attachments | hidden | visible md+ | paperclip icon if images |
| Actions | visible | visible | edit + delete |

---

## Tab 3: Trends & Insights

### Feature 5: Monthly Spending Trend

**Chart:** Area chart (ECharts) showing total monthly spending for the last 12 months.

- X-axis: month labels (Jan, Feb, Mar...)
- Y-axis: amount in display currency
- Uses `getCartesianBaseOption(isDark)`
- Single series by default
- Toggle button: "By Category" — switches to stacked area chart with one series per category (top 5 categories + "Other")

### Feature 12: Comparison View

**UI:** Two Select dropdowns for month selection (populated from months that have data).

Default: current month vs last month.

**Visualization:** Grouped bar chart (ECharts) — each category shows two bars side by side (Month A color vs Month B color).

**Delta indicators:** Above the chart, summary cards:
```
┌──────────────┬──────────────┐
│  March 2026  │  April 2026  │
│  A$2,100     │  A$2,340     │
│              │  ↑ 11.4%     │
└──────────────┴──────────────┘
```

Below chart, per-category deltas as a list:
```
Food:          A$400 → A$450  ↑ 12.5%
Transport:     A$200 → A$180  ↓ 10.0%
Rent:          A$800 → A$800  — 0%
```

### Cumulative Spending Pace Chart (Feature 13 expanded)

Line chart showing cumulative daily spending:
- Line 1: This month (day 1 → today), solid primary color
- Line 2: Last month (full month), dashed muted color
- X-axis: day of month (1-31)
- Y-axis: cumulative amount

This reveals spending pace visually — if this month's line is above last month's at the same day, you're spending faster.

---

## Feature 2: Recurring Expenses

### Management UI

**Access:** "Manage Recurring" button in the Breakdown tab header (ghost button with RefreshCw icon).

**Opens:** A dialog (reuse Dialog component) with:
- Title: "Recurring Expenses"
- List of all recurring templates
- Each row: description, amount, frequency badge, next due date, active/paused toggle
- Add new template button (opens RecurringExpenseDialog)
- Edit (pencil) and Delete (trash) per row

### RecurringExpenseDialog

Similar to ExpenseDialog but with:
- Same fields: Type, Description, Amount + Currency, Vendor, Payment Method, Notes
- Additional fields: Frequency (Select: Weekly/Fortnightly/Monthly/Yearly), Start Date, End Date (optional)
- No images field (recurring templates don't need receipts)
- No date field (dates are computed from frequency + startDate)

### Auto-Generation Logic

```typescript
// Hook: useRecurringExpenseGenerator()
// Runs once on page mount via useEffect

function generateMissingEntries(
  templates: RecurringExpense[],
  existingEntries: ExpenseEntry[]
): { newEntries: ExpenseEntry[], updatedTemplates: RecurringExpense[] }

// For each active template:
// 1. Compute all occurrence dates from (lastGeneratedDate || startDate) to today
// 2. Skip dates that already have an entry with matching recurringId
// 3. Create ExpenseEntry for each missing date
// 4. Update template.lastGeneratedDate
```

**Frequency date computation:**
- Weekly: every 7 days from startDate
- Fortnightly: every 14 days from startDate
- Monthly: same day-of-month (clamp to month's last day, e.g., Jan 31 → Feb 28)
- Yearly: same month+day (handle Feb 29 → Feb 28 on non-leap years)

**All dates use Sydney timezone** (consistent with existing `getSydneyDateString()`).

Generated entries are fully editable and deletable. Deleting a generated entry doesn't affect the template or future generations. Editing a generated entry's amount/description is fine — it's detached from the template after creation.

---

## Expense Dialog Changes Summary

Fields in order:
1. Type (Select) — existing
2. Description (Input) — existing
3. Amount + Currency (grid) — existing
4. Vendor (Input) — existing
5. **Payment Method (Select)** — NEW: Cash / Debit Card / Credit Card / Bank Transfer / Other
6. Date (Input date) — existing
7. **Recurring toggle** — NEW (add mode only): Checkbox "Make this recurring" → reveals Frequency selector. On save, creates both the entry AND a RecurringExpense template.
8. Notes (Textarea) — existing
9. **Attachments** — NEW: file upload area, thumbnail previews, max 3 images

---

## Backward Compatibility

Old `ExpenseEntry` objects in localStorage that lack new fields:
- `paymentMethod`: default to `'other'` at read time
- `isRecurring`: default to `undefined`/`false`
- `recurringId`: default to `undefined`

No migration needed — handle at read time with defaults:
```typescript
const normalize = (e: any): ExpenseEntry => ({
  ...e,
  paymentMethod: e.paymentMethod ?? 'other',
  images: e.images ?? [],
});
```

---

## Components to Create

| Component | Location | Purpose |
|-----------|----------|---------|
| `RecurringDialog` | `components/expenses/recurring-dialog.tsx` | Manage recurring templates list |
| `RecurringExpenseForm` | `components/expenses/recurring-expense-form.tsx` | Add/edit a recurring template |
| `ImageUpload` | `components/expenses/image-upload.tsx` | File input + thumbnails for expense dialog |
| `ImageViewer` | `components/expenses/image-viewer.tsx` | Full-size image overlay |
| `DateRangeFilter` | `components/expenses/date-range-filter.tsx` | Preset pills + custom date range |
| `ComparisonView` | `components/expenses/comparison-view.tsx` | Month vs month comparison chart + deltas |
| `SpendingTrend` | `components/expenses/spending-trend.tsx` | 12-month area chart |
| `CumulativePaceChart` | `components/expenses/cumulative-pace-chart.tsx` | Daily cumulative line chart |
| `PaymentMethodBreakdown` | `components/expenses/payment-method-breakdown.tsx` | Stacked bar by payment method |

## Components to Modify

| Component | Changes |
|-----------|---------|
| `expense-dialog.tsx` | Add payment method, recurring toggle, image upload |
| `expenses/page.tsx` | Complete restructure: hero + tabs layout, all new sections |

## Types/Constants to Modify

| File | Changes |
|------|---------|
| `lib/utils/types.ts` | Add `PaymentMethod`, `RecurringExpense`, update `ExpenseEntry` |
| `lib/utils/constants.ts` | Add `PAYMENT_METHOD_LABELS`, `PAYMENT_METHOD_COLORS`, `FREQUENCY_LABELS` |

## Hooks to Create

| Hook | Purpose |
|------|---------|
| `useRecurringExpenses` | Wraps `useLocalStorage<RecurringExpense[]>` + generation logic |
| `useDateRange` | Manages date range state with preset support |

---

## Technical Notes

- All new charts use `ReactECharts` with `useMemo`-wrapped options (existing pattern)
- All monetary displays go through `useCurrency().convert()` + `format()` (existing pattern)
- All dates use Sydney timezone via `getSydneyDateString()` (existing pattern)
- Tab state can be managed with the existing `Tabs` component from `components/ui/tabs.tsx`
- No new dependencies needed — everything builds on existing libs (ECharts, base-ui, lucide, motion)
- Image base64 storage is a known localStorage limitation; acceptable until DB migration
