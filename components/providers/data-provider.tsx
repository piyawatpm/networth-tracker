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
        const { data, error } = await supabase
          .from("app_data")
          .select("key, value");

        if (!error && data) {
          for (const row of data) {
            cache.current.set(row.key, row.value);
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
  const pendingWrites = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const persist = useCallback(
    (key: string, value: string) => {
      // Update in-memory cache immediately
      cache.current.set(key, value);

      // Debounce the Supabase write (300ms)
      const existing = pendingWrites.current.get(key);
      if (existing) clearTimeout(existing);

      pendingWrites.current.set(
        key,
        setTimeout(() => {
          pendingWrites.current.delete(key);
          supabase
            .from("app_data")
            .upsert(
              { key, value, updated_at: new Date().toISOString() },
              { onConflict: "key" },
            )
            .then(({ error }) => {
              if (error) console.warn(`Supabase write failed for ${key}:`, error.message);
            });
        }, 300),
      );
    },
    [supabase],
  );

  // Save all cached data to Supabase at once
  const saveAll = useCallback(async () => {
    const rows: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    cache.current.forEach((value, key) => {
      rows.push({ key, value, updated_at: now });
    });

    if (rows.length === 0) return { success: true };

    const { error } = await supabase
      .from("app_data")
      .upsert(rows, { onConflict: "key" });

    if (error) return { success: false, error: error.message };

    setLastSaveTime(Date.now());
    return { success: true };
  }, [supabase]);

  // Save before tab close
  useEffect(() => {
    function handleBeforeUnload() {
      // Flush all pending writes
      pendingWrites.current.forEach((timeout) => clearTimeout(timeout));
      pendingWrites.current.clear();

      // Synchronous beacon — best effort
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
          new Blob([body], { type: "application/json" }),
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
