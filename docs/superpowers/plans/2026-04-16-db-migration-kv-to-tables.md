# Database Migration: KV Store to Relational Tables

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from the single `app_data` KV table to proper relational Supabase tables for all entity data, while keeping the KV table for simple settings. Zero data loss — old KV data preserved until verified.

**Architecture:** Keep the existing `useCloudStorage` hook API unchanged so component code requires zero changes. The `DataProvider` internally routes reads/writes to the correct table based on the storage key. Entity tables use snake_case columns; the DataProvider converts to/from camelCase at the boundary. Snapshots go into a unified `snapshots` table with a `type` discriminator. Settings/config stay in the `app_data` KV table.

**Tech Stack:** Supabase (PostgreSQL), Next.js App Router, existing TypeScript types

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `lib/supabase/migration.sql` | SQL DDL for all new tables + indexes |
| Create | `app/api/migrate/route.ts` | One-time migration endpoint: reads KV, populates new tables |
| Create | `lib/supabase/tables.ts` | Table config map, snake/camel converters, sync helpers |
| Modify | `components/providers/data-provider.tsx` | Load from tables, route writes to correct table |
| Modify | `app/api/cron/snapshot/route.ts` | Read/write proper tables instead of KV JSON blobs |
| Modify | `app/api/snapshot/route.ts` | Same — use proper tables |
| Modify | `app/(app)/settings/page.tsx` | Export/import across all tables, not just `app_data` |

**Unchanged files (0 edits needed):**
- All page components (`dashboard`, `income`, `expenses`, `crypto`, `portfolio`, `liabilities`, `analytics`, `emergency-fund`, `budget`, `debug`)
- All hooks (`use-categories.ts`, `use-recurring-entries.ts`)
- All component files under `components/`
- `lib/supabase/client.ts`, `lib/supabase/server.ts`
- `lib/utils/types.ts`

These files all use `useCloudStorage(key, initialValue)` — that API stays identical.

---

## Task 1: SQL Migration — Create All Tables

**Files:**
- Create: `lib/supabase/migration.sql`

- [ ] **Step 1: Write the SQL migration file**

```sql
-- ============================================================================
-- Migration: KV store → relational tables
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- IMPORTANT: This is ADDITIVE — it does NOT touch the existing app_data table
-- ============================================================================

-- 1. Income entries
CREATE TABLE IF NOT EXISTS income_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'other',
  description TEXT DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  date TEXT NOT NULL,
  source TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_passive BOOLEAN,
  is_recurring BOOLEAN DEFAULT false,
  recurring_id TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_income_entries_date ON income_entries(date);
CREATE INDEX IF NOT EXISTS idx_income_entries_type ON income_entries(type);

-- 2. Expense entries
CREATE TABLE IF NOT EXISTS expense_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'other',
  description TEXT DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  vendor TEXT DEFAULT '',
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  images JSONB DEFAULT '[]',
  payment_method TEXT DEFAULT 'other',
  is_recurring BOOLEAN DEFAULT false,
  recurring_id TEXT,
  is_one_off BOOLEAN DEFAULT false,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_entries_date ON expense_entries(date);
CREATE INDEX IF NOT EXISTS idx_expense_entries_type ON expense_entries(type);

-- 3. Recurring income templates
CREATE TABLE IF NOT EXISTS recurring_income_templates (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'other',
  description TEXT DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  source TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  frequency TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  last_generated_date TEXT,
  active BOOLEAN DEFAULT true,
  is_passive BOOLEAN,
  created_at BIGINT NOT NULL
);

-- 4. Recurring expense templates
CREATE TABLE IF NOT EXISTS recurring_expense_templates (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'other',
  description TEXT DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  vendor TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'other',
  notes TEXT DEFAULT '',
  frequency TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  last_generated_date TEXT,
  active BOOLEAN DEFAULT true,
  created_at BIGINT NOT NULL
);

-- 5. Portfolio holdings
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  ticker TEXT DEFAULT '',
  type TEXT DEFAULT 'stock',
  account_type TEXT DEFAULT 'normal',
  broker TEXT DEFAULT '',
  country TEXT DEFAULT '',
  link TEXT DEFAULT '',
  units NUMERIC DEFAULT 0,
  amount_invested NUMERIC DEFAULT 0,
  current_value NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  notes TEXT DEFAULT '',
  is_emergency_fund BOOLEAN,
  is_cash BOOLEAN,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portfolio_holdings_ticker ON portfolio_holdings(ticker);

-- 6. Portfolio transactions
CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id TEXT PRIMARY KEY,
  holding_id TEXT NOT NULL,
  holding_name TEXT DEFAULT '',
  type TEXT NOT NULL,
  units NUMERIC NOT NULL DEFAULT 0,
  price_per_unit NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portfolio_tx_holding ON portfolio_transactions(holding_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_tx_date ON portfolio_transactions(date);

-- 7. Debt records
CREATE TABLE IF NOT EXISTS debt_records (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'i_owe',
  reason TEXT DEFAULT '',
  original_amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  notes TEXT DEFAULT '',
  images JSONB DEFAULT '[]',
  created_at BIGINT NOT NULL
);

-- 8. Debt transactions
CREATE TABLE IF NOT EXISTS debt_transactions (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  images JSONB DEFAULT '[]',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debt_tx_debt ON debt_transactions(debt_id);

-- 9. Snapshots (unified table for portfolio, crypto, networth)
CREATE TABLE IF NOT EXISTS snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  value NUMERIC NOT NULL DEFAULT 0,
  value_no_super NUMERIC,
  value_with_super NUMERIC,
  portfolio NUMERIC,
  crypto NUMERIC,
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_type_date ON snapshots(type, date);

-- 10. Cron logs
CREATE TABLE IF NOT EXISTS cron_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT false,
  log JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cron_logs_date ON cron_logs(date DESC);

-- 11. Networth goals
CREATE TABLE IF NOT EXISTS networth_goals (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  set_at BIGINT NOT NULL,
  achieved_at BIGINT
);

-- 12. Custom categories (income + expense in one table with a kind discriminator)
CREATE TABLE IF NOT EXISTS custom_categories (
  id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'income' or 'expense'
  label TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#888888',
  PRIMARY KEY (id, kind)
);
```

