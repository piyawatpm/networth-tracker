"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { ReactECharts, type EChartsReact } from "@/components/ui/lazy-echarts";
import { useTheme } from "next-themes";
import { Eye, EyeOff, Maximize2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { getPieBaseOption } from "@/lib/utils/echarts";
import { useCurrency } from "@/components/providers/currency-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  WORLD_COLORS,
  WORLD_LABELS,
  type FinancialWorld,
} from "@/lib/utils/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorldBreakdownItem {
  /** Primary label, e.g. ticker or token */
  label: string;
  /** Optional secondary label, e.g. full name or broker */
  sublabel?: string;
  /** Value in the user's preferred currency (already converted) */
  value: number;
}

export interface WorldDistributionChartProps {
  normalTotal: number;
  cryptoTotal: number;
  superTotal: number;
  format: (amount: number) => string;
  delay: number;
  /** Per-world detail rows, shown in the drill-down modal */
  breakdowns?: Partial<Record<FinancialWorld, WorldBreakdownItem[]>>;
  /** Total value of everything the user has tagged as cash / dry powder */
  cashTotal?: number;
  /** Individual dry-powder items (portfolio + crypto) */
  cashAllocations?: {
    label: string;
    sublabel?: string;
    value: number;
    source: "portfolio" | "crypto";
  }[];
}

interface WorldSegment {
  key: FinancialWorld;
  label: string;
  value: number;
  color: string;
  description: string;
}

