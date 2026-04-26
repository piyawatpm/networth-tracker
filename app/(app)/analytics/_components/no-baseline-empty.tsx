"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function NoBaselineEmpty({ onCreated }: { onCreated: () => void }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/baseline");
      const j = (await res.json()) as { baseline: unknown; error?: string };
      if (j.error) {
        setError(j.error);
        return;
      }
      if (j.baseline) {
        onCreated();
        return;
      }
      setError("Still no snapshots yet. Wait for the next cron run (every 15 min) or trigger one from the Debug page.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="finance-card p-8 text-center space-y-3">
      <p className="label-mono">No baseline yet</p>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        The baseline auto-derives from your first portfolio or crypto snapshot,
        written every 15 min by the cron. Once the first snapshot lands, your
        analytics will start tracking automatically.
      </p>
      <Button onClick={check} disabled={checking}>
        {checking ? "Checking…" : "Check now"}
      </Button>
      {error && <p className="text-xs text-expense">{error}</p>}
    </div>
  );
}
