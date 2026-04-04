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
  mergeFromSupabase,
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
  const hasMounted = useRef(false);

  // Load last sync time on mount
  useEffect(() => {
    setLastSyncTimeState(getLastSyncTime());
  }, []);

  // Always merge from Supabase on first load — fills in missing keys
  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;

    async function syncOnLoad() {
      setSyncStatus("syncing");
      const result = await mergeFromSupabase();

      if (result.success && result.keysRestored > 0) {
        // New data was restored from cloud — reload to pick up in hooks
        setSyncStatus("synced");
        window.location.reload();
      } else {
        setSyncStatus("idle");
      }
    }

    syncOnLoad();
  }, []);

  // Manual save function
  const save = useCallback(async () => {
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
    function handleBeforeUnload() {
      pushToSupabase();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return (
    <SyncContext.Provider value={{ syncStatus, lastSyncTime, save }}>
      {children}
    </SyncContext.Provider>
  );
}