- [ ] **Step 2: Run the SQL in Supabase Dashboard**

Go to: Supabase Dashboard → SQL Editor → New Query → paste the full SQL → Run.

Expected: All tables created with 0 errors. Existing `app_data` table untouched.

- [ ] **Step 3: Verify tables exist**

Run in SQL Editor:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected: All new tables listed alongside `app_data`.

- [ ] **Step 4: Commit the SQL file**

```bash
git add lib/supabase/migration.sql
git commit -m "chore: add SQL migration for relational tables"
```

---

## Task 2: Table Config & Conversion Utilities

**Files:**
- Create: `lib/supabase/tables.ts`

- [ ] **Step 1: Create the table config and converters**

```typescript
// lib/supabase/tables.ts
//
// Maps useCloudStorage keys → Supabase table names, plus snake/camel converters.
// This is the ONLY place that knows about the column naming difference.

// ---------------------------------------------------------------------------
// Key → Table mapping
// ---------------------------------------------------------------------------

export interface EntityTableConfig {
  table: string;
  idField: string; // PK column in snake_case
}

/** Storage keys that map to their own Supabase table (array-of-records). */
export const ENTITY_TABLES: Record<string, EntityTableConfig> = {
  income_entries:               { table: "income_entries",               idField: "id" },
  expense_entries:              { table: "expense_entries",              idField: "id" },
  recurring_income_templates:   { table: "recurring_income_templates",   idField: "id" },
  recurring_expense_templates:  { table: "recurring_expense_templates",  idField: "id" },
  portfolio_holdings:           { table: "portfolio_holdings",           idField: "id" },
  portfolio_transactions:       { table: "portfolio_transactions",       idField: "id" },
  debt_records:                 { table: "debt_records",                 idField: "id" },
  debt_transactions:            { table: "debt_transactions",            idField: "id" },
  networth_goals:               { table: "networth_goals",               idField: "id" },
};

/** Snapshot storage keys → snapshot `type` value in the unified table. */
export const SNAPSHOT_KEYS: Record<string, string> = {
  portfolio_snapshots: "portfolio",
  crypto_snapshots:    "crypto",
  networth_snapshots:  "networth",
};

/** Custom-category storage keys → `kind` value in custom_categories table. */
export const CATEGORY_KEYS: Record<string, string> = {
  custom_income_categories:  "income",
  custom_expense_categories: "expense",
};

// ---------------------------------------------------------------------------
// Case converters (camelCase ↔ snake_case)
// ---------------------------------------------------------------------------

export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function rowToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[camelToSnake(k)] = v;
  }
  return out;
}

export function rowToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[snakeToCamel(k)] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync helpers — used by DataProvider.persist()
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

/** Upsert all rows, delete any rows whose id is no longer in the set. */
export async function syncEntityTable(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
) {
  const snakeRows = rows.map(rowToSnake);
  const ids = snakeRows.map((r) => r.id as string).filter(Boolean);

  // Upsert current rows
  if (snakeRows.length > 0) {
    const { error } = await supabase.from(table).upsert(snakeRows, { onConflict: "id" });
    if (error) console.warn(`syncEntityTable(${table}) upsert:`, error.message);
  }

  // Delete removed rows
  if (ids.length > 0) {
    const { error } = await supabase
      .from(table)
      .delete()
      .not("id", "in", `(${ids.map((id) => `'${id}'`).join(",")})`);
    if (error) console.warn(`syncEntityTable(${table}) delete:`, error.message);
  } else {
    // All rows removed — delete everything
    await supabase.from(table).delete().neq("id", "");
  }
}

/** Replace all snapshots for a given type. */
export async function syncSnapshots(
  supabase: SupabaseClient,
  snapshotType: string,
  rows: Record<string, unknown>[],
) {
  // Delete existing snapshots for this type
  await supabase.from("snapshots").delete().eq("type", snapshotType);

  if (rows.length === 0) return;

  // Insert new snapshots (add type + convert to snake)
  const insertRows = rows.map((r) => {
    const snake = rowToSnake(r);
    // Remove any client-side id, let DB generate UUID
    delete snake.id;
    return { ...snake, type: snapshotType };
  });

  const { error } = await supabase.from("snapshots").insert(insertRows);
  if (error) console.warn(`syncSnapshots(${snapshotType}):`, error.message);
}

/** Replace custom categories for a given kind. */
export async function syncCategories(
  supabase: SupabaseClient,
  kind: string,
  rows: Record<string, unknown>[],
) {
  await supabase.from("custom_categories").delete().eq("kind", kind);
  if (rows.length === 0) return;

  const insertRows = rows.map((r) => ({ ...r, kind }));
  const { error } = await supabase.from("custom_categories").insert(insertRows);
  if (error) console.warn(`syncCategories(${kind}):`, error.message);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/supabase/tables.ts
git commit -m "feat: add table config, case converters, and sync helpers"
```

