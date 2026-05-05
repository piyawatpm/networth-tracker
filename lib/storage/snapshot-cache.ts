// =============================================================================
// Snapshot localStorage cache
// =============================================================================
//
// WHY THIS FILE EXISTS
// --------------------
// The `snapshots` table is by far our heaviest read on app boot. It holds one
// row per day per snapshot type (portfolio / crypto / networth), and grows
// forever — after a couple of years that's a few thousand rows. With the
// project's PostgREST `max_rows` cap effectively returning ~100 rows per
// request, fetching the whole table on every page load means ~20+ sequential
// REST calls before the UI is usable.
//
// Snapshots are **immutable historical records** — once a date's row is
// written, nothing edits it (the cron / manual button only ever appends a new
// day). That makes them a perfect fit for a client-side cache: on subsequent
// page loads we only need to fetch rows NEWER than what we already have,
// turning ~20 paginated calls into one tiny `where date > maxCachedDate` call.
//
// CACHE SHAPE
// -----------
// The cache mirrors the in-memory `cache.current` Map's shape exactly, so the
// data-provider can hand it straight back to consumers without any reshaping:
//
//   {
//     portfolio_snapshots: [{ date, value, ... }, ...],
//     crypto_snapshots:    [{ date, value, ... }, ...],
//     networth_snapshots:  [{ date, value, ... }, ...],
//   }
//
// Rows are stored WITHOUT the DB-only fields (`id`, `type`, `createdAt`),
// matching what `useCloudStorage("portfolio_snapshots", …)` consumers expect.
//
// INVALIDATION
// ------------
// The cache stays valid as long as the server only ever appends. Anything
// destructive (Settings → Clear, Settings → Import which does delete+insert)
// must call `clearSnapshotCache()` so the next load does a full re-fetch.
// Normal writes (new daily snapshot, manual snapshot, edit via persist()) are
// kept in sync by the data-provider — see `setSnapshotCacheKey`.
//
// =============================================================================

/** Bumped whenever the on-disk shape changes — old caches are ignored on read. */
const STORAGE_KEY = "snapshot_cache_v1";

/** Single snapshot row, stored opaquely. Keys vary by type (e.g. portfolio
 *  has `valueWithSuper`, networth has `valueNoSuper`/`portfolio`/`crypto`). */
export type SnapshotRow = Record<string, unknown>;

/** Top-level cache: keyed by the same string used in `useCloudStorage`,
 *  e.g. "portfolio_snapshots" → array of rows for that type. */
export type SnapshotCache = Record<string, SnapshotRow[]>;

// ---------------------------------------------------------------------------
// Read / write / clear
// ---------------------------------------------------------------------------

/**
 * Reads the snapshot cache. Returns `null` when:
 *   - we're on the server (no `window`),
 *   - there's no cache yet (first visit),
 *   - the stored value is corrupt or from an older schema version.
 *
 * A `null` return is the signal for the caller to do a full Supabase fetch.
 */
export function readSnapshotCache(): SnapshotCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Defensive: only accept plain-object shape; ignore anything weird.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as SnapshotCache;
  } catch {
    // Parse errors, disabled storage, etc. — treat as "no cache".
    return null;
  }
}

/**
 * Writes the entire cache. Silently swallows quota errors — if writing fails,
 * the next page load just re-fetches from Supabase (slow, but correct).
 */
export function writeSnapshotCache(cache: SnapshotCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // QuotaExceededError, private-mode storage, etc. — give up quietly.
  }
}

/**
 * Replaces the rows for ONE snapshot key (e.g. after the user adds a new
 * portfolio snapshot). Other keys in the cache are left untouched.
 */
export function setSnapshotCacheKey(key: string, rows: SnapshotRow[]): void {
  const current = readSnapshotCache() ?? {};
  current[key] = rows;
  writeSnapshotCache(current);
}

/**
 * Wipes the cache entirely. Call this after any destructive server-side op
 * (Settings → Clear all, Settings → Import) so we don't keep showing rows
 * that no longer exist on the server.
 */
export function clearSnapshotCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage disabled — nothing to clear, nothing to do.
  }
}

// ---------------------------------------------------------------------------
// Helpers used during the incremental-fetch flow
// ---------------------------------------------------------------------------

/**
 * Returns the most recent `date` (ISO string, lexicographic compare works
 * because they're all in `YYYY-MM-DD` form) across all cached snapshot types.
 * The data-provider uses this as the lower bound for the "fetch only what's
 * new" Supabase query.
 *
 * Returns `undefined` if the cache has no rows — caller should treat that
 * as "do a full fetch".
 */
export function getLatestCachedDate(cache: SnapshotCache): string | undefined {
  let max: string | undefined;
  for (const rows of Object.values(cache)) {
    if (!rows) continue;
    for (const row of rows) {
      const d = row.date;
      if (typeof d === "string" && (!max || d > max)) max = d;
    }
  }
  return max;
}
