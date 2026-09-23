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
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SNAPSHOT_KEYS, rowToCamel, syncSnapshots } from "@/lib/supabase/tables";
import {
  readSnapshotCache,
  writeSnapshotCache,
  setSnapshotCacheKey,
  type SnapshotCache,
  type SnapshotRow,
} from "@/lib/storage/snapshot-cache";
import {
  LIST_KEYS,
  applyChange,
  diffById,
  type ListChange,
  type ListItem,
  type ListUpdate,
} from "@/lib/storage/list-change";
import { supabaseKvStore, writeListChanges } from "@/lib/storage/kv-cas";
import { ListSaveQueue, ValueSaveQueue } from "@/lib/storage/save-queue";
import { loadInitialData } from "@/lib/storage/boot";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface DataContextValue {
  /** Pre-loaded data from Supabase (key → raw JSON string) */
  cache: React.MutableRefObject<Map<string, string>>;
  /** Whether initial fetch is complete */
  isLoaded: boolean;
  /** Save a key. For list keys pass the user's change: only that change is
   *  written, applied to the latest stored list (see lib/storage/kv-cas.ts). */
  persist: (key: string, value: string, change?: ListChange) => void;
  /** Write every pending change now (used by the Save button). */
  saveAll: () => Promise<{ success: boolean; error?: string }>;
  /** Subscribe to background updates for a key (e.g. the full snapshot history
   *  that streams in after first paint). Returns an unsubscribe fn. */
  subscribe: (key: string, cb: () => void) => () => void;
}

interface SaveStatus {
  /** Last successful save */
  lastSaveTime: number | null;
  /** Some change hasn't been saved yet and is being retried */
  saveError: boolean;
}