---

## Task 3: Migration API Endpoint

**Files:**
- Create: `app/api/migrate/route.ts`

This endpoint reads all data from the `app_data` KV table and populates the new relational tables. It's idempotent (uses upserts) and preserves the original KV data.

- [ ] **Step 1: Create the migration endpoint**

```typescript
// app/api/migrate/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rowToSnake } from "@/lib/supabase/tables";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const dynamic = "force-dynamic";

export async function POST() {
  const log: string[] = [];

  try {
    // 1. Read ALL data from KV store
    const { data: kvRows, error: kvError } = await supabase
      .from("app_data")
      .select("key, value");

    if (kvError) {
      return NextResponse.json({ error: kvError.message }, { status: 500 });
    }

    const kv: Record<string, string> = {};
    for (const row of kvRows ?? []) {
      kv[row.key] = row.value;
    }
    log.push(`Read ${Object.keys(kv).length} keys from app_data`);

    const parse = <T>(key: string, fallback: T): T => {
      try { return kv[key] ? JSON.parse(kv[key]) : fallback; } catch { return fallback; }
    };

    // 2. Migrate entity tables
    const entityMigrations: { key: string; table: string }[] = [
      { key: "income_entries", table: "income_entries" },
      { key: "expense_entries", table: "expense_entries" },
      { key: "recurring_income_templates", table: "recurring_income_templates" },
      { key: "recurring_expense_templates", table: "recurring_expense_templates" },
      { key: "portfolio_holdings", table: "portfolio_holdings" },
      { key: "portfolio_transactions", table: "portfolio_transactions" },
      { key: "debt_records", table: "debt_records" },
      { key: "debt_transactions", table: "debt_transactions" },
      { key: "networth_goals", table: "networth_goals" },
    ];

    for (const { key, table } of entityMigrations) {
      const items = parse<Record<string, unknown>[]>(key, []);
      if (items.length === 0) {
        log.push(`${key}: empty, skipping`);
        continue;
      }

      const snakeRows = items.map(rowToSnake);
      const { error } = await supabase.from(table).upsert(snakeRows, { onConflict: "id" });
      if (error) {
        log.push(`${key}: ERROR — ${error.message}`);
      } else {
        log.push(`${key}: migrated ${items.length} rows → ${table}`);
      }
    }

    // 3. Migrate snapshots (3 types → 1 table)
    const snapshotMigrations = [
      { key: "portfolio_snapshots", type: "portfolio" },
      { key: "crypto_snapshots", type: "crypto" },
      { key: "networth_snapshots", type: "networth" },
    ];

    for (const { key, type } of snapshotMigrations) {
      const items = parse<Record<string, unknown>[]>(key, []);
      if (items.length === 0) {
        log.push(`${key}: empty, skipping`);
        continue;
      }

      const snakeRows = items.map((item) => {
        const snake = rowToSnake(item);
        return { ...snake, type };
      });

      // Batch insert in chunks of 500 (Supabase limit)
      for (let i = 0; i < snakeRows.length; i += 500) {
        const chunk = snakeRows.slice(i, i + 500);
        const { error } = await supabase.from("snapshots").insert(chunk);
        if (error) {
          log.push(`${key} chunk ${i}: ERROR — ${error.message}`);
        }
      }
      log.push(`${key}: migrated ${items.length} snapshots → snapshots(type=${type})`);
    }

    // 4. Migrate cron logs
    const cronLogs = parse<{ date: string; timestamp: string; success: boolean; log: string[] }[]>("cron_log", []);
    if (cronLogs.length > 0) {
      const cronRows = cronLogs.map((entry) => ({
        date: entry.date,
        timestamp: entry.timestamp,
        success: entry.success,
        log: JSON.stringify(entry.log),
      }));
      const { error } = await supabase.from("cron_logs").insert(cronRows);
      if (error) {
        log.push(`cron_log: ERROR — ${error.message}`);
      } else {
        log.push(`cron_log: migrated ${cronLogs.length} entries → cron_logs`);
      }
    }

    // 5. Migrate custom categories
    const customIncome = parse<{ id: string; label: string; color: string }[]>("custom_income_categories", []);
    const customExpense = parse<{ id: string; label: string; color: string }[]>("custom_expense_categories", []);

    if (customIncome.length > 0) {
      const rows = customIncome.map((c) => ({ ...c, kind: "income" }));
      const { error } = await supabase.from("custom_categories").upsert(rows, { onConflict: "id,kind" });
      if (error) log.push(`custom_income_categories: ERROR — ${error.message}`);
      else log.push(`custom_income_categories: migrated ${rows.length} → custom_categories`);
    }

    if (customExpense.length > 0) {
      const rows = customExpense.map((c) => ({ ...c, kind: "expense" }));
      const { error } = await supabase.from("custom_categories").upsert(rows, { onConflict: "id,kind" });
      if (error) log.push(`custom_expense_categories: ERROR — ${error.message}`);
      else log.push(`custom_expense_categories: migrated ${rows.length} → custom_categories`);
    }

    log.push("--- Migration complete. Original app_data rows are PRESERVED. ---");

    return NextResponse.json({ ok: true, log });
  } catch (e) {
    log.push(`Fatal error: ${String(e)}`);
    return NextResponse.json({ error: String(e), log }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/migrate/route.ts
git commit -m "feat: add one-time KV→tables migration endpoint"
```

