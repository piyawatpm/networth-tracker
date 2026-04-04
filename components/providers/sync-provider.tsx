"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  pushToSupabase,
  pullFromSupabase,
  hasLocalData,
  getLastSyncTime,
  setLastSyncTime,
} from "@/lib/supabase/sync";

interface SyncContextValue {
  syncStatus: "idle" | "syncing" | "synced" | "error";
  lastSyncTime: number | null;
  save: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  syncStatus: "idle",
  lastSyncTime: null,
  save: async () => {},
});

export function useSyncStatus() {
  return useContext(SyncContext);
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [lastSyncTime, setLastSyncTimeState] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const hasMounted = useRef(false);

  // Load last sync time on mount
  useEffect(() => {
    setLastSyncTimeState(getLastSyncTime());
  }, []);

  // Restore from Supabase on first load if localStorage is empty
  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;

    async function restore() {
      if (hasLocalData()) {
        setRestored(true);
        return;
      }

      setSyncStatus("syncing");
      const result = await pullFromSupabase();
      if (result.success && result.keysRestored > 0) {
        setRestored(true);
        setSyncStatus("synced");
        window.location.reload();
      } else {
        setRestored(true);
        setSyncStatus("idle");
      }
    }

    restore();
  }, []);

  // Manual save function
  const save = useCallback(async () => {
    if (!hasLocalData()) return;

    setSyncStatus("syncing");
    const result = await pushToSupabase();
    if (result.success) {
      setLastSyncTime();
      setLastSyncTimeState(Date.now());
      setSyncStatus("synced");
      setTimeout(() => setSyncStatus("idle"), 3000);
    } else {
      console.warn("Supabase sync failed:", result.error);
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 5000);
    }
  }, []);

  // Save before leaving the page
  useEffect(() => {
    if (!restored) return;

    function handleBeforeUnload() {
      if (hasLocalData()) {
        pushToSupabase();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [restored]);

  return (
    <SyncContext.Provider value={{ syncStatus, lastSyncTime, save }}>
      {children}
    </SyncContext.Provider>
  );
}
