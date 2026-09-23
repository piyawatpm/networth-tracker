// =============================================================================
// Compare-and-swap writes of list blobs in app_data.
// =============================================================================
// Read the latest row, apply the change, and write it back ONLY if updated_at
// is still what we read. If another writer got in between, re-read and
// re-apply — their entries survive, ours land on top. See list-change.ts for
// why writers send changes instead of whole lists.

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyChange, type ListChange, type ListItem } from "@/lib/storage/list-change";

export interface KvRow {
  value: string;
  updatedAt: string | null;
}

export interface KvStore {
  /** The row, or null when the key doesn't exist. Throws when the read fails. */
  read(key: string): Promise<KvRow | null>;
  /** Writes only if the row's updated_at still equals `expected`; the new row,
   *  or null when it didn't match. Throws on request failure. */
  compareAndSet(key: string, value: string, expected: string | null): Promise<KvRow | null>;
  /** Creates the key; null when it already exists. Throws on request failure. */
  insert(key: string, value: string): Promise<KvRow | null>;
}

export async function writeListChanges(
  store: KvStore,
  key: string,
  changes: ListChange[],
  { maxAttempts = 5 }: { maxAttempts?: number } = {},
): Promise<KvRow> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const row = await store.read(key); // a failed read throws — nothing is written
    const base = row ? parseList(key, row.value) : [];
    const value = JSON.stringify(changes.reduce(applyChange, base));

    if (row && value === row.value) return row; // already applied
    const written = row
      ? await store.compareAndSet(key, value, row.updatedAt)
      : await store.insert(key, value);
    if (written) return written;
    // Someone else wrote in between: go round again on their version.
  }
  throw new Error(`app_data "${key}": gave up after ${maxAttempts} conflicting writes`);
}

/** app_data through supabase-js (browser client or server service client). */
export function supabaseKvStore(client: SupabaseClient): KvStore {
  const toRow = (r: { value: string; updated_at: string | null }): KvRow => ({
    value: r.value,
    updatedAt: r.updated_at,
  });
  return {
    async read(key) {
      const { data, error } = await client
        .from("app_data")
        .select("value, updated_at")
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(`app_data read "${key}" failed: ${error.message}`);
      return data ? toRow(data) : null;
    },
    async compareAndSet(key, value, expected) {
      const update = client
        .from("app_data")
        .update({ value, updated_at: stampAfter(expected) })
        .eq("key", key);
      const matched = expected === null ? update.is("updated_at", null) : update.eq("updated_at", expected);
      const { data, error } = await matched.select("value, updated_at");
      if (error) throw new Error(`app_data write "${key}" failed: ${error.message}`);
      return data && data.length > 0 ? toRow(data[0]) : null;
    },
    async insert(key, value) {
      const { data, error } = await client
        .from("app_data")
        .insert({ key, value, updated_at: new Date().toISOString() })
        .select("value, updated_at");
      if (error?.code === "23505") return null; // created by someone else first
      if (error) throw new Error(`app_data insert "${key}" failed: ${error.message}`);
      return data && data.length > 0 ? toRow(data[0]) : null;
    },
  };
}

/** Now — or, if this device's clock is behind, just after the version being
 *  replaced. Other devices sync "rows changed since my last stamp"; a write
 *  stamped EARLIER than what they already saw would never reach them. */
function stampAfter(previous: string | null): string {
  const prev = previous ? Date.parse(previous) : NaN;
  const now = Date.now();
  return new Date(Number.isNaN(prev) ? now : Math.max(now, prev + 1)).toISOString();
}

function parseList(key: string, raw: string): ListItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`app_data "${key}" is not valid JSON — refusing to overwrite it`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`app_data "${key}" is not a list — refusing to overwrite it`);
  }
  return parsed as ListItem[];
}