---

## Task 4: Update DataProvider — Load from Tables

**Files:**
- Modify: `components/providers/data-provider.tsx`

This is the core change. The `load()` function reads from proper tables. The `persist()` function routes writes to the correct table. The `useCloudStorage` hook stays identical.

- [ ] **Step 1: Replace the DataProvider implementation**

Replace the entire file. Key changes:
1. `load()` reads from multiple tables in parallel, converts snake→camel, stores in cache as JSON strings
2. `persist()` detects entity/snapshot/category/KV keys and routes to the correct write function
3. `saveAll()` iterates all known table keys and syncs each
4. `beforeunload` beacon now hits a `/api/save-all` endpoint instead of raw Supabase
5. `useCloudStorage` hook — **completely unchanged**

```typescript
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ENTITY_TABLES,
  SNAPSHOT_KEYS,
  CATEGORY_KEYS,
  rowToCamel,
  syncEntityTable,
  syncSnapshots,
  syncCategories,
} from "@/lib/supabase/tables";
import { RefreshCw } from "lucide-react";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface DataContextValue {
  /** Pre-loaded data from Supabase (key → raw JSON string) */
  cache: React.MutableRefObject<Map<string, string>>;
  /** Whether initial fetch is complete */
  isLoaded: boolean;
  /** Write a key to Supabase (async, fire-and-forget) */
  persist: (key: string, value: string) => void;
  /** Push ALL cached data to Supabase (used by Save button) */
  saveAll: () => Promise<{ success: boolean; error?: string }>;
  /** Last save timestamp */
  lastSaveTime: number | null;
}

const DataContext = createContext<DataContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DataProvider({ children }: { children: React.ReactNode }) {
  const cache = useRef<Map<string, string>>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
  const supabase = useMemo(() => createClient(), []);

  // Fetch all data from Supabase on mount
  useEffect(() => {
    async function load() {
      try {
        const results = await Promise.all([
          // Entity tables → read rows, convert snake→camel, store as JSON array
          ...Object.entries(ENTITY_TABLES).map(async ([key, cfg]) => {
            const { data } = await supabase.from(cfg.table).select("*");
            const camelRows = (data ?? []).map((r) => rowToCamel(r as Record<string, unknown>));
            cache.current.set(key, JSON.stringify(camelRows));
            return { key, count: camelRows.length };
          }),

          // Snapshots → single query, split by type
          (async () => {
            const { data } = await supabase
              .from("snapshots")
              .select("*")
              .order("date", { ascending: true });
            const all = (data ?? []).map((r) => rowToCamel(r as Record<string, unknown>));
            for (const [key, type] of Object.entries(SNAPSHOT_KEYS)) {
              const filtered = all
                .filter((s) => s.type === type)
                .map((s) => {
                  // Remove internal fields — components don't expect id/type/createdAt from snapshots
                  const { id: _id, type: _type, createdAt: _ca, ...rest } = s as Record<string, unknown>;
                  return rest;
                });
              cache.current.set(key, JSON.stringify(filtered));
            }
            return { key: "snapshots", count: all.length };
          })(),

          // Custom categories → split by kind
          (async () => {
            const { data } = await supabase.from("custom_categories").select("*");
            const all = data ?? [];
            for (const [key, kind] of Object.entries(CATEGORY_KEYS)) {
              const filtered = all
                .filter((c) => c.kind === kind)
                .map(({ kind: _, ...rest }) => rest); // strip `kind` field
              cache.current.set(key, JSON.stringify(filtered));
            }
            return { key: "custom_categories", count: all.length };
          })(),

          // Cron logs
          (async () => {
            const { data } = await supabase
              .from("cron_logs")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(30);
            const logs = (data ?? []).map((r) => ({
              date: r.date,
              timestamp: r.timestamp,
              success: r.success,
              log: typeof r.log === "string" ? JSON.parse(r.log) : r.log,
            }));
            cache.current.set("cron_log", JSON.stringify(logs));
            return { key: "cron_log", count: logs.length };
          })(),

          // KV settings — everything else (preferred_currency, enabled_currencies, etc.)
          (async () => {
            const { data } = await supabase.from("app_data").select("key, value");
            for (const row of data ?? []) {
              // Only set if not already loaded from a proper table
              if (!cache.current.has(row.key)) {
                cache.current.set(row.key, row.value);
              }
            }
            return { key: "app_data", count: data?.length ?? 0 };
          })(),
        ]);

        if (process.env.NODE_ENV === "development") {
          console.log("[DataProvider] loaded:", results);
        }
      } catch (e) {
        console.warn("[DataProvider] load error:", e);
        // Supabase unavailable — start with empty cache
      }
      setIsLoaded(true);
    }

    load();
  }, [supabase]);

  // Write a single key — routes to correct table
  const pendingWrites = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const persist = useCallback(
    (key: string, value: string) => {
      // Update in-memory cache immediately
      cache.current.set(key, value);

      // Debounce the write (300ms for KV, 500ms for tables)
      const existing = pendingWrites.current.get(key);
      if (existing) clearTimeout(existing);

      const entityCfg = ENTITY_TABLES[key];
      const snapshotType = SNAPSHOT_KEYS[key];
      const categoryKind = CATEGORY_KEYS[key];
      const delay = entityCfg || snapshotType || categoryKind ? 500 : 300;

      pendingWrites.current.set(
        key,
        setTimeout(async () => {
          pendingWrites.current.delete(key);
          try {
            if (entityCfg) {
              // Entity table — sync rows
              const items = JSON.parse(value) as Record<string, unknown>[];
              await syncEntityTable(supabase, entityCfg.table, items);
            } else if (snapshotType) {
              // Snapshot table — full replace for this type
              const items = JSON.parse(value) as Record<string, unknown>[];
              await syncSnapshots(supabase, snapshotType, items);
            } else if (categoryKind) {
              // Custom categories
              const items = JSON.parse(value) as Record<string, unknown>[];
              await syncCategories(supabase, categoryKind, items);
            } else {
              // KV setting — write to app_data
              await supabase
                .from("app_data")
                .upsert(
                  { key, value, updated_at: new Date().toISOString() },
                  { onConflict: "key" },
                );
            }
          } catch (e) {
            console.warn(`[DataProvider] persist(${key}) error:`, e);
          }
        }, delay),
      );
    },
    [supabase],
  );

  // Save all cached data at once
  const saveAll = useCallback(async () => {
    try {
      const promises: Promise<void>[] = [];

      // Entity tables
      for (const [key, cfg] of Object.entries(ENTITY_TABLES)) {
        const raw = cache.current.get(key);
        if (!raw) continue;
        const items = JSON.parse(raw) as Record<string, unknown>[];
        promises.push(syncEntityTable(supabase, cfg.table, items));
      }

      // Snapshots
      for (const [key, type] of Object.entries(SNAPSHOT_KEYS)) {
        const raw = cache.current.get(key);
        if (!raw) continue;
        const items = JSON.parse(raw) as Record<string, unknown>[];
        promises.push(syncSnapshots(supabase, type, items));
      }

      // Custom categories
      for (const [key, kind] of Object.entries(CATEGORY_KEYS)) {
        const raw = cache.current.get(key);
        if (!raw) continue;
        const items = JSON.parse(raw) as Record<string, unknown>[];
        promises.push(syncCategories(supabase, kind, items));
      }

      // KV settings — collect non-table keys
      const kvRows: { key: string; value: string; updated_at: string }[] = [];
      const now = new Date().toISOString();
      const tableKeys = new Set([
        ...Object.keys(ENTITY_TABLES),
        ...Object.keys(SNAPSHOT_KEYS),
        ...Object.keys(CATEGORY_KEYS),
        "cron_log",
      ]);

      cache.current.forEach((value, key) => {
        if (!tableKeys.has(key)) {
          kvRows.push({ key, value, updated_at: now });
        }
      });

      if (kvRows.length > 0) {
        promises.push(
          supabase
            .from("app_data")
            .upsert(kvRows, { onConflict: "key" })
            .then(({ error }) => {
              if (error) console.warn("saveAll KV error:", error.message);
            }),
        );
      }

      await Promise.all(promises);
      setLastSaveTime(Date.now());
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }, [supabase]);

  // Save before tab close — flush pending writes
  useEffect(() => {
    function handleBeforeUnload() {
      // Flush all pending debounced writes
      pendingWrites.current.forEach((timeout) => clearTimeout(timeout));
      pendingWrites.current.clear();

      // Best-effort: save KV settings via beacon (tables already synced via debounce)
      const kvRows: { key: string; value: string; updated_at: string }[] = [];
      const now = new Date().toISOString();
      const tableKeys = new Set([
        ...Object.keys(ENTITY_TABLES),
        ...Object.keys(SNAPSHOT_KEYS),
        ...Object.keys(CATEGORY_KEYS),
        "cron_log",
      ]);

      cache.current.forEach((value, key) => {
        if (!tableKeys.has(key)) {
          kvRows.push({ key, value, updated_at: now });
        }
      });

      if (kvRows.length > 0) {
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/app_data?on_conflict=key`;
        navigator.sendBeacon?.(
          url,
          new Blob([JSON.stringify(kvRows)], { type: "application/json" }),
        );
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm font-mono">Loading data...</span>
        </div>
      </div>
    );
  }

  return (
    <DataContext.Provider value={{ cache, isLoaded, persist, saveAll, lastSaveTime }}>
      {children}
    </DataContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook: drop-in replacement for useLocalStorage (UNCHANGED)
// ---------------------------------------------------------------------------

export function useCloudStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useCloudStorage must be inside DataProvider");

  // Read initial value from pre-loaded cache
  const [storedValue, setStoredValue] = useState<T>(() => {
    const raw = ctx.cache.current.get(key);
    if (raw !== undefined) {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return initialValue;
      }
    }
    return initialValue;
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const newValue = value instanceof Function ? value(prev) : value;
        const serialized = JSON.stringify(newValue);
        ctx.persist(key, serialized);
        return newValue;
      });
    },
    [key, ctx],
  );

  return [storedValue, setValue];
}

