// =============================================================================
// Initial load for the web app.
// =============================================================================
// app_data is the one store every writer keeps current (web, iOS, Android,
// cron), so every list and setting boots from it. The relational entity tables
// are NOT read: they were a mirror that went stale whenever a phone saved, and
// on 2026-09-23 booting from one made the next web save erase four income
// entries. The only table read here is `snapshots`, which IS the source of
// truth for chart history.

import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToCamel, SNAPSHOT_KEYS } from "@/lib/supabase/tables";
import type { SnapshotRow } from "@/lib/storage/snapshot-cache";
import type { KvRow } from "@/lib/storage/kv-cas";

export interface InitialData {
  /** Every app_data row, with the updated_at a later compare-and-swap needs. */
  kv: Map<string, KvRow>;
  /** Most recent snapshot window per cloud key (portfolio_snapshots, …), oldest first. */
  snapshots: Map<string, SnapshotRow[]>;
}

export async function loadInitialData(
  client: SupabaseClient,
  { attempts = 3, retryDelayMs = 800 }: { attempts?: number; retryDelayMs?: number } = {},
): Promise<InitialData> {
  const [kv, snapshots] = await Promise.all([
    loadKv(client, attempts, retryDelayMs),
    loadRecentSnapshots(client),
  ]);
  return { kv, snapshots };
}

/** Throws when app_data can't be read. Booting an empty account instead would
 *  let the next save write a one-item list over everything. */
async function loadKv(client: SupabaseClient, attempts: number, retryDelayMs: number) {
  let lastError = "no data returned";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { data, error } = await client.from("app_data").select("key, value, updated_at");
    if (!error && data) {
      return new Map<string, KvRow>(
        (data as { key: string; value: string; updated_at: string | null }[]).map((r) => [
          r.key,
          { value: r.value, updatedAt: r.updated_at },
        ]),
      );
    }
    lastError = error?.message ?? lastError;
    if (attempt < attempts - 1 && retryDelayMs > 0) {
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
  throw new Error(`Couldn't load your data (${lastError})`);
}

/** Latest ~1000 snapshot rows so charts paint immediately; the provider
 *  backfills the full history afterwards. A failure here is harmless. */
async function loadRecentSnapshots(client: SupabaseClient): Promise<Map<string, SnapshotRow[]>> {
  const out = new Map<string, SnapshotRow[]>();
  try {
    const { data, error } = await client
      .from("snapshots")
      .select("*")
      .order("date", { ascending: false })
      .limit(1000);
    if (error || !data || data.length === 0) return out;
    // Fetched newest-first to honour the cap; charts want chronological order.
    const asc = (data as Record<string, unknown>[]).slice().reverse().map((r) => rowToCamel(r));
    for (const [key, type] of Object.entries(SNAPSHOT_KEYS)) {
      const rows = asc
        .filter((s) => s.type === type)
        .map((s) => {
          const { id: _id, type: _type, createdAt: _ca, ...rest } = s;
          return rest as SnapshotRow;
        });
      if (rows.length > 0) out.set(key, rows);
    }
  } catch {
    // The background backfill and the KV blob cover it.
  }
  return out;
}