const DataContext = createContext<DataContextValue | null>(null);
// Kept apart from DataContext: save status changes on every save, and the
// data context must not — every useCloudStorage consumer would re-render and
// get new setter identities on each save (an effect depending on a setter
// then re-ran and saved again, in a loop).
const SaveStatusContext = createContext<SaveStatus>({ lastSaveTime: null, saveError: false });

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DataProvider({ children }: { children: React.ReactNode }) {
  const cache = useRef<Map<string, string>>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);
  // True while the background full-history backfill (Phase B) is running. Drives
  // the non-blocking "syncing history" indicator — never gates the UI.
  const [isBackfilling, setIsBackfilling] = useState(false);
  // Set when app_data couldn't be read: the app shows a retry screen instead of
  // an empty account whose next save would overwrite everything.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
  // Keys with a change that failed to save and is being retried.
  const [failing, setFailing] = useState<ReadonlySet<string>>(() => new Set());
  const [supabase] = useState(() => createClient());
  const [store] = useState(() => supabaseKvStore(supabase));
  // Newest app_data updated_at seen — what "changed since" means when a
  // backgrounded tab comes back.
  const watermark = useRef<string | null>(null);
  const bumpWatermark = useCallback((stamp: string | null) => {
    const t = stamp ? Date.parse(stamp) : NaN;
    if (Number.isNaN(t)) return;
    if (!watermark.current || t > Date.parse(watermark.current)) watermark.current = stamp;
  }, []);

  // Subscribers that want to re-render when a key is updated *after* the
  // initial load — used so charts pick up the full snapshot history once it
  // finishes streaming in behind the (already-dismissed) loading screen.
  const subscribers = useRef<Map<string, Set<() => void>>>(new Map());

  const subscribe = useCallback((key: string, cb: () => void) => {
    let set = subscribers.current.get(key);
    if (!set) {
      set = new Set();
      subscribers.current.set(key, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  }, []);

  const notify = useCallback((key: string) => {
    const set = subscribers.current.get(key);
    if (!set) return;
    for (const cb of set) cb();
  }, []);

  const markSaved = useCallback((key: string) => {
    setLastSaveTime(Date.now());
    setFailing((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }, []);

  const markFailing = useCallback((key: string, error: unknown) => {
    console.warn(`[save] ${key} not saved yet, retrying:`, error instanceof Error ? error.message : error);
    setFailing((s) => (s.has(key) ? s : new Set(s).add(key)));
  }, []);

  // Lists (income, expenses, transactions, holdings, debts, goals, templates,
  // categories, groups): only the user's change is sent, applied to the LATEST
  // stored list with a compare-and-swap — so a tab holding an old copy can no
  // longer erase what the phone or the cron saved meanwhile.
  const [listQueue] = useState(() => {
    const queue: ListSaveQueue = new ListSaveQueue({
      write: (key, changes) => writeListChanges(store, key, changes),
      onSaved: (key, row) => {
        bumpWatermark(row.updatedAt);
        markSaved(key);
        // The stored list can hold entries other devices added. Show it —
        // unless a newer edit of this list is already waiting to be saved.
        if (!queue.hasPending(key) && cache.current.get(key) !== row.value) {
          cache.current.set(key, row.value);
          notify(key);
        }
      },
      onError: markFailing,
    });
    return queue;
  });

  // Everything else (settings, CSV text, tags, snapshot blobs): single values,
  // latest wins — but a failed write is retried, never dropped.
  const [valueQueue] = useState(
    () =>
      new ValueSaveQueue({
        debounceMs: 300,
        write: async (key, value) => {
          const snapshotType = SNAPSHOT_KEYS[key];
          if (snapshotType) {
            // Append-only into the table that is chart history's source of truth.
            try {
              await syncSnapshots(supabase, snapshotType, JSON.parse(value) as Record<string, unknown>[]);
            } catch {
              // Best effort — the app_data blob below still lands.
            }
          }
          const updated_at = new Date().toISOString();
          const { error } = await supabase
            .from("app_data")
            .upsert({ key, value, updated_at }, { onConflict: "key" });
          if (error) throw new Error(error.message);
          bumpWatermark(updated_at);
        },
        onSaved: (key) => markSaved(key),
        onError: markFailing,
      }),
  );

  // Fetch all data from Supabase on mount (and again on Retry)
  useEffect(() => {
    async function load() {
      setLoadError(null);
      try {
        // Lists and settings come from app_data — the store every writer keeps
        // current. The only table read is `snapshots` (Phase A: the most recent
        // ~1000 rows, so the dashboard paints immediately); its full history
        // streams in afterwards via loadFullSnapshotHistory().
        const { kv, snapshots } = await loadInitialData(supabase);
        for (const [key, row] of kv) {
          cache.current.set(key, row.value);
          bumpWatermark(row.updatedAt);
        }
        // For chart history the snapshots table is the source of truth; the
        // app_data blob is only a fallback when the table returned nothing.
        for (const [key, rows] of snapshots) cache.current.set(key, JSON.stringify(rows));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Couldn't load your data");
        return;
      }
      setIsLoaded(true);

      // Phase B — stream the COMPLETE snapshot history in *after* first paint,
      // so the loading screen is already gone. Fire-and-forget.
      loadFullSnapshotHistory();
    }

    // Background backfill of the COMPLETE snapshot history. We deliberately page
    // through the WHOLE table every time (ascending from offset 0) rather than
    // an incremental "rows newer than cache" fetch — an incremental fetch only
    // ever moves forward, so it can never fill in older history that the recent
    // window (Phase A) is missing. This guarantees "fetch all", and since it's
    // off the critical path the extra reads don't affect time-to-paint.
    // Subscribers are notified once so open charts redraw with the full range.
    async function loadFullSnapshotHistory() {
      setIsBackfilling(true);
      try {
        // Anything already cached locally may be a LONGER history than the DB
        // currently holds (e.g. if the server-side trail was truncated). We
        // only ever ADD to it — never shrink it — so a reload is always safe
        // and a browser that still has the full history keeps showing it.
        const existing: SnapshotCache = readSnapshotCache() ?? {};

        // Page through the COMPLETE server-side history — NEWEST FIRST. Deep
        // offsets on this table can hit the statement timeout and end the
        // loop early; descending order means an early death costs the oldest
        // tail (usually already in the local cache from a prior session)
        // instead of silently truncating the series at some past date.
        const allRows: Record<string, unknown>[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("snapshots")
            .select("*")
            .order("date", { ascending: false })
            .range(from, from + PAGE - 1);
          if (error) break;
          if (!data || data.length === 0) break;
          allRows.push(...(data as Record<string, unknown>[]));
          if (data.length < PAGE) break;
        }

        // Union cached rows + server rows, keyed by `date` (server wins on a
        // tie — it's the source of truth for that timestamp). Snapshots are
        // immutable, so a union can only ever be MORE complete, never wrong.
        const merged: SnapshotCache = {};
        for (const [key, type] of Object.entries(SNAPSHOT_KEYS)) {
          const dbRows = allRows
            .map((r) => rowToCamel(r))
            .filter((s) => s.type === type)
            .map((s) => {
              const { id: _id, type: _type, createdAt: _ca, ...rest } =
                s as Record<string, unknown>;
              return rest as SnapshotRow;
            });
          const byDate = new Map<string, SnapshotRow>();
          for (const r of existing[key] ?? []) {
            const d = (r as SnapshotRow)?.date;
            if (typeof d === "string") byDate.set(d, r);
          }
          // Phase A's recent window (already in memory) joins the union too —
          // if the pagination above died early, publishing DB-only rows would
          // otherwise CLOBBER the newest data the app already had on screen.
          try {
            const inMemory = cache.current.get(key);
            if (inMemory) {
              for (const r of JSON.parse(inMemory) as SnapshotRow[]) {
                const d = r?.date;
                if (typeof d === "string") byDate.set(d, r);
              }
            }
          } catch {
            // Unparseable in-memory value — DB + localStorage union stands.
          }
          for (const r of dbRows) {
            const d = r?.date;
            if (typeof d === "string") byDate.set(d, r);
          }
          merged[key] = [...byDate.values()].sort((a, b) =>
            String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0,
          );
        }

        // Publish the union to consumers and persist it back to localStorage.
        for (const key of Object.keys(SNAPSHOT_KEYS)) {
          const rows = merged[key];
          if (rows && rows.length > 0) {
            cache.current.set(key, JSON.stringify(rows));
            notify(key);
          }
        }
        writeSnapshotCache(merged);
      } catch {
        // The recent window is already on screen — a failed backfill is harmless.
      } finally {
        setIsBackfilling(false);
      }
    }

    load();
  }, [supabase, notify, bumpWatermark, loadAttempt]);

  const persist = useCallback(
    (key: string, value: string, change?: ListChange) => {
      const previous = cache.current.get(key);
      // Update in-memory cache immediately
      cache.current.set(key, value);

      if (LIST_KEYS.has(key)) {
        let listChange = change;
        if (!listChange) {
          // Every list write should arrive with its change (useCloudStorage
          // computes it); derive one from the copy on screen as a fallback.
          try {
            const before: unknown = previous ? JSON.parse(previous) : [];
            listChange = diffById(Array.isArray(before) ? before : [], JSON.parse(value) as unknown[]);
          } catch {
            return;
          }
        }
        if (listChange.upserts.length > 0 || listChange.deletes.length > 0 || (listChange.updates?.length ?? 0) > 0) {
          listQueue.enqueue(key, listChange);
        }
        return;
      }

      // Mirror snapshot writes into the localStorage cache synchronously,
      // so the cache stays consistent with `cache.current` even before the
      // debounced Supabase write fires. If the user reloads the page during
      // the debounce window, the next load will still see the fresh rows.
      if (SNAPSHOT_KEYS[key]) {
        try {
          setSnapshotCacheKey(key, JSON.parse(value) as SnapshotRow[]);
        } catch {
          // Value isn't valid JSON for some reason — skip the cache update
          // rather than crashing persist(). Supabase write below still runs.
        }
      }
      valueQueue.enqueue(key, value);
    },
    [listQueue, valueQueue],
  );

  // Write every pending change now. Deliberately NOT "write every key": a
  // stale tab pressing Save used to push all of its old data over everything.
  const saveAll = useCallback(async () => {
    const [lists, values] = await Promise.all([listQueue.flush(), valueQueue.flush()]);
    if (lists && values) {
      setLastSaveTime(Date.now());
      return { success: true };
    }
    return { success: false, error: "Some changes couldn't be saved yet. They'll keep retrying." };
  }, [listQueue, valueQueue]);

  // Pick up what other devices (phone, cron) saved while this tab was away.
  const refresh = useCallback(async () => {
    const sinceMs = watermark.current ? Date.parse(watermark.current) : NaN;
    if (Number.isNaN(sinceMs)) return;
    // Every writer stamps updated_at with its own clock, so look back a margin
    // and skip values that haven't actually changed.
    const from = new Date(sinceMs - 10 * 60_000).toISOString();
    const skip = [...Object.keys(SNAPSHOT_KEYS), "cron_log"].map((k) => `"${k}"`).join(",");
    const { data, error } = await supabase
      .from("app_data")
      .select("key, value, updated_at")
      .gt("updated_at", from)
      .not("key", "in", `(${skip})`);
    if (error || !data) return;
    for (const row of data as { key: string; value: string; updated_at: string | null }[]) {
      bumpWatermark(row.updated_at);
      // A pending save of this key reconciles it when it lands.
      if (listQueue.hasPending(row.key) || valueQueue.hasPending(row.key)) continue;
      if (cache.current.get(row.key) === row.value) continue;
      cache.current.set(row.key, row.value);
      notify(row.key);
    }
  }, [supabase, listQueue, valueQueue, notify, bumpWatermark]);

  // Don't leave changes waiting on a debounce when the tab is backgrounded,
  // warn before closing it with anything unsaved, and refresh when it comes
  // back. (The old tab-close beacon is gone: it tried to write EVERY key from
  // this tab's possibly stale copy.)
  useEffect(() => {
    let hiddenAt = 0;
    let lastFocusRefresh = Date.now();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        void saveAll();
      } else if (hiddenAt && Date.now() - hiddenAt > 15_000) {
        lastFocusRefresh = Date.now();
        void refresh();
      }
    };
    const onFocus = () => {
      if (Date.now() - lastFocusRefresh < 60_000) return;
      lastFocusRefresh = Date.now();
      void refresh();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!listQueue.hasAnyPending() && !valueQueue.hasAnyPending()) return;
      void saveAll();
      e.preventDefault();
      e.returnValue = ""; // older browsers only show the prompt when this is set
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saveAll, refresh, listQueue, valueQueue]);

  const data = useMemo<DataContextValue>(
    () => ({ cache, isLoaded, persist, saveAll, subscribe }),
    [isLoaded, persist, saveAll, subscribe],
  );
  const saveStatus = useMemo<SaveStatus>(
    () => ({ lastSaveTime, saveError: failing.size > 0 }),
    [lastSaveTime, failing],
  );

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load your data. Nothing is shown and nothing will be saved until it loads.
          </p>
          <p className="text-xs font-mono text-muted-foreground/70">{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => setLoadAttempt((n) => n + 1)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

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
    <DataContext.Provider value={data}>
      <SaveStatusContext.Provider value={saveStatus}>
        {children}
        {/* Non-blocking indicator: the recent window is already interactive while
            the full history streams in behind it. */}
        {isBackfilling && (
          <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs font-mono text-muted-foreground shadow-sm backdrop-blur-sm">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Syncing full history…</span>
          </div>
        )}
        {/* A failed save is kept and retried — say so instead of failing silently. */}
        {failing.size > 0 && (
          <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-expense/40 bg-background/90 px-3 py-1.5 text-xs font-mono text-expense shadow-sm backdrop-blur-sm">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Couldn&apos;t save yet. Retrying…</span>
          </div>
        )}
      </SaveStatusContext.Provider>
    </DataContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook: drop-in replacement for useLocalStorage
// ---------------------------------------------------------------------------

type Setter<T> = (value: T | ((prev: T) => T)) => void;

type Patch = (updates: ListUpdate[], options?: { save?: boolean }) => void;

/**
 * [value, setValue, patch]. `patch` (list keys) applies field edits computed
 * from the LATEST stored version of each entry — use it for automated updates
 * (prices, reconciles, flags) so they can't revert what another device saved.
 * `{ save: false }` updates only what's on screen (e.g. live price ticks).
 */
export function useCloudStorage<T>(
  key: string,
  initialValue: T,
): [T, Setter<T>, Patch] {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useCloudStorage must be inside DataProvider");
  const { cache, persist, subscribe } = ctx;

  // Read initial value from pre-loaded cache
  const [storedValue, setStoredValue] = useState<T>(() => {
    const raw = cache.current.get(key);
    if (raw !== undefined) {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return initialValue;
      }
    }
    return initialValue;
  });
  // The value this hook last showed or saved. setValue computes the next value
  // from it OUTSIDE React's state updater: updaters can run twice (StrictMode),
  // and a side effect inside one — a save, a crypto.randomUUID() — then
  // happened twice.
  const latest = useRef(storedValue);

  // Re-sync when the provider signals a background update for this key — e.g.
  // the full snapshot history arriving after the initial recent-window paint,
  // or entries another device saved.
  useEffect(() => {
    return subscribe(key, () => {
      const raw = cache.current.get(key);
      if (raw === undefined) return;
      try {
        const value = JSON.parse(raw) as T;
        latest.current = value;
        setStoredValue(value);
      } catch {
        // Keep the current value if the cached blob is somehow invalid.
      }
    });
  }, [key, subscribe, cache]);

  const setValue = useCallback<Setter<T>>(
    (value) => {
      const prev = latest.current;
      const next = value instanceof Function ? value(prev) : value;
      if (Object.is(next, prev)) return; // an updater that changed nothing
      const serialized = JSON.stringify(next);
      // An equal copy (e.g. `{ ...prev }`) is no change: re-rendering with a
      // new identity would re-run effects that depend on the value, and some
      // of those set it again — a loop.
      if (serialized === JSON.stringify(prev)) return;
      latest.current = next;
      setStoredValue(next);
      if (LIST_KEYS.has(key) && Array.isArray(prev) && Array.isArray(next)) {
        // Send only what changed (by id). The provider applies it to the
        // latest stored list, so entries this screen never saw survive.
        const change = diffById(prev, next);
        if (change.upserts.length > 0 || change.deletes.length > 0) persist(key, serialized, change);
        return;
      }
      persist(key, serialized);
    },
    [key, persist],
  );

  const patch = useCallback<Patch>(
    (updates, options) => {
      if (updates.length === 0) return;
      const prev = latest.current;
      const change: ListChange = { upserts: [], deletes: [], updates };
      const next = applyChange(Array.isArray(prev) ? (prev as ListItem[]) : [], change) as unknown as T;
      latest.current = next;
      setStoredValue(next);
      if (options?.save !== false) persist(key, JSON.stringify(next), change);
    },
    [key, persist],
  );

  return [storedValue, setValue, patch];
}

// ---------------------------------------------------------------------------
// Hook: save button status
// ---------------------------------------------------------------------------

export function useSaveToCloud() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useSaveToCloud must be inside DataProvider");
  const { lastSaveTime } = useContext(SaveStatusContext);
  const { saveAll } = ctx;

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = useCallback(async () => {
    setStatus("saving");
    const result = await saveAll();
    if (result.success) {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } else {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    }
  }, [saveAll]);

  return { status, save, lastSaveTime };
}