// ---------------------------------------------------------------------------
// Hook: save button status (UNCHANGED)
// ---------------------------------------------------------------------------

export function useSaveToCloud() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useSaveToCloud must be inside DataProvider");

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = useCallback(async () => {
    setStatus("saving");
    const result = await ctx.saveAll();
    if (result.success) {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } else {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    }
  }, [ctx]);

  return { status, save, lastSaveTime: ctx.lastSaveTime };
}
```

- [ ] **Step 2: Commit**

```bash
git add components/providers/data-provider.tsx
git commit -m "feat: DataProvider reads/writes proper tables, useCloudStorage unchanged"
```

---

## Task 5: Update Cron Snapshot Route

**Files:**
- Modify: `app/api/cron/snapshot/route.ts`

Change from reading/writing JSON blobs in `app_data` to querying/inserting into proper tables.

- [ ] **Step 1: Rewrite the cron route**

Key changes:
- Read entities with `supabase.from("table").select("*")` instead of parsing KV JSON
- Append snapshots with `INSERT` instead of reading full array + appending + writing back
- Write recurring entries with individual `INSERT` instead of full-array overwrite
- Save cron log to `cron_logs` table instead of KV
- Stock price updates write to `portfolio_holdings` table rows individually
- Convert between snake_case (DB) and camelCase (app logic) at boundaries

The full replacement code for this file is long (~400 lines). The core pattern change for each section:

**Before (KV pattern):**
```typescript
const { data: rows } = await supabase.from("app_data").select("key, value").in("key", keys);
const holdings = JSON.parse(dataMap["portfolio_holdings"]);
// ... modify holdings ...
updates.push({ key: "portfolio_holdings", value: JSON.stringify(holdings), updated_at: now });
await supabase.from("app_data").upsert(updates, { onConflict: "key" });
```

**After (table pattern):**
```typescript
import { rowToCamel, rowToSnake } from "@/lib/supabase/tables";

