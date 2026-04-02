"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Gauge sub-component (semi-circle arc gauge)
// ---------------------------------------------------------------------------

function Gauge({
  value,
  max,
  thresholds,
  invert,
  suffix = "%",
}: {
  value: number;
  max: number;
  thresholds: [number, number];
  invert?: boolean;
  suffix?: string;
}) {
  const pct = Math.min(1, Math.max(0, value / max));
  const angle = pct * 180;
  const r = 36;
  const cx = 44;
  const cy = 42;
  // Determine color
  let color: string;
  if (invert) {
    color =
      value <= thresholds[0]
        ? "oklch(0.723 0.219 149.579)"
        : value <= thresholds[1]
          ? "#d4a033"
          : "oklch(0.637 0.237 25.331)";
  } else {
    color =
      value >= thresholds[1]
        ? "oklch(0.723 0.219 149.579)"
        : value >= thresholds[0]
          ? "#d4a033"
          : "oklch(0.637 0.237 25.331)";
  }
  // Arc path
  const endAngle = (180 - angle) * (Math.PI / 180);
  const ex = cx + r * Math.cos(endAngle);
  const ey = cy - r * Math.sin(endAngle);
  const largeArc = angle > 180 ? 1 : 0;
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  const fullPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <svg viewBox="0 0 88 50" className="w-full max-w-[88px]">
      <path
        d={fullPath}
        fill="none"
        stroke="currentColor"
        className="text-border"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d={arcPath}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fill={color}
        fontSize="14"
        fontWeight="700"
        fontFamily="var(--font-geist-mono), monospace"
      >
        {typeof value === "number" && value >= 1000
          ? `${(value / 1000).toFixed(1)}k`
          : value < 10
            ? value.toFixed(1)
            : Math.round(value)}
      </text>
      <text
        x={cx}
        y={cy + 8}
        textAnchor="middle"
        fill="currentColor"
        className="text-muted-foreground"
        fontSize="8"
      >
        {suffix}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FinancialIndicator {
  label: string;
  value: number;
  max: number;
  thresholds: [number, number];
  invert?: boolean;
  suffix: string;
  status: string;
  formula: string;
  detail: string;
  desc: string;
  tip: string;
}

export interface FinancialHealthSectionProps {
  indicators: FinancialIndicator[];
  delay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FinancialHealthSection({
  indicators,
  delay,
}: FinancialHealthSectionProps) {
  const [selectedIndicator, setSelectedIndicator] = useState<string | null>(
    null,
  );

  const selected = indicators.find((i) => i.label === selectedIndicator);

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <p className="label-mono mb-5">Financial Health Indicators</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {indicators.map((ind) => {
            const isGood = ind.invert
              ? ind.value <= ind.thresholds[0]
              : ind.value >= ind.thresholds[1];
            const isBad = ind.invert
              ? ind.value > ind.thresholds[1]
              : ind.value < ind.thresholds[0];
            return (
              <button
                key={ind.label}
                onClick={() => setSelectedIndicator(ind.label)}
                className="flex flex-col items-center text-center rounded-lg p-2 -m-2 transition-all hover:bg-secondary/50 cursor-pointer group"
              >
                <Gauge
                  value={ind.value}
                  max={ind.max}
                  thresholds={ind.thresholds}
                  invert={ind.invert}
                  suffix={ind.suffix}
                />
                <p className="text-[10px] font-medium mt-1 leading-tight">
                  {ind.label}
                </p>
                <p
                  className={cn(
                    "text-[9px] mt-0.5 font-medium",
                    isGood
                      ? "text-income"
                      : isBad
                        ? "text-expense"
                        : "text-muted-foreground",
                  )}
                >
                  {ind.status}
                </p>
                <p className="text-[8px] text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors mt-0.5">
                  tap for details
                </p>
              </button>
            );
          })}
        </div>

        {/* Indicator Detail Modal */}
        <Dialog
          open={selectedIndicator !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedIndicator(null);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            {selected &&
              (() => {
                const isGood = selected.invert
                  ? selected.value <= selected.thresholds[0]
                  : selected.value >= selected.thresholds[1];
                const isBad = selected.invert
                  ? selected.value > selected.thresholds[1]
                  : selected.value < selected.thresholds[0];
                const color = isGood
                  ? "oklch(0.723 0.219 149.579)"
                  : isBad
                    ? "oklch(0.637 0.237 25.331)"
                    : "#d4a033";
                return (
                  <>
                    <DialogHeader>
                      <DialogTitle>{selected.label}</DialogTitle>
                      <DialogDescription>{selected.desc}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      {/* Large gauge */}
                      <div className="flex justify-center">
                        <svg viewBox="0 0 120 70" className="w-32">
                          {(() => {
                            const pct = Math.min(
                              1,
                              Math.max(0, selected.value / selected.max),
                            );
                            const gAngle = pct * 180;
                            const gR = 48;
                            const gCx = 60;
                            const gCy = 56;
                            const gEndAngle =
                              (180 - gAngle) * (Math.PI / 180);
                            const gEx = gCx + gR * Math.cos(gEndAngle);
                            const gEy = gCy - gR * Math.sin(gEndAngle);
                            const gLargeArc = gAngle > 180 ? 1 : 0;
                            return (
                              <>
                                <path
                                  d={`M ${gCx - gR} ${gCy} A ${gR} ${gR} 0 0 1 ${gCx + gR} ${gCy}`}
                                  fill="none"
                                  stroke="currentColor"
                                  className="text-border"
                                  strokeWidth="8"
                                  strokeLinecap="round"
                                />
                                <path
                                  d={`M ${gCx - gR} ${gCy} A ${gR} ${gR} 0 ${gLargeArc} 1 ${gEx.toFixed(1)} ${gEy.toFixed(1)}`}
                                  fill="none"
                                  stroke={color}
                                  strokeWidth="8"
                                  strokeLinecap="round"
                                />
                                <text
                                  x={gCx}
                                  y={gCy - 10}
                                  textAnchor="middle"
                                  fill={color}
                                  fontSize="22"
                                  fontWeight="700"
                                  fontFamily="var(--font-geist-mono), monospace"
                                >
                                  {selected.value < 10
                                    ? selected.value.toFixed(1)
                                    : Math.round(selected.value)}
                                </text>
                                <text
                                  x={gCx}
                                  y={gCy + 4}
                                  textAnchor="middle"
                                  fill="currentColor"
                                  className="text-muted-foreground"
                                  fontSize="10"
                                >
                                  {selected.suffix}
                                </text>
                              </>
                            );
                          })()}
                        </svg>
                      </div>

                      {/* Status */}
                      <div className="text-center">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                            isGood
                              ? "bg-income/10 text-income"
                              : isBad
                                ? "bg-expense/10 text-expense"
                                : "bg-secondary text-secondary-foreground",
                          )}
                        >
                          {selected.status}
                        </span>
                      </div>

                      {/* Formula + Calculation */}
                      <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                          Formula
                        </p>
                        <p className="text-sm font-mono">{selected.formula}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {selected.detail}
                        </p>
                      </div>

                      {/* Zone bar */}
                      <div className="space-y-1">
                        <div className="flex h-2 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "transition-all",
                              selected.invert
                                ? "bg-income/60"
                                : "bg-expense/60",
                            )}
                            style={{
                              width: `${(selected.thresholds[0] / selected.max) * 100}%`,
                            }}
                          />
                          <div
                            className="bg-[#d4a033]/50 flex-1"
                            style={{
                              width: `${((selected.thresholds[1] - selected.thresholds[0]) / selected.max) * 100}%`,
                            }}
                          />
                          <div
                            className={cn(
                              "transition-all flex-1",
                              selected.invert
                                ? "bg-expense/60"
                                : "bg-income/60",
                            )}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-muted-foreground/50">
                          <span>0</span>
                          <span>{selected.thresholds[0]}</span>
                          <span>{selected.thresholds[1]}</span>
                          <span>{selected.max}</span>
                        </div>
                      </div>

                      {/* Recommendation */}
                      <div className="rounded-lg border border-border/50 p-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">
                          Recommendation
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {selected.tip}
                        </p>
                      </div>
                    </div>
                  </>
                );
              })()}
          </DialogContent>
        </Dialog>
      </div>
    </BlurFade>
  );
}
