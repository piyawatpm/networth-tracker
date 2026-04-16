"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getUsMarketSession, type MarketSession } from "@/lib/utils/market-session";

const CONFIG: Record<MarketSession, { label: string; dotClass: string; textClass: string }> = {
  REGULAR: { label: "Live", dotClass: "bg-income animate-pulse", textClass: "text-income" },
  PRE:     { label: "Pre-market", dotClass: "bg-[#b8860b] animate-pulse", textClass: "text-[#b8860b]" },
  POST:    { label: "After hours", dotClass: "bg-[#4d7cc7] animate-pulse", textClass: "text-[#4d7cc7]" },
  CLOSED:  { label: "Closed", dotClass: "bg-muted-foreground/40", textClass: "text-muted-foreground" },
  WEEKEND: { label: "Weekend", dotClass: "bg-muted-foreground/40", textClass: "text-muted-foreground" },
};

export function MarketSessionBadge({ className }: { className?: string }) {
  const [session, setSession] = useState<MarketSession>("CLOSED");

  useEffect(() => {
    const tick = () => setSession(getUsMarketSession());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const cfg = CONFIG[session];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary text-[10px] font-mono uppercase tracking-wider",
        cfg.textClass,
        className,
      )}
      title={`US market: ${cfg.label}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dotClass)} />
      {cfg.label}
    </span>
  );
}