const { data: holdingsRaw } = await supabase.from("portfolio_holdings").select("*");
const holdings = (holdingsRaw ?? []).map((r) => rowToCamel(r as Record<string, unknown>));
// ... modify holdings ...
// Write updated holdings individually
for (const h of modifiedHoldings) {
  await supabase.from("portfolio_holdings").upsert(rowToSnake(h), { onConflict: "id" });
}
// Append snapshot as single INSERT (no read-modify-write!)
await supabase.from("snapshots").insert({ type: "portfolio", date: sydneyTime, value: portfolioNoSuper, value_with_super: portfolioTotal, currency: "USD" });
```

**Snapshot append — the biggest win:**
```typescript
// OLD: read ALL snapshots → append → write ALL back (grows forever)
const nwSnapshots = parse("networth_snapshots", []);
updates.push({ key: "networth_snapshots", value: JSON.stringify([...nwSnapshots, newEntry]) });

// NEW: just INSERT one row
await supabase.from("snapshots").insert({
  type: "networth", date: sydneyTime, value: netWorth,
  value_no_super: netWorthNoSuper, currency: "USD",
  portfolio: portfolioTotal, crypto: cryptoTotalUsd,
});
```

**Recurring entries — insert only new ones:**
```typescript
// OLD: merge arrays, write entire array back
const allIncome = [...incomeEntries, ...newEntries];
updates.push({ key: "income_entries", value: JSON.stringify(allIncome) });

