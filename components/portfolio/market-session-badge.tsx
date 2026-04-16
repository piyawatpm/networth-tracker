"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Session = "PRE" | "REGULAR" | "POST" | "CLOSED" | "WEEKEND";

function getUsMarketSession(now = new Date()): Session {
  // Build ET wall time via Intl — handles DST automatically
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const mins = hour * 60 + minute;

  if (weekday === "Sat" || weekday === "Sun") return "WEEKEND";
  // Pre-market: 4:00 AM – 9:30 AM ET
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "PRE";
  // Regular: 9:30 AM – 4:00 PM ET
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "REGULAR";
  // Post-market: 4:00 PM – 8:00 PM ET
  if (mins >= 16 * 60 && mins < 20 * 60) return "POST";
  return "CLOSED";
}

const CONFIG: Record<Session, { label: string; dotClass: string; textClass: string }> = {
  REGULAR: { label: "Live", dotClass: "bg-income animate-pulse", textClass: "text-income" },
  PRE:     { label: "Pre-market", dotClass: "bg-[#b8860b] animate-pulse", textClass: "text-[#b8860b]" },
  POST:    { label: "After hours", dotClass: "bg-[#4d7cc7] animate-pulse", textClass: "text-[#4d7cc7]" },
  CLOSED:  { label: "Closed", dotClass: "bg-muted-foreground/40", textClass: "text-muted-foreground" },
  WEEKEND: { label: "Weekend", dotClass: "bg-muted-foreground/40", textClass: "text-muted-foreground" },
};

export function MarketSessionBadge({ className }: { className?: string }) {
  const [session, setSession] = useState<Session>("CLOSED");

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
