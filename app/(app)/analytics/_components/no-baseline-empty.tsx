"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function NoBaselineEmpty({ onCreated }: { onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setBaseline() {
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/analytics/baseline", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  return (
    <div className="finance-card p-8 text-center space-y-3">
      <p className="label-mono">No baseline set</p>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Set today as your PnL baseline. All charts will reset to 0% and track
        your performance from today forward — comparing against SPY and BTC
        over the same window.
      </p>
      <Button onClick={setBaseline} disabled={saving}>
        {saving ? "Capturing…" : "Set Baseline to Today"}
      </Button>
      {error && <p className="text-xs text-expense">{error}</p>}
    </div>
  );
}