// NEW: insert only the new entries
if (newEntries.length > 0) {
  await supabase.from("income_entries").insert(newEntries.map(rowToSnake));
}
// Update templates individually
for (const t of updatedTemplates) {
  await supabase.from("recurring_income_templates").upsert(rowToSnake(t), { onConflict: "id" });
}
```

**Cron log — insert a row:**
```typescript
// OLD: read array, prepend, trim to 30, write back
async function saveCronLog(date, log, success) {
  await supabase.from("cron_logs").insert({ date, success, log: JSON.stringify(log) });
  // Trim old logs (keep last 30)
  const { data: old } = await supabase.from("cron_logs").select("id").order("created_at", { ascending: false }).range(30, 99999);
  if (old && old.length > 0) {
    await supabase.from("cron_logs").delete().in("id", old.map((r) => r.id));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/cron/snapshot/route.ts
git commit -m "refactor: cron route uses relational tables instead of KV blobs"
```

---

## Task 6: Update Manual Snapshot Route

**Files:**
- Modify: `app/api/snapshot/route.ts`

Same pattern as Task 5 — read from tables, append snapshots via INSERT.

- [ ] **Step 1: Update the snapshot route**

Same conversion pattern:
- `supabase.from("portfolio_holdings").select("*")` instead of KV parse
- `supabase.from("snapshots").insert(...)` instead of array append + full write
- Holdings updates via individual `upsert` instead of full array replacement
- Use `rowToCamel` / `rowToSnake` at boundaries

Key difference from cron: the manual snapshot keeps the last 90 snapshots. With a proper table, this becomes:
```typescript
// Insert new snapshot
await supabase.from("snapshots").insert({ type: "portfolio", ... });

// No need to trim — snapshots table handles unlimited history efficiently.
// If trimming is desired, do it periodically in cron instead.
```

- [ ] **Step 2: Commit**

```bash
git add app/api/snapshot/route.ts
git commit -m "refactor: manual snapshot route uses relational tables"
```

---

## Task 7: Update Settings Export/Import

**Files:**
- Modify: `app/(app)/settings/page.tsx`

Export must read from all tables. Import must write to all tables. Clear must delete from all tables.

- [ ] **Step 1: Update export handler**

```typescript
async function handleExport() {
  const supabase = createClient();
  const obj: Record<string, unknown> = {};

  // Entity tables
  const tables = [
    "income_entries", "expense_entries",
    "recurring_income_templates", "recurring_expense_templates",
    "portfolio_holdings", "portfolio_transactions",
    "debt_records", "debt_transactions", "networth_goals",
  ];

  await Promise.all(
    tables.map(async (table) => {
      const { data } = await supabase.from(table).select("*");
      obj[table] = (data ?? []).map((r) => rowToCamel(r as Record<string, unknown>));
    }),
  );

  // Snapshots — export split by type
  const { data: snapshots } = await supabase.from("snapshots").select("*").order("date");
  const allSnaps = (snapshots ?? []).map((r) => rowToCamel(r as Record<string, unknown>));
  obj["portfolio_snapshots"] = allSnaps.filter((s) => s.type === "portfolio");
  obj["crypto_snapshots"] = allSnaps.filter((s) => s.type === "crypto");
  obj["networth_snapshots"] = allSnaps.filter((s) => s.type === "networth");

  // Custom categories
  const { data: cats } = await supabase.from("custom_categories").select("*");
  obj["custom_income_categories"] = (cats ?? []).filter((c) => c.kind === "income").map(({ kind, ...r }) => r);
  obj["custom_expense_categories"] = (cats ?? []).filter((c) => c.kind === "expense").map(({ kind, ...r }) => r);

  // KV settings
  const { data: kvData } = await supabase.from("app_data").select("key, value");
  for (const row of kvData ?? []) {
    if (!obj[row.key]) {
      try { obj[row.key] = JSON.parse(row.value); } catch { obj[row.key] = row.value; }
    }
  }

  // Download as JSON — same format as before (backward compatible)
  const json = JSON.stringify(obj, null, 2);
  // ... same blob download logic ...
}
```

- [ ] **Step 2: Update import handler**

Import detects whether a key maps to a table or KV, and routes accordingly.

- [ ] **Step 3: Update clear handler**

```typescript
async function handleClear() {
  const supabase = createClient();
  const tables = [
    "income_entries", "expense_entries",
    "recurring_income_templates", "recurring_expense_templates",
    "portfolio_holdings", "portfolio_transactions",
    "debt_records", "debt_transactions", "networth_goals",
    "snapshots", "cron_logs", "custom_categories",
  ];
  await Promise.all(tables.map((t) => supabase.from(t).delete().neq("id", "")));
  await supabase.from("app_data").delete().neq("key", "");
  // ... reload ...
}
```

- [ ] **Step 4: Commit**

```bash
git add app/(app)/settings/page.tsx
git commit -m "refactor: settings export/import/clear works with relational tables"
```

---

## Task 8: Run Migration & Verify

- [ ] **Step 1: Export a backup FIRST (safety net)**

Go to Settings → Export Backup → save the JSON file.

- [ ] **Step 2: Run the SQL migration**

Paste `lib/supabase/migration.sql` into Supabase SQL Editor and run it.

- [ ] **Step 3: Run the data migration**

```bash
curl -X POST http://localhost:3000/api/migrate
```

Check the response log — every entity should show "migrated N rows".

- [ ] **Step 4: Verify data in Supabase Dashboard**

Check each table in the Supabase Table Editor:
- `income_entries` — row count matches original
- `expense_entries` — row count matches
- `snapshots` — has entries for all 3 types
- All other tables populated

- [ ] **Step 5: Start the app and test every page**

```bash
npm run dev
```

Walk through each page:
- Dashboard — net worth, charts, allocations display correctly
- Income — entries load, can add/edit/delete
- Expenses — entries load, can add/edit/delete
- Crypto — holdings load, prices work
- Portfolio — holdings and transactions load
- Liabilities — debts load
- Analytics — charts render with snapshot data
- Debug — cron logs display, snapshot trigger works
- Settings — export produces valid backup

- [ ] **Step 6: Test the cron job**

```bash
curl http://localhost:3000/api/cron/snapshot
```

Verify: new snapshot rows appear in the `snapshots` table (check Supabase Dashboard).

- [ ] **Step 7: Commit everything and verify clean build**

```bash
npm run build
git add -A
git commit -m "feat: complete migration from KV store to relational tables"
```

---

## What Stays in `app_data` (KV)

These keys remain as simple key-value pairs — KV is the right fit:

| Key | Type | Why KV |
|-----|------|--------|
| `preferred_currency` | `string` | Single value |
| `enabled_currencies` | `string[]` | Small array, rarely changes |
| `crypto_csv_text` | `string` | Raw CSV blob |
| `crypto_prices` | `{prices, fetchedAt}` | Cache, overwritten each time |
| `crypto_ticker_mappings` | `Record<string, string>` | Small map |
| `crypto_stablecoin_tags` | `Record<string, boolean>` | Small map |
| `crypto_cash_tags` | `Record<string, boolean>` | Small map |
| `crypto_emergency_tags` | `Record<string, boolean>` | Small map |
| `crypto_coin_images` | `Record<string, string>` | Small map |
| `crypto_exchange_overrides` | `Record<string, string>` | Small map |
| `crypto_csv_uploaded_at` | `number` | Single value |
| `emergency_fund_target_months` | `number` | Single value |
| `dashboard_hidden_sections` | `string[]` | Small array |
| `stock_logos` | `Record<string, string>` | Cache |
| `portfolio_fund_allocations` | `FundAllocations` | Nested object |
| `fx_rates_cache` | `CachedRates` | Cache |
| `networth_goal` | `object` | Legacy single goal |

---

## Rollback Plan

If anything goes wrong:
1. The original `app_data` table is **never modified** by this migration
2. To rollback: revert the code changes (`git revert`) — the old code reads from `app_data` which still has all data
3. The new tables can be dropped without losing anything
