"use client";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import type { Currency } from "@/lib/utils/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpcomingItem {
  description: string;
  amount: number;
  currency: Currency;
  kind: "income" | "expense";
  frequency: string;
  nextDate: string;
}

export interface UpcomingRecurringProps {
  items: UpcomingItem[];
  format: (amount: number, from?: string) => string;
  delay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UpcomingRecurring({
  items,
  format,
  delay,
}: UpcomingRecurringProps) {
  return (
    <BlurFade delay={delay} className="md:col-span-6">
      <div className="finance-card p-6 h-full">
        <p className="label-mono mb-4">Upcoming</p>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground/50 py-6">
            No recurring transactions set up
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item, idx) => {
              const shortDate = (() => {
                const [, m, d] = item.nextDate.split("-").map(Number);
                const dt = new Date(2000, m - 1, d);
                return dt.toLocaleDateString("en-AU", {
                  month: "short",
                  day: "numeric",
                });
              })();
              return (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground tabular-nums w-14 shrink-0">
                    {shortDate}
                  </span>
                  <span className="text-sm truncate flex-1">
                    {item.description}
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums text-sm shrink-0",
                      item.kind === "income" ? "text-income" : "text-expense",
                    )}
                  >
                    {item.kind === "income" ? "+" : "-"}
                    {format(item.amount, item.currency)}
                  </span>
                  <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full shrink-0">
                    {item.frequency}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BlurFade>
  );
}
