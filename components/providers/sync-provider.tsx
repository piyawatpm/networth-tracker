"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  pushToSupabase,
  pullFromSupabase,
  hasLocalData,
  getLastSyncTime,
  setLastSyncTime,
} from "@/lib/supabase/sync";
import { cn } from "@/lib/utils";
import { Cloud, CloudOff, RefreshCw, Check } from "lucide-react";

const SYNC_INTERVAL = 60_000; // 1 minute

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [restored, setRestored] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasMounted = useRef(false);

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
        // Reload to pick up restored data in useLocalStorage hooks
        window.location.reload();
      } else {
        setRestored(true);
        setSyncStatus("idle");
      }
    }

    restore();
  }, []);

  // Push to Supabase periodically
  const sync = useCallback(async () => {
    if (!hasLocalData()) return;

    setSyncStatus("syncing");
    const result = await pushToSupabase();
    if (result.success) {
      setLastSyncTime();
      setSyncStatus("synced");
      setTimeout(() => setSyncStatus("idle"), 3000);
    } else {
      console.warn("Supabase sync failed:", result.error);
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 5000);
    }
  }, []);

  useEffect(() => {
    if (!restored) return;

    // Initial sync after a short delay
    const timeout = setTimeout(sync, 5000);

    // Periodic sync
    intervalRef.current = setInterval(sync, SYNC_INTERVAL);

    // Sync on tab visibility change (coming back to tab)
    function handleVisibility() {
      if (document.visibilityState === "visible") sync();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    // Sync before leaving
    function handleBeforeUnload() {
      // Use sendBeacon pattern for reliability
      if (hasLocalData()) {
        pushToSupabase();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [restored, sync]);

  return (
    <>
      {children}
      {/* Sync indicator - small pill in bottom-left */}
      <SyncIndicator status={syncStatus} lastSync={getLastSyncTime()} />
    </>
  );
}

function SyncIndicator({
  status,
  lastSync,
}: {
  status: "idle" | "syncing" | "synced" | "error";
  lastSync: number | null;
}) {
  if (status === "idle") return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 z-50 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-mono tracking-wider uppercase transition-all duration-300",
        status === "syncing" && "bg-secondary text-muted-foreground",
        status === "synced" && "bg-income/10 text-income",
        status === "error" && "bg-expense/10 text-expense",
      )}
    >
      {status === "syncing" && (
        <>
          <RefreshCw className="h-3 w-3 animate-spin" />
          syncing
        </>
      )}
      {status === "synced" && (
        <>
          <Check className="h-3 w-3" />
          saved
        </>
      )}
      {status === "error" && (
        <>
          <CloudOff className="h-3 w-3" />
          sync failed
        </>
      )}
    </div>
  );
}
