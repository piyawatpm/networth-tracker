"use client";

import { useState, useMemo, useEffect } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import type { PortfolioHolding, HoldingType, AccountType } from "@/lib/utils/types";
import { HOLDING_TYPE_LABELS, CHART_COLORS } from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Plus, Pencil, Trash2, Briefcase, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HoldingDialog } from "@/components/portfolio/holding-dialog";

const HOLDING_TYPES: HoldingType[] = ["stock", "etf", "fund", "bond", "other"];
const ACCOUNT_TYPES: AccountType[] = ["normal", "super"];

const HOLDING_TYPE_COLOR_MAP: Record<HoldingType, string> = {
  stock: CHART_COLORS[0],
  etf: CHART_COLORS[1],
  fund: CHART_COLORS[2],
  bond: CHART_COLORS[3],
  other: CHART_COLORS[4],
};

interface PortfolioSnapshot {
  date: string;
  value: number;
  valueWithSuper: number;
}

export default function PortfolioPage() {
  const [holdings, setHoldings] = useLocalStorage<PortfolioHolding[]>(
    "portfolio_holdings",
    []
  );
  const [snapshots, setSnapshots] = useLocalStorage<PortfolioSnapshot[]>(
    "portfolio_snapshots",
    []
  );
  const { format, convert, currency, symbol } = useCurrency();

  const [includeSuper, setIncludeSuper] = useState(true);
  const [typeFilter, setTypeFilter] = useState<HoldingType | "all">("all");
  const [accountFilter, setAccountFilter] = useState<AccountType | "all">(
    "all"
  );
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Filter holdings
  const filteredHoldings = useMemo(() => {
    let result = holdings;
    if (!includeSuper) result = result.filter((h) => h.accountType !== "super");
    if (typeFilter !== "all") result = result.filter((h) => h.type === typeFilter);
    if (accountFilter !== "all")
      result = result.filter((h) => h.accountType === accountFilter);
    return result;
  }, [holdings, includeSuper, typeFilter, accountFilter]);

  // Totals
  const totals = useMemo(() => {
    const totalValue = filteredHoldings.reduce(
      (s, h) => s + convert(h.currentValue, h.currency),
      0
    );
    const totalInvested = filteredHoldings.reduce(
      (s, h) => s + convert(h.amountInvested, h.currency),
      0
    );
    const pnl = totalValue - totalInvested;
    const pnlPercent = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
    return {
      totalValue,
      totalInvested,
      pnl,
      pnlPercent,
      count: filteredHoldings.length,
    };
  }, [filteredHoldings, convert]);

  // Record daily snapshot
  useEffect(() => {
    if (holdings.length === 0) return;
    const today = getSydneyDateString();
    const alreadyRecorded = snapshots.some((s) => s.date === today);
    if (alreadyRecorded) return;

    const valueNoSuper = holdings
      .filter((h) => h.accountType !== "super")
      .reduce((s, h) => s + convert(h.currentValue, h.currency), 0);
    const valueAll = holdings.reduce(
      (s, h) => s + convert(h.currentValue, h.currency),
      0
    );

    setSnapshots((prev) => [
      ...prev.slice(-89), // keep last 90 days
      { date: today, value: valueNoSuper, valueWithSuper: valueAll },
    ]);
  }, [holdings, snapshots, setSnapshots, convert]);

  // Trend chart data
  const trendData = useMemo(() => {
    return snapshots.map((s) => ({
      date: s.date.slice(5), // MM-DD
      value: includeSuper ? s.valueWithSuper : s.value,
    }));
  }, [snapshots, includeSuper]);

  const trendConfig: ChartConfig = {
    value: { label: "Portfolio Value", color: "var(--accent)" },
  };

  // Allocation data
  const allocationData = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const h of filteredHoldings) {
      byType[h.type] = (byType[h.type] ?? 0) + convert(h.currentValue, h.currency);
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

  const chartConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const d of allocationData) {
      config[d.name] = { label: d.name, color: d.fill };
    }
    return config;
  }, [allocationData]);

  // Broker breakdown
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

  function handleSave(h: PortfolioHolding) {
    setHoldings((prev) => {
      const idx = prev.findIndex((p) => p.id === h.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = h;
        return updated;
      }
      return [...prev, h];
    });
  }

  function handleDelete(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
    setDeleteConfirmId(null);
  }

  const DELAY = 0.05;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <BlurFade delay={0}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-mono mb-2">Portfolio</p>
            <div className="display-number">
              {totals.totalValue > 0 ? (
                <NumberTicker
                  value={totals.totalValue}
                  prefix={symbol}
                  decimalPlaces={0}
                />
              ) : (
                <span>{symbol}0</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Include Super Toggle */}
            <button
              onClick={() => setIncludeSuper(!includeSuper)}
              className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>Include Super</span>
              <span
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                  includeSuper ? "bg-income" : "bg-border"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                    includeSuper ? "translate-x-[18px]" : "translate-x-[3px]"
                  )}
                />
              </span>
            </button>

            {/* Add Holding */}
            <HoldingDialog
              onSave={handleSave}
              trigger={
                <Button className="gap-1.5 rounded-full px-4">
                  <Plus className="h-4 w-4" data-icon="inline-start" />
                  Add Holding
                </Button>
              }
            />
          </div>
        </div>
      </BlurFade>

      {/* Summary Tile */}
      <BlurFade delay={DELAY}>
        <div className="finance-card p-5">
          <div className="flex items-center divide-x divide-border">
            <div className="pr-6">
              <p className="label-mono mb-1">Total Value</p>
              <p className="text-lg font-semibold tabular-nums">
                {format(totals.totalValue)}
              </p>
            </div>
            <div className="px-6">
              <p className="label-mono mb-1">Invested</p>
              <p className="text-lg font-semibold tabular-nums">
                {format(totals.totalInvested)}
              </p>
            </div>
            <div className="px-6">
              <p className="label-mono mb-1">P&L</p>
              <p
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  totals.pnl >= 0 ? "text-income" : "text-expense"
                )}
              >
                {totals.pnl >= 0 ? "+" : ""}
                {format(totals.pnl)}
                <span className="ml-1 text-sm font-normal">
                  ({totals.pnl >= 0 ? "+" : ""}
                  {totals.pnlPercent.toFixed(1)}%)
                </span>
              </p>
            </div>
            <div className="pl-6">
              <p className="label-mono mb-1">Holdings</p>
              <p className="text-lg font-semibold tabular-nums">
                {totals.count}
              </p>
            </div>
          </div>
        </div>
      </BlurFade>

      {/* Value Trend Chart */}
      <BlurFade delay={DELAY * 2}>
        <div className="finance-card p-6">
          <p className="label-mono mb-4">Value Trend</p>
          {trendData.length > 1 ? (
            <ChartContainer config={trendConfig} className="h-48 w-full">
              <AreaChart
                data={trendData}
                margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  className="stroke-border/40"
                />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  className="text-xs"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => {
                    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
                    return String(v);
                  }}
                  className="text-xs"
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span className="font-mono tabular-nums font-medium">
                          {format(Number(value))}
                        </span>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#portfolioGrad)"
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="flex h-48 items-center justify-center">
              <p className="text-sm text-muted-foreground/50">
                {trendData.length === 1
                  ? "Come back tomorrow to see your trend line"
                  : "Add holdings to start tracking value over time"}
              </p>
            </div>
          )}
        </div>
      </BlurFade>

      {/* Filter Pills */}
      <BlurFade delay={DELAY * 3}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-mono mr-1">Type</span>
            {(["all", ...HOLDING_TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                  typeFilter === t
                    ? "bg-foreground/[0.06] text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                )}
              >
                {t === "all" ? "All" : HOLDING_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-mono mr-1">Account</span>
            {(["all", ...ACCOUNT_TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setAccountFilter(t)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors capitalize",
                  accountFilter === t
                    ? "bg-foreground/[0.06] text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                )}
              >
                {t === "all" ? "All" : t === "normal" ? "Normal" : "Super"}
              </button>
            ))}
          </div>
        </div>
      </BlurFade>

      {/* Charts & Broker Row */}
      {filteredHoldings.length > 0 && (
        <div className="grid gap-6 md:grid-cols-12">
          {/* Allocation Donut */}
          <BlurFade delay={DELAY * 4} className="md:col-span-5">
            <div className="finance-card p-5">
              <p className="label-mono mb-4">Allocation by Type</p>
              {allocationData.length > 0 ? (
                <div className="flex items-center gap-6">
                  <ChartContainer
                    config={chartConfig}
                    className="aspect-square w-36 shrink-0"
                  >
                    <PieChart>
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            hideLabel
                            formatter={(value, name) => (
                              <div className="flex items-center justify-between gap-4 w-full">
                                <span className="text-muted-foreground">{name}</span>
                                <span className="font-mono tabular-nums font-medium">
                                  {format(Number(value))}
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      <Pie
                        data={allocationData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="55%"
                        outerRadius="90%"
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {allocationData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="flex-1 space-y-1.5">
                    {allocationData.map((d) => (
                      <div key={d.type} className="flex items-center gap-2 text-sm">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: d.fill }}
                        />
                        <span className="text-muted-foreground truncate">{d.name}</span>
                        <span className="ml-auto font-mono tabular-nums text-xs whitespace-nowrap">
                          {format(d.value, undefined, true)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  No data
                </div>
              )}
            </div>
          </BlurFade>

          {/* Broker Breakdown */}
          <BlurFade delay={DELAY * 5} className="md:col-span-7">
            <div className="finance-card p-5 h-full">
              <p className="label-mono mb-4">By Broker</p>
              {brokerBreakdown.length > 0 ? (
                <div className="divide-y divide-border">
                  {brokerBreakdown.map((b) => (
                    <div
                      key={b.broker}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="text-sm font-medium">{b.broker}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.count} holding{b.count !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">
                        {format(b.value)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  No brokers
                </div>
              )}
            </div>
          </BlurFade>
        </div>
      )}

      {/* Holdings Cards */}
      <BlurFade delay={DELAY * 6}>
        <div className="space-y-3">
          <p className="label-mono">Holdings ({filteredHoldings.length})</p>

          {filteredHoldings.length === 0 ? (
            <div className="finance-card flex flex-col items-center justify-center gap-3 py-16">
              <Briefcase className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No holdings yet. Add your first one.
              </p>
              <HoldingDialog
                onSave={handleSave}
                trigger={
                  <Button variant="outline" className="rounded-full gap-1.5">
                    <Plus className="h-4 w-4" data-icon="inline-start" />
                    Add Holding
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHoldings
                .sort(
                  (a, b) =>
                    convert(b.currentValue, b.currency) -
                    convert(a.currentValue, a.currency)
                )
                .map((h, i) => {
                  const invested = convert(h.amountInvested, h.currency);
                  const current = convert(h.currentValue, h.currency);
                  const pnl = current - invested;
                  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

                  return (
                    <BlurFade key={h.id} delay={DELAY * 6 + i * 0.03}>
                      <div className="finance-card p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-sm font-semibold">
                                {h.name}
                              </h3>
                              {h.ticker && (
                                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                  {h.ticker}
                                </span>
                              )}
                              {h.link && (
                                <a
                                  href={h.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="secondary">
                                {HOLDING_TYPE_LABELS[h.type]}
                              </Badge>
                              {h.accountType === "super" && (
                                <Badge variant="outline">Super</Badge>
                              )}
                              {h.broker && (
                                <span className="text-xs text-muted-foreground">
                                  {h.broker}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-start gap-6 text-right">
                            <div className="hidden sm:block">
                              <p className="label-mono mb-0.5">Units</p>
                              <p className="text-sm tabular-nums">
                                {h.units.toLocaleString("en-US", {
                                  maximumFractionDigits: 4,
                                })}
                              </p>
                            </div>
                            <div className="hidden sm:block">
                              <p className="label-mono mb-0.5">Invested</p>
                              <p className="text-sm tabular-nums">
                                {format(h.amountInvested, h.currency)}
                              </p>
                            </div>
                            <div>
                              <p className="label-mono mb-0.5">Value</p>
                              <p className="text-sm font-semibold tabular-nums">
                                {format(h.currentValue, h.currency)}
                              </p>
                            </div>
                            <div>
                              <p className="label-mono mb-0.5">P&L</p>
                              <p
                                className={cn(
                                  "text-sm font-semibold tabular-nums",
                                  pnl >= 0 ? "text-income" : "text-expense"
                                )}
                              >
                                {pnl >= 0 ? "+" : ""}
                                {format(pnl)}
                                <span className="ml-1 text-xs font-normal">
                                  {pnl >= 0 ? "+" : ""}
                                  {pnlPct.toFixed(1)}%
                                </span>
                              </p>
                            </div>

                            <div className="flex items-center gap-0.5">
                              <HoldingDialog
                                holding={h}
                                onSave={handleSave}
                                trigger={
                                  <Button variant="ghost" size="icon-xs">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                }
                              />
                              {deleteConfirmId === h.id ? (
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="destructive"
                                    size="xs"
                                    onClick={() => handleDelete(h.id)}
                                  >
                                    Confirm
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={() => setDeleteConfirmId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => setDeleteConfirmId(h.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </BlurFade>
                  );
                })}
            </div>
          )}
        </div>
      </BlurFade>
    </div>
  );
}
