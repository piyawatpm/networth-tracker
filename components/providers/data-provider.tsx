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
import {
  ENTITY_TABLES,
  SNAPSHOT_KEYS,
  CATEGORY_KEYS,
  rowToCamel,
  syncEntityTable,
  syncSnapshots,
  syncCategories,
} from "@/lib/supabase/tables";

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

// Set of all keys that are routed to proper tables (not app_data)
const TABLE_KEYS = new Set([
  ...Object.keys(ENTITY_TABLES),
  ...Object.keys(SNAPSHOT_KEYS),
  ...Object.keys(CATEGORY_KEYS),
  "cron_log",
]);

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
        // Step 1: Always load app_data KV first (guaranteed to have data)
        const { data: kvData } = await supabase
          .from("app_data")
          .select("key, value");
        for (const row of kvData ?? []) {
          cache.current.set(row.key, row.value);
        }

        // Step 2: Try loading from relational tables — override KV if tables have data
        let tablesAvailable = true;

        // Probe one table to see if migration has been run
        const { error: probeError } = await supabase
          .from("income_entries")
          .select("id", { count: "exact", head: true });

        if (probeError) {
          // Tables don't exist yet — keep using app_data KV data (already loaded)
          tablesAvailable = false;
          console.info("[DataProvider] New tables not found, using app_data KV fallback");
        }

        if (tablesAvailable) {
          // Check if tables actually have data (migration endpoint may not have been run)
          const { count } = await supabase
            .from("income_entries")
            .select("id", { count: "exact", head: true });
          const tablesHaveData = (count ?? 0) > 0;

          if (tablesHaveData) {
            // Tables exist AND have data — load from them
            await Promise.all([
              // Entity tables
              ...Object.entries(ENTITY_TABLES).map(async ([key, cfg]) => {
                const { data } = await supabase.from(cfg.table).select("*");
                const camelRows = (data ?? []).map((r) =>
                  rowToCamel(r as Record<string, unknown>)
                );
                if (camelRows.length > 0) {
                  cache.current.set(key, JSON.stringify(camelRows));
                }
              }),

              // Snapshots
              (async () => {
                const { data } = await supabase
                  .from("snapshots")
                  .select("*")
                  .order("date", { ascending: true });
                const all = (data ?? []).map((r) =>
                  rowToCamel(r as Record<string, unknown>)
                );
                if (all.length > 0) {
                  for (const [key, type] of Object.entries(SNAPSHOT_KEYS)) {
                    const filtered = all
                      .filter((s) => s.type === type)
                      .map((s) => {
                        const {
                          id: _id,
                          type: _type,
                          createdAt: _ca,
                          ...rest
                        } = s as Record<string, unknown>;
                        return rest;
                      });
                    if (filtered.length > 0) {
                      cache.current.set(key, JSON.stringify(filtered));
                    }
                  }
                }
              })(),

              // Custom categories
              (async () => {
                const { data } = await supabase
                  .from("custom_categories")
                  .select("*");
                if (data && data.length > 0) {
                  for (const [key, kind] of Object.entries(CATEGORY_KEYS)) {
                    const filtered = data
                      .filter((c) => c.kind === kind)
                      .map(({ kind: _, ...rest }) => rest);
                    if (filtered.length > 0) {
                      cache.current.set(key, JSON.stringify(filtered));
                    }
                  }
                }
              })(),

              // Cron logs
              (async () => {
                const { data } = await supabase
                  .from("cron_logs")
                  .select("*")
                  .order("created_at", { ascending: false })
                  .limit(30);
                if (data && data.length > 0) {
                  const logs = data.map((r) => ({
                    date: r.date,
                    timestamp: r.timestamp,
                    success: r.success,
                    log:
                      typeof r.log === "string" ? JSON.parse(r.log) : r.log,
                  }));
                  cache.current.set("cron_log", JSON.stringify(logs));
                }
              })(),
            ]);
          } else {
            console.info("[DataProvider] Tables exist but are empty — using app_data KV fallback. Run /api/migrate to populate tables.");
          }
        }
      } catch {
        // Supabase unavailable — start with empty cache
      }
      setIsLoaded(true);
    }

    load();
  }, [supabase]);

  // Write a single key to Supabase (debounced per key)
  const pendingWrites = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  const persist = useCallback(
    (key: string, value: string) => {
      // Update in-memory cache immediately
      cache.current.set(key, value);

      // Debounce the Supabase write
      const existing = pendingWrites.current.get(key);
      if (existing) clearTimeout(existing);

      const entityCfg = ENTITY_TABLES[key];
      const snapshotType = SNAPSHOT_KEYS[key];
      const categoryKind = CATEGORY_KEYS[key];

      // 500ms debounce for table writes, 300ms for KV
      const delay = entityCfg || snapshotType || categoryKind ? 500 : 300;

      pendingWrites.current.set(
        key,
        setTimeout(async () => {
          pendingWrites.current.delete(key);
          try {
            // Try writing to proper table first
            if (entityCfg) {
              const items = JSON.parse(value) as Record<string, unknown>[];
              try { await syncEntityTable(supabase, entityCfg.table, items); } catch { /* table may not exist yet */ }
            } else if (snapshotType) {
              const items = JSON.parse(value) as Record<string, unknown>[];
              try { await syncSnapshots(supabase, snapshotType, items); } catch { /* table may not exist yet */ }
            } else if (categoryKind) {
              const items = JSON.parse(value) as Record<string, unknown>[];
              try { await syncCategories(supabase, categoryKind, items); } catch { /* table may not exist yet */ }
            }
            // Always dual-write to app_data KV as safety net
            await supabase
              .from("app_data")
              .upsert(
                { key, value, updated_at: new Date().toISOString() },
                { onConflict: "key" }
              );
          } catch (err) {
            console.warn(
              `Supabase write failed for ${key}:`,
              err instanceof Error ? err.message : err
            );
          }
        }, delay)
      );
    },
    [supabase]
  );

  // Save all cached data to Supabase at once
  const saveAll = useCallback(async () => {
    try {
      const now = new Date().toISOString();

      // Try writing to proper tables (graceful — tables may not exist yet)
      try {
        await Promise.all([
          ...Object.entries(ENTITY_TABLES).map(async ([key, cfg]) => {
            const raw = cache.current.get(key);
            if (!raw) return;
            const items = JSON.parse(raw) as Record<string, unknown>[];
            await syncEntityTable(supabase, cfg.table, items);
          }),
          ...Object.entries(SNAPSHOT_KEYS).map(async ([key, type]) => {
            const raw = cache.current.get(key);
            if (!raw) return;
            const items = JSON.parse(raw) as Record<string, unknown>[];
            await syncSnapshots(supabase, type, items);
          }),
          ...Object.entries(CATEGORY_KEYS).map(async ([key, kind]) => {
            const raw = cache.current.get(key);
            if (!raw) return;
            const items = JSON.parse(raw) as Record<string, unknown>[];
            await syncCategories(supabase, kind, items);
          }),
        ]);
      } catch {
        // Tables may not exist yet — that's fine, KV fallback below
      }

      // Always save ALL keys to app_data KV as safety net
      const kvRows: { key: string; value: string; updated_at: string }[] = [];
      cache.current.forEach((value, key) => {
        kvRows.push({ key, value, updated_at: now });
      });

      if (kvRows.length > 0) {
        const { error } = await supabase
          .from("app_data")
          .upsert(kvRows, { onConflict: "key" });
        if (error) return { success: false, error: error.message };
      }

      setLastSaveTime(Date.now());
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }, [supabase]);

  // Save before tab close — beacon ALL data to app_data KV as safety net
  useEffect(() => {
    function handleBeforeUnload() {
      // Flush all pending writes
      pendingWrites.current.forEach((timeout) => clearTimeout(timeout));
      pendingWrites.current.clear();

      // Synchronous beacon — best effort, save everything to app_data
      const rows: { key: string; value: string; updated_at: string }[] = [];
      const now = new Date().toISOString();
      cache.current.forEach((value, key) => {
        rows.push({ key, value, updated_at: now });
      });

      if (rows.length > 0) {
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/app_data?on_conflict=key`;
        const body = JSON.stringify(rows);
        navigator.sendBeacon?.(
          url,
          new Blob([body], { type: "application/json" })
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
    <DataContext.Provider
      value={{ cache, isLoaded, persist, saveAll, lastSaveTime }}
    >
      {children}
    </DataContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook: drop-in replacement for useLocalStorage
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
// Hook: save button status
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
