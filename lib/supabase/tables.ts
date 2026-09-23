import { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// Table config — the ONLY place that knows about column naming differences
// between camelCase TypeScript and snake_case PostgreSQL.
// =============================================================================

// Lists and settings live in app_data (see lib/storage/list-change.ts). The
// relational entity tables (income_entries, expense_entries, …) are no longer
// read or written by the app: they were a mirror that went stale whenever a
// phone saved, and the web booting from one erased four income entries on
// 2026-09-23. `snapshots` remains a real table — chart history's source of truth.

// ---------------------------------------------------------------------------
// 1. Snapshot key mapping
// ---------------------------------------------------------------------------

/** Maps useCloudStorage keys → snapshot type values in the unified snapshots table */
export const SNAPSHOT_KEYS: Record<string, string> = {
  portfolio_snapshots: "portfolio",
  crypto_snapshots:    "crypto",
  networth_snapshots:  "networth",
};

// ---------------------------------------------------------------------------
// 2. Case converters
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
// 3. Snapshot sync (used by DataProvider.persist())
// ---------------------------------------------------------------------------

/**
 * APPEND-ONLY sync for snapshots. Snapshots are immutable history, and the
 * client's in-memory copy is frequently a capped/recent SUBSET of the full
 * trail. So we must NEVER delete the server-side rows to "match" the client —
 * doing that (a `delete().eq("type")` then re-insert of the short array) once
 * wiped weeks of history. Instead we read the dates already stored and insert
 * only the genuinely-new ones. The server table is the canonical superset.
 *
 * Returns how many rows were added. Throws when the stored dates can't be read
 * or an insert fails — a restore must not report success it didn't have.
 *
 * (Bulk wipes are handled explicitly elsewhere — Settings → Clear has its own
 * delete path.)
 */
export async function syncSnapshots(
  supabase: SupabaseClient,
  snapshotType: string,
  rows: Record<string, unknown>[]
): Promise<number> {
  if (rows.length === 0) return 0;

  // The dates already stored for this type. Ordered keyset pages: an unordered
  // .range() walk isn't stable, so it could skip dates (→ duplicate inserts).
  const existingDates = new Set<string>();
  const PAGE = 1000;
  for (let cursor: string | null = null; ; ) {
    let query = supabase
      .from("snapshots")
      .select("date")
      .eq("type", snapshotType)
      .order("date", { ascending: true })
      .limit(PAGE);
    if (cursor !== null) query = query.gt("date", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`Couldn't read stored ${snapshotType} snapshots: ${error.message}`);
    const page = (data ?? []) as { date: string }[];
    for (const r of page) existingDates.add(r.date);
    if (page.length === 0) break;
    // Rows sharing the last date on a full page may continue — but only the
    // SET of dates matters here, and that date is already in it.
    cursor = page[page.length - 1].date;
  }

  const insertRows = rows
    .map((row) => {
      // Convert keys to snake_case, strip client-generated id, and inject type
      const snake = rowToSnake(row);
      delete snake["id"];
      snake["type"] = snapshotType;
      return snake;
    })
    .filter((row) => !existingDates.has(row["date"] as string));

  // Request-sized chunks: a full-history restore is tens of thousands of rows.
  for (let i = 0; i < insertRows.length; i += 500) {
    const { error } = await supabase.from("snapshots").insert(insertRows.slice(i, i + 500));
    if (error) throw new Error(`Couldn't add ${snapshotType} snapshots: ${error.message}`);
  }
  return insertRows.length;
}
