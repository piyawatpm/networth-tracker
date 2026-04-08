"use client";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { Shield } from "lucide-react";

export interface EFAllocation {
  label: string;
  value: number;
  color: string;
}

interface EmergencyFundCardProps {
  fundTotal: number;
  monthlyBurn: number;
  coverageMonths: number;
  targetMonths: number;
  allocations: EFAllocation[];
  format: (v: number) => string;
  delay: number;
}

export function EmergencyFundCard({
  fundTotal,
  monthlyBurn,
  coverageMonths,
  targetMonths,
  allocations,
  format,
  delay,
}: EmergencyFundCardProps) {
  const pct = targetMonths > 0 ? Math.min((coverageMonths / targetMonths) * 100, 100) : 0;
  const zone: "red" | "yellow" | "green" =
    coverageMonths >= 6 ? "green" : coverageMonths >= 3 ? "yellow" : "red";

  const zoneColor = {
    red: "text-expense",
    yellow: "text-[#b8860b] dark:text-[#d4a033]",
    green: "text-income",
  }[zone];

  const zoneBg = {
    red: "bg-expense",
    yellow: "bg-[#b8860b] dark:bg-[#d4a033]",
    green: "bg-income",
  }[zone];

  const zoneLabel = {
    red: "Build up",
    yellow: "Adequate",
    green: "Strong",
  }[zone];

  return (
    <BlurFade delay={delay} className="md:col-span-6">
      <div className="finance-card px-3 py-4 sm:p-5 h-full">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="label-mono">Emergency Fund</p>
          <span className={cn("text-[10px] font-semibold ml-auto", zoneColor)}>
            {zoneLabel}
          </span>
        </div>

        {/* Main stat */}
        <div className="flex items-baseline gap-1.5 mb-2.5">
          <span className={cn("text-2xl sm:text-3xl font-bold tabular-nums", zoneColor)}>
            {coverageMonths.toFixed(1)}
          </span>
          <span className="text-sm text-muted-foreground">
            / {targetMonths} months
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2.5 w-full rounded-full bg-muted mb-3 overflow-hidden">
          <div className="relative h-full">
            <div
              className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-700", zoneBg)}
              style={{ width: `${pct}%`, opacity: 0.85 }}
            />
            <div
              className="absolute inset-y-0 w-px bg-foreground/20"
              style={{ left: `${(3 / targetMonths) * 100}%` }}
            />
            {targetMonths > 6 && (
              <div
                className="absolute inset-y-0 w-px bg-foreground/20"
                style={{ left: `${(6 / targetMonths) * 100}%` }}
              />
            )}
          </div>
        </div>

        {/* Details row */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Fund Total</p>
            <p className="text-sm font-semibold tabular-nums mt-0.5">{format(fundTotal)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Monthly Burn</p>
            <p className="text-sm font-semibold tabular-nums mt-0.5">{format(monthlyBurn)}</p>
          </div>
        </div>

        {/* Allocation mini bars */}
        {allocations.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border/40">
            {/* Stacked bar */}
            <div className="flex h-2 rounded-full overflow-hidden bg-muted">
              {allocations.map((a) => (
                <div
                  key={a.label}
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${fundTotal > 0 ? (a.value / fundTotal) * 100 : 0}%`,
                    backgroundColor: a.color,
                    opacity: 0.8,
                  }}
                />
              ))}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {allocations.map((a) => (
                <div key={a.label} className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-[9px] text-muted-foreground truncate">
                    {a.label} {fundTotal > 0 ? `${((a.value / fundTotal) * 100).toFixed(0)}%` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </BlurFade>
  );
}
