import type { SupabaseClient } from "@supabase/supabase-js";
import { SNAPSHOT_KEYS } from "@/lib/supabase/tables";

type SnapshotDbRow = Record<string, unknown> & { id: string; date: string };

/**
 * Every snapshot row of every type, oldest first, keyed by type. Keyset
 * pagination on `date` (deep offsets on this ~100k-row table hit the statement
 * timeout). Throws if any page fails: a backup must be complete or not exist —
 * the old single select silently capped every export at 1000 rows.
 */
export async function fetchAllSnapshots(
  client: SupabaseClient,
  { pageSize = 1000 }: { pageSize?: number } = {},
): Promise<Record<string, SnapshotDbRow[]>> {
  const out: Record<string, SnapshotDbRow[]> = {};
  for (const type of Object.values(SNAPSHOT_KEYS)) {
    const rows: SnapshotDbRow[] = [];
    let cursor: string | null = null;
    for (;;) {
      let query = client
        .from("snapshots")
        .select("*")
        .eq("type", type)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .limit(pageSize);
      if (cursor !== null) query = query.gt("date", cursor);
      const page = await read(query, type);
      // Stop only on an EMPTY page: the server may cap a page below pageSize,
      // so a short page doesn't mean the end.
      if (page.length === 0) break;
      // A page can cut a run of rows sharing its last date (manual snapshots
      // use a bare YYYY-MM-DD) — take that date's rows whole, then continue
      // strictly after it.
      const lastDate = page[page.length - 1].date;
      rows.push(...page.filter((r) => r.date !== lastDate));
      rows.push(
        ...(await read(
          client.from("snapshots").select("*").eq("type", type).eq("date", lastDate).order("id", { ascending: true }),
          type,
        )),
      );
      cursor = lastDate;
    }
    out[type] = rows;
  }
  return out;
}

async function read(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  type: string,
): Promise<SnapshotDbRow[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Couldn't read ${type} snapshots: ${error.message}`);
  return (data ?? []) as SnapshotDbRow[];
}
