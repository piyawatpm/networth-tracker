import { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// Table config — the ONLY place that knows about column naming differences
// between camelCase TypeScript and snake_case PostgreSQL.
// =============================================================================

// ---------------------------------------------------------------------------
// 1. Entity table mapping
// ---------------------------------------------------------------------------

export interface EntityTableConfig {
  table: string;
  idField: string; // PK column in snake_case
}

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

// ---------------------------------------------------------------------------
// 2. Snapshot and category key mappings
// ---------------------------------------------------------------------------

/** Maps useCloudStorage keys → snapshot type values in the unified snapshots table */
export const SNAPSHOT_KEYS: Record<string, string> = {
  portfolio_snapshots: "portfolio",
  crypto_snapshots:    "crypto",
  networth_snapshots:  "networth",
};

/** Maps useCloudStorage keys → kind values in custom_categories table */
export const CATEGORY_KEYS: Record<string, string> = {
  custom_income_categories:  "income",
  custom_expense_categories: "expense",
};

// ---------------------------------------------------------------------------
// 3. Case converters
// ---------------------------------------------------------------------------

/** Converts a camelCase key to snake_case. E.g. "createdAt" → "created_at" */
export function camelToSnake(key: string): string {
  return key.replace(/([A-Z])/g, (char) => `_${char.toLowerCase()}`);
}

/** Converts a snake_case key to camelCase. E.g. "created_at" → "createdAt" */
export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

/** Converts all keys in an object from camelCase to snake_case */
export function rowToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [camelToSnake(k), v])
  );
}

/** Converts all keys in an object from snake_case to camelCase */
export function rowToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [snakeToCamel(k), v])
  );
}

// ---------------------------------------------------------------------------
// 4. Sync helpers (used by DataProvider.persist())
// ---------------------------------------------------------------------------

/**
 * Upserts all rows into the entity table (converted to snake_case), then
 * deletes any rows in the DB whose `id` is NOT in the provided set.
 * This handles add/edit/delete in two operations.
 */
export async function syncEntityTable(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  const snakeRows = rows.map(rowToSnake);

  if (snakeRows.length > 0) {
    const { error: upsertError } = await supabase
      .from(table)
      .upsert(snakeRows);

    if (upsertError) {
      console.warn(`[syncEntityTable] upsert failed for "${table}":`, upsertError.message);
      return;
    }

    const ids = snakeRows.map((r) => r["id"] as string);
    const inList = `(${ids.map((id) => `'${id}'`).join(",")})`;

    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .not("id", "in", inList);

    if (deleteError) {
      console.warn(`[syncEntityTable] delete stale rows failed for "${table}":`, deleteError.message);
    }
  } else {
    // Empty array — delete all rows from the table
    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .neq("id", "");

    if (deleteError) {
      console.warn(`[syncEntityTable] delete all rows failed for "${table}":`, deleteError.message);
    }
  }
}

/**
 * APPEND-ONLY sync for snapshots. Snapshots are immutable history, and the
 * client's in-memory copy is frequently a capped/recent SUBSET of the full
 * trail. So we must NEVER delete the server-side rows to "match" the client —
 * doing that (a `delete().eq("type")` then re-insert of the short array) once
 * wiped weeks of history. Instead we read the dates already stored and insert
 * only the genuinely-new ones. The server table is the canonical superset.
 *
 * (Bulk wipes are handled explicitly elsewhere — Settings → Clear has its own
 * delete path; this function is only used by the normal save flow.)
 */
export async function syncSnapshots(
  supabase: SupabaseClient,
  snapshotType: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;

  // Read the dates already stored for this type (paginated — the archive can be
  // large) so we only ever ADD what's missing and never duplicate or delete.
  const existingDates = new Set<unknown>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("snapshots")
      .select("date")
      .eq("type", snapshotType)
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn(`[syncSnapshots] could not read existing dates for "${snapshotType}":`, error.message);
      return; // bail rather than risk inserting duplicates
    }
    if (!data || data.length === 0) break;
    for (const r of data) existingDates.add((r as { date: unknown }).date);
    if (data.length < PAGE) break;
  }

  const insertRows = rows
    .map((row) => {
      // Convert keys to snake_case, strip client-generated id, and inject type
      const snake = rowToSnake(row);
      delete snake["id"];
      snake["type"] = snapshotType;
      return snake;
    })
    .filter((row) => !existingDates.has(row["date"]));

  if (insertRows.length === 0) return;

  const { error: insertError } = await supabase
    .from("snapshots")
    .insert(insertRows);

  if (insertError) {
    console.warn(`[syncSnapshots] insert failed for type "${snapshotType}":`, insertError.message);
  }
}

/**
 * Deletes all categories for the given kind, then inserts the new set.
 * Adds the `kind` field.
 */
export async function syncCategories(
  supabase: SupabaseClient,
  kind: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("custom_categories")
    .delete()
    .eq("kind", kind);

  if (deleteError) {
    console.warn(`[syncCategories] delete failed for kind "${kind}":`, deleteError.message);
    return;
  }

  if (rows.length === 0) return;

  const insertRows = rows.map((row) => {
    const snake = rowToSnake(row);
    snake["kind"] = kind;
    return snake;
  });

  const { error: insertError } = await supabase
    .from("custom_categories")
    .insert(insertRows);

  if (insertError) {
    console.warn(`[syncCategories] insert failed for kind "${kind}":`, insertError.message);
  }
}
