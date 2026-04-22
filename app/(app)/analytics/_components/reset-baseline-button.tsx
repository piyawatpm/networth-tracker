"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function ResetBaselineButton({ baselineDate, onReset }: { baselineDate: string; onReset: () => void }) {
  const [saving, setSaving] = useState(false);
  async function reset() {
    const ok = window.confirm(
      `Replace current baseline (${baselineDate}) with today? Past baseline data is retained but the charts will reset to 0%.`
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch("/api/analytics/baseline", { method: "POST" });
      if (res.ok) onReset();
    } finally { setSaving(false); }
  }
  return (
    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={reset} disabled={saving}>
      <RotateCcw className="h-3 w-3" /> {saving ? "Resetting…" : `Reset baseline (${baselineDate})`}
    </Button>
  );
}
