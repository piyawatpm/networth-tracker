"use client";

import { useMemo } from "react";
import type { PortfolioHolding, HoldingType } from "@/lib/utils/types";
import { HOLDING_TYPE_LABELS, CHART_COLORS } from "@/lib/utils/constants";
import { BlurFade } from "@/components/ui/blur-fade";
import { InteractiveDonut } from "@/components/ui/interactive-donut";
import { ECHARTS_COLORS } from "@/lib/utils/echarts";
import { LookThroughView } from "@/components/portfolio/look-through-view";
import type { FundAllocations } from "@/components/portfolio/fund-breakdown";
import { HOLDING_TYPE_COLOR_MAP, type PortfolioTotals } from "./portfolio-constants";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PortfolioChartsProps {
  filteredHoldings: PortfolioHolding[];
  totals: PortfolioTotals;
  fundAllocations: FundAllocations;
  format: (value: number, currency?: string) => string;
  convert: (value: number, currency: string) => number;
  baseDelay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortfolioCharts({
  filteredHoldings,
  totals,
  fundAllocations,
  format,
  convert,
  baseDelay,
}: PortfolioChartsProps) {
  // ── Allocation by type ──
  const allocationData = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const h of filteredHoldings) {
      byType[h.type] =
        (byType[h.type] ?? 0) + convert(h.currentValue, h.currency);
    }
    return Object.entries(byType)
      .map(([type, value]) => ({
        name: HOLDING_TYPE_LABELS[type as HoldingType],
        value,
        type: type as HoldingType,
        fill: HOLDING_TYPE_COLOR_MAP[type as HoldingType],
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  // ── Top holdings ──
  const topHoldingsData = useMemo(() => {
    const items = filteredHoldings
      .map((h) => ({
        name: h.ticker || h.name,
        value: convert(h.currentValue, h.currency),
      }))
      .sort((a, b) => b.value - a.value);

    if (items.length <= 7) return items;

    const top6 = items.slice(0, 6);
    const otherValue = items.slice(6).reduce((s, i) => s + i.value, 0);
    return [...top6, { name: "Other", value: otherValue }];
  }, [filteredHoldings, convert]);

  // ── Country allocation ──
  const countryData = useMemo(() => {
    const byCountry: Record<string, number> = {};
    for (const h of filteredHoldings) {
      const key = h.country || "Unknown";
      byCountry[key] = (byCountry[key] ?? 0) + convert(h.currentValue, h.currency);
    }
    return Object.entries(byCountry)
      .map(([country, value]) => ({ name: country, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  // ── Broker breakdown ──
  const brokerBreakdown = useMemo(() => {
    const byBroker: Record<string, { value: number; count: number }> = {};
    for (const h of filteredHoldings) {
      const name = h.broker || "Unknown";
      if (!byBroker[name]) byBroker[name] = { value: 0, count: 0 };
      byBroker[name].value += convert(h.currentValue, h.currency);
      byBroker[name].count += 1;
    }
    return Object.entries(byBroker)
      .map(([broker, d]) => ({ broker, ...d }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHoldings, convert]);

  return (
    <>
      {/* ── Charts Section (3-column) ── */}
      {filteredHoldings.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Allocation by Type */}
          <BlurFade delay={baseDelay * 4}>
            <InteractiveDonut
              title="Allocation by Type"
              data={allocationData.map((d) => ({ name: d.name, value: d.value, color: d.fill }))}
              format={format}
            />
          </BlurFade>

          {/* Top Holdings */}
          <BlurFade delay={baseDelay * 4.5}>
            <InteractiveDonut
              title="Top Holdings"
              data={topHoldingsData.map((d, i) => ({ name: d.name, value: d.value, color: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }))}
              format={format}
            />
          </BlurFade>

          {/* Country / Region */}
          <BlurFade delay={baseDelay * 5}>
            <InteractiveDonut
              title="By Country"
              data={countryData.map((d, i) => ({ name: d.name, value: d.value, color: ECHARTS_COLORS[i % ECHARTS_COLORS.length] }))}
              format={format}
            />
          </BlurFade>
        </div>
      )}

      {/* ── Broker Breakdown ── */}
      {brokerBreakdown.length > 0 && (
        <BlurFade delay={baseDelay * 5.5}>
          <div className="finance-card px-3 py-4 sm:p-6">
            <p className="label-mono mb-4">By Broker</p>
            <div className="space-y-2.5">
              {brokerBreakdown.map((b, i) => {
                const pct = totals.totalValue > 0 ? (b.value / totals.totalValue) * 100 : 0;
                const color = CHART_COLORS[i % CHART_COLORS.length];
                return (
                  <div key={b.broker} className="space-y-1">
                    <div className="flex items-center justify-between text-sm gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate">{b.broker}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {b.count}
                        </span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground shrink-0">
                        {format(b.value)} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </BlurFade>
      )}

      {/* ── Look-Through Exposure ── */}
      {filteredHoldings.length > 0 && (
        <BlurFade delay={baseDelay * 6}>
          <LookThroughView holdings={filteredHoldings} allocations={fundAllocations} />
        </BlurFade>
      )}
    </>
  );
}