const DESCRIPTIONS: Record<FinancialWorld, string> = {
  normal:
    "Accessible, liquid holdings — regular brokerage portfolio, bank savings, cash. Can be spent or invested at any time.",
  crypto:
    "Digital assets — tokens and coins across exchanges and wallets, including any staked or earning balances.",
  super:
    "Superannuation / retirement accounts. Locked until preservation age, but usually the largest long-term compounding bucket.",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorldDistributionChart({
  normalTotal,
  cryptoTotal,
  superTotal,
  format,
  delay,
  breakdowns,
  cashTotal = 0,
  cashAllocations = [],
}: WorldDistributionChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { symbol } = useCurrency();
  const chartRef = useRef<EChartsReact>(null);
  const [hidden, setHidden] = useState<Set<FinancialWorld>>(new Set());
  const [hoveredKey, setHoveredKey] = useState<FinancialWorld | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const segments: WorldSegment[] = useMemo(
    () =>
      (
        [
          {
            key: "normal",
            label: WORLD_LABELS.normal,
            value: normalTotal,
            color: WORLD_COLORS.normal,
            description: DESCRIPTIONS.normal,
          },
          {
            key: "crypto",
            label: WORLD_LABELS.crypto,
            value: cryptoTotal,
            color: WORLD_COLORS.crypto,
            description: DESCRIPTIONS.crypto,
          },
          {
            key: "super",
            label: WORLD_LABELS.super,
            value: superTotal,
            color: WORLD_COLORS.super,
            description: DESCRIPTIONS.super,
          },
        ] as WorldSegment[]
      ).filter((s) => s.value > 0),
    [normalTotal, cryptoTotal, superTotal],
  );

  const toggle = useCallback(
    (key: FinancialWorld) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          if (next.size >= segments.length - 1) return prev;
          next.add(key);
        }
        return next;
      });
    },
    [segments.length],
  );

  const visibleSegments = useMemo(
    () => segments.filter((s) => !hidden.has(s.key)),
    [segments, hidden],
  );

  const visibleTotal = useMemo(
    () => visibleSegments.reduce((sum, s) => sum + s.value, 0),
    [visibleSegments],
  );

  const grandTotal = useMemo(
    () => segments.reduce((sum, s) => sum + s.value, 0),
    [segments],
  );

  const chartOption = useMemo(() => {
    const base = getPieBaseOption(isDark, symbol);
    return {
      ...base,
      series: [
        {
          type: "pie" as const,
          radius: ["60%", "90%"],
          center: ["50%", "50%"],
          padAngle: 2,
          data: visibleSegments.map((s) => ({
            name: s.label,
            value: s.value,
            itemStyle: { color: s.color },
          })),
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 12,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.35)",
            },
          },
          animationType: "scale" as const,
          animationEasing: "cubicOut" as const,
        },
      ],
    };
  }, [visibleSegments, isDark, symbol]);

  const handleHover = useCallback((label: string) => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) instance.dispatchAction({ type: "highlight", name: label });
  }, []);

  const handleLeave = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) instance.dispatchAction({ type: "downplay" });
  }, []);

  return (
    <BlurFade delay={delay} className="md:col-span-12">
      <div className="finance-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="label-mono">Asset Distribution</p>
            <button
              onClick={() => setDetailsOpen(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition-colors",
                cashTotal > 0
                  ? "border-[#4d7cc7]/40 bg-[#4d7cc7]/10 text-[#4d7cc7] hover:bg-[#4d7cc7]/15"
                  : "border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
              title="Cash / dry powder you can deploy"
            >
              <Wallet className="h-3 w-3" />
              {cashTotal > 0 ? (
                <>
                  <span className="tabular-nums">{format(cashTotal)}</span>
                  <span className="opacity-70">Dry Powder</span>
                </>
              ) : (
                <span>Tag Dry Powder</span>
              )}
            </button>
          </div>
          <button
            onClick={() => setDetailsOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <Maximize2 className="h-3 w-3" />
            Details
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_1fr] md:items-center">
          {/* Donut */}
          <button
            onClick={() => setDetailsOpen(true)}
            className="relative mx-auto h-[200px] w-[200px] transition-transform hover:scale-[1.02] active:scale-[0.99]"
            aria-label="Open asset distribution details"
          >
            <ReactECharts
              ref={chartRef}
              option={chartOption}
              style={{ height: 200, width: 200 }}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Total
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {format(visibleTotal)}
              </span>
            </div>
          </button>

          {/* Horizontal bars + legend */}
          <div className="space-y-3">
            {segments.map((seg) => {
              const isHidden = hidden.has(seg.key);
              const pct =
                !isHidden && visibleTotal > 0
                  ? (seg.value / visibleTotal) * 100
                  : 0;

              return (
                <div
                  key={seg.key}
                  onMouseEnter={() => {
                    setHoveredKey(seg.key);
                    if (!isHidden) handleHover(seg.label);
                  }}
                  onMouseLeave={() => {
                    setHoveredKey(null);
                    handleLeave();
                  }}
                  className={cn(
                    "group rounded-lg px-2 py-2 transition-colors",
                    isHidden ? "opacity-40" : "hover:bg-secondary/60",
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <button
                      onClick={() => toggle(seg.key)}
                      className="flex items-center gap-2"
                      aria-label={`Toggle ${seg.label}`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: isHidden ? "#aaa" : seg.color,
                        }}
                      />
                      <span
                        className={cn(
                          "text-sm font-medium",
                          isHidden
                            ? "text-muted-foreground line-through"
                            : "text-foreground",
                        )}
                      >
                        {seg.label}
                      </span>
                      {hoveredKey === seg.key && (
                        <span className="opacity-70">
                          {isHidden ? (
                            <EyeOff className="h-3 w-3 text-muted-foreground/60" />
                          ) : (
                            <Eye className="h-3 w-3 text-income" />
                          )}
                        </span>
                      )}
                    </button>
                    <div className="ml-auto flex items-center gap-3 font-mono tabular-nums">
                      <span className="text-sm text-foreground">
                        {isHidden ? "hidden" : format(seg.value)}
                      </span>
                      {!isHidden && (
                        <span className="w-12 text-right text-xs text-muted-foreground">
                          {pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bar */}
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full transition-[width] duration-700 ease-out"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: isHidden ? "#aaa" : seg.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Details modal */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Asset Distribution</DialogTitle>
              <DialogDescription>
                Your assets split across financial worlds. Debts are excluded —
                this is gross holdings, not net worth.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-1">
              {/* Dry powder / cash summary */}
              <div className="rounded-lg border border-[#4d7cc7]/30 bg-[#4d7cc7]/5 px-3 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#4d7cc7]/15">
                      <Wallet className="h-3.5 w-3.5 text-[#4d7cc7]" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">Dry Powder</p>
                      <p className="text-[10px] text-muted-foreground">
                        {cashTotal > 0
                          ? "Capital you've tagged as ready to deploy."
                          : "Tag portfolio holdings or crypto tokens as cash to track your deployable capital."}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-lg font-bold text-[#4d7cc7]">
                      {format(cashTotal)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {cashTotal > 0 && grandTotal > 0
                        ? `${((cashTotal / grandTotal) * 100).toFixed(1)}%`
                        : ""}
                    </span>
                  </div>
                </div>
                {cashTotal === 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                    Go to <span className="font-medium text-foreground">Portfolio</span> →
                    edit a holding → toggle <span className="font-medium text-foreground">Dry Powder</span>,
                    or open <span className="font-medium text-foreground">Crypto</span> → <span className="font-medium text-foreground">Cash</span> in the holdings bar.
                  </p>
                )}
                {cashAllocations.length > 0 && (
                    <div className="mt-2.5 space-y-1 border-t border-[#4d7cc7]/20 pt-2.5">
                      {cashAllocations.map((item, i) => {
                        const itemPct =
                          cashTotal > 0 ? (item.value / cashTotal) * 100 : 0;
                        return (
                          <div
                            key={`cash-${item.label}-${i}`}
                            className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-[#4d7cc7]/8"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/80"
                                  aria-hidden
                                >
                                  {item.source === "portfolio" ? "PF" : "CR"}
                                </span>
                                <span className="font-medium truncate">
                                  {item.label}
                                </span>
                              </div>
                              {item.sublabel && (
                                <span className="ml-6 text-[10px] text-muted-foreground truncate block">
                                  {item.sublabel}
                                </span>
                              )}
                            </div>
                            <div className="flex items-baseline gap-2 shrink-0 font-mono tabular-nums">
                              <span>{format(item.value)}</span>
                              <span className="w-10 text-right text-[10px] text-muted-foreground">
                                {itemPct.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>

              <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Total Assets
                </p>
                <p className="text-xl font-bold tabular-nums">
                  {format(grandTotal)}
                </p>
              </div>

              {segments.map((seg) => {
                const pct = grandTotal > 0 ? (seg.value / grandTotal) * 100 : 0;
                const items = (breakdowns?.[seg.key] ?? [])
                  .filter((i) => i.value > 0)
                  .sort((a, b) => b.value - a.value);
                return (
                  <div
                    key={seg.key}
                    className="rounded-lg border border-border/60 px-3 py-3"
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: seg.color,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{seg.label}</span>
                      <div className="flex items-baseline gap-2 font-mono tabular-nums">
                        <span className="text-base font-semibold">
                          {format(seg.value)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {seg.description}
                    </p>

                    {items.length > 0 && (
                      <div className="mt-2.5 space-y-1 border-t border-border/50 pt-2.5">
                        {items.map((item, i) => {
                          const itemPct =
                            seg.value > 0 ? (item.value / seg.value) * 100 : 0;
                          return (
                            <div
                              key={`${item.label}-${i}`}
                              className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-secondary/40"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="font-medium truncate block">
                                  {item.label}
                                </span>
                                {item.sublabel && (
                                  <span className="text-[10px] text-muted-foreground truncate block">
                                    {item.sublabel}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-baseline gap-2 shrink-0 font-mono tabular-nums">
                                <span>{format(item.value)}</span>
                                <span className="w-10 text-right text-[10px] text-muted-foreground">
                                  {itemPct.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </BlurFade>
  );
}
