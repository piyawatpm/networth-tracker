# Income Page Upgrade — Design Spec

**Date:** 2026-04-02
**Goal:** Bring income page to feature parity with expenses page, fixing bugs and adding missing features.

## Layout Structure

Match expenses page tab structure:

### Hero (always visible)
- "This Month's Income" label + animated `NumberTicker`
- Summary tiles in `finance-card`: **This Month | Last Month | Weekly Avg | Monthly Pace**
  - Weekly Avg = `thisMonthTotal / weeksElapsed` (min 1 week)
  - Monthly Pace = `(thisMonthTotal / daysElapsed) * daysInMonth`, color-coded vs last month (green if >10% above, red if >10% below, neutral otherwise) — note: for income, UP is good (green/`text-income`), DOWN is bad (red/`text-expense`), inverse of expenses

### Tab 1: Breakdown (default)
- `DateRangeFilter` component (reuse from expenses): This Month / Last Month / Last 90 Days / YTD / Custom
- Action buttons: "Recurring" (ghost) + "Add Income" (primary)
- Donut chart + progress bars per type (filtered by active date range)
- Savings summary line: "Earned A$X — Spent A$Y — Saved A$Z (N%)" using expense entries for the same date range. Only shows when expense data exists.

### Tab 2: Records
- Search bar: filters on `description`, `notes`, `source` (case-insensitive)
- Type filter pills (from types present in data)
- Sortable columns: click Date or Amount header to toggle asc/desc
- Pagination: 20 entries per page, prev/next controls
- Table columns: Date | Type (with recurring icon) | Source | Description | Amount | Currency | Actions
- Notes: shown as a muted line below description when present (no separate column)

### Tab 3: Trends & Insights
- `IncomeTrend`: 12-month bar/area chart with "By Category" toggle (total line vs stacked area by top 5 types + Other)
- `CumulativePaceChart`: day-by-day current month vs last month cumulative line chart
- `ComparisonView`: two month selectors, grouped bar chart by category, % change badges

## Bug Fixes

1. **Type select display**: `SelectValue` must render `INCOME_TYPE_LABELS[value]` not raw key
2. **Form validation feedback**: disable save button when invalid + show red border on empty required fields
3. **Delete dialog auto-close**: wrap `onConfirm` to programmatically close dialog after deletion
4. **Remove commented-out code**: BlurFade wrapper (lines 267, 321), shouldSetOption (line 281)
5. **Notes visibility**: show below description in records table when non-empty

## Data Model Changes

### Updated `IncomeEntry`
```typescript
interface IncomeEntry {
  id: string;
  type: IncomeType;
  description: string;
  amount: number;
  currency: Currency;
  date: string;
  source: string;        // NEW — employer name, platform, etc.
  notes: string;
  isRecurring?: boolean;  // NEW
  recurringId?: string;   // NEW
  createdAt: number;
}
```

### New `RecurringIncome`
```typescript
interface RecurringIncome {
  id: string;
  type: IncomeType;
  description: string;
  amount: number;
  currency: Currency;
  source: string;
  notes: string;
  frequency: "weekly" | "fortnightly" | "monthly" | "yearly";
  startDate: string;
  endDate?: string;
  lastGeneratedDate: string;
  active: boolean;
  createdAt: number;
}
```

### `normalizeIncomeEntry()`
Forward-compat migration: fills defaults for `source: ""`, `isRecurring: false`, `recurringId: undefined` on entries missing these fields.

## Recurring Income Engine

Mirror `use-recurring-expenses.ts`:
- New hook: `useRecurringIncome(entries, setEntries, recurringTemplates, setRecurringTemplates)`
- Auto-generates entries on mount using `computeOccurrences` (already exists in timezone.ts)
- Deduplicates by `recurringId` + date match
- Guard against double-execution with `useRef`

## New Components

| Component | Based on |
|---|---|
| `components/income/income-trend.tsx` | `components/expenses/spending-trend.tsx` |
| `components/income/cumulative-pace-chart.tsx` | `components/expenses/cumulative-pace-chart.tsx` |
| `components/income/comparison-view.tsx` | `components/expenses/comparison-view.tsx` |
| `components/income/recurring-dialog.tsx` | `components/expenses/recurring-dialog.tsx` |
| `hooks/use-recurring-income.ts` | `hooks/use-recurring-expenses.ts` |

## Reused Components (no changes needed)
- `DateRangeFilter` — already generic, works with any date-filterable data
- `BlurFade`, `NumberTicker` — already used
- `Dialog`, `Select`, `Input`, `Button` — base-ui primitives

## Constants Updates
- Add `INCOME_TYPE_LABELS` entries for any missing display names (already complete with 13 types)
- Verify `INCOME_TYPE_COLORS` coverage (already complete)

## Filter/Chart Consistency Fix
- Filter pills in Records tab derive `typesPresent` from **filtered** entries (matching current tab view), not all-time entries
- Breakdown donut responds to the active date range, not just current month
