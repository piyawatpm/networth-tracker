// =============================================================================
// Settings → Import: restore what's MISSING from a backup file.
// =============================================================================
// A backup is older than what's stored, so importing it must never replace
// anything: list entries are added only if their id isn't stored, settings and
// ledgers (CSV text, price history, tags) only if the key doesn't exist, and
// snapshot history is appended — never deleted first.

import { LIST_KEYS, keyOf, type ListItem } from "@/lib/storage/list-change";
import { writeListChanges, type KvStore } from "@/lib/storage/kv-cas";
import { SNAPSHOT_KEYS } from "@/lib/supabase/tables";

const PAUSE_ON_RESTORE = new Set(["recurring_income_templates", "recurring_expense_templates"]);

export interface RestoreSummary {
  /** List entries added (their ids weren't stored). */
  entriesAdded: number;
  /** Keys created because they didn't exist. */
  keysAdded: string[];
  /** Keys left alone because a (newer) value is stored. */
  keysKept: string[];
  /** Snapshot rows appended. */
  snapshotsAdded: number;
}

export async function restoreMissing(
  backup: Record<string, unknown>,
  deps: {
    store: KvStore;
    /** Append-only: adds the rows whose dates the table lacks; returns how many. */
    appendSnapshots: (type: string, rows: Record<string, unknown>[]) => Promise<number>;
  },
): Promise<RestoreSummary> {
  const summary: RestoreSummary = { entriesAdded: 0, keysAdded: [], keysKept: [], snapshotsAdded: 0 };

  for (const key of LIST_KEYS) {
    const items = backup[key];
    if (!Array.isArray(items) || items.length === 0) continue;
    const before = await deps.store.read(key);
    const storedIds = new Set(before ? (JSON.parse(before.value) as unknown[]).map(keyOf) : []);
    // A recurring template that's missing was probably deleted on purpose; if
    // it came back active, the cron would back-fill every occurrence since its
    // old lastGeneratedDate. It comes back paused — the user can resume it.
    const inserts = PAUSE_ON_RESTORE.has(key)
      ? (items as ListItem[]).map((t) => ({ ...t, active: false }))
      : (items as ListItem[]);
    await writeListChanges(deps.store, key, [{ upserts: [], deletes: [], inserts }]);
    summary.entriesAdded += (items as ListItem[]).filter((item) => !storedIds.has(keyOf(item))).length;
  }

  for (const [key, type] of Object.entries(SNAPSHOT_KEYS)) {
    const rows = backup[key];
    if (Array.isArray(rows) && rows.length > 0) {
      summary.snapshotsAdded += await deps.appendSnapshots(type, rows as Record<string, unknown>[]);
    }
  }

  for (const [key, value] of Object.entries(backup)) {
    if (LIST_KEYS.has(key) || key in SNAPSHOT_KEYS || key === "cron_log") continue;
    const created = await deps.store.insert(key, JSON.stringify(value));
    (created ? summary.keysAdded : summary.keysKept).push(key);
  }

  return summary;
}
