"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RebuildHistoryButtonProps {
  baselineDate: string;
  onRebuilt: () => void;
}

export function RebuildHistoryButton({ baselineDate, onRebuilt }: RebuildHistoryButtonProps) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function run() {
    setStatus("running");
    setMessage("");
    try {
      const res = await fetch("/api/analytics/backfill-performance", { method: "POST" });
      const json = (await res.json()) as
        | { ok: true; daysWritten: number; from: string; to: string }
        | { error: string };
      if (!res.ok || "error" in json) {
        setStatus("error");
        setMessage("error" in json ? json.error : `HTTP ${res.status}`);
        return;
      }
      setStatus("done");
      setMessage(`Rebuilt ${json.daysWritten} days (${json.from} → ${json.to})`);
      onRebuilt();
    } catch (e) {
      setStatus("error");
      setMessage(String(e));
    }
  }

  const label =
    status === "running" ? "Rebuilding…" :
    status === "done" ? "Rebuilt ✓" :
    status === "error" ? "Failed — retry" :
    `Rebuild history (from ${baselineDate})`;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={run}
        disabled={status === "running"}
      >
        <History className="h-3 w-3" /> {label}
      </Button>
      {message && (
        <p className={`text-xs font-mono ${status === "error" ? "text-expense" : "text-muted-foreground"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
