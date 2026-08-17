"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import { ReactECharts } from "@/components/ui/lazy-echarts";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ECHARTS_COLORS, getCartesianBaseOption } from "@/lib/utils/echarts";
import { getLastNMonthKeys, getMonthKey } from "@/lib/utils/timezone";
import type { IncomeEntry, ExpenseEntry } from "@/lib/utils/types";
import { cn } from "@/lib/utils";
import { Telescope, Pencil, Plus, Flag, TrendingUp, Sparkles, ArrowRight } from "lucide-react";
import {
  DEFAULT_ASSUMPTIONS, FALLBACK_RETURN_PCT, MEASURED_PACE_MIN_DAYS, RETURN_PRESETS,
  type ForecastAssumptions, type ForecastInputs,
  describeMonths, measuredAnnualPacePct, measuredMonthlySaving,
  monthsToReach, projectPath, requiredAnnualReturn, requiredMonthlySaving,
} from "@/lib/utils/forecast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Same shape the dashboard's GoalSection stores; targetDate is new. */
interface Goal {
  id: string;
  name: string;
  amount: number;
  currency: string;
  setAt: number;
  achievedAt: number | null;
  /** Optional deadline, yyyy-MM-dd — turns the page into a planner. */
  targetDate?: string | null;
}

interface SnapshotRow { date: string; value: number; currency?: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addMonths(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

function monthYear(d: Date): string {
  return d.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

function monthsUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
}

// ---------------------------------------------------------------------------
// Goal dialog (create / edit, incl. the deadline)
// ---------------------------------------------------------------------------

function GoalEditor({
  goal, open, onOpenChange, onSave,
}: {
  goal: Goal | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (g: Omit<Goal, "id" | "setAt" | "achievedAt">) => void;
}) {
  const { enabledCurrencies, currency: displayCurrency } = useCurrency();
  const [name, setName] = useState(goal?.name ?? "");
  const [amount, setAmount] = useState(goal?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState(goal?.currency ?? displayCurrency);
  const [year, setYear] = useState(goal?.targetDate ? goal.targetDate.slice(0, 4) : "");

  // Re-seed whenever a different goal is opened.
  const seedKey = `${goal?.id ?? "new"}-${open}`;
  const [seeded, setSeeded] = useState(seedKey);
  if (seeded !== seedKey) {
    setSeeded(seedKey);
    setName(goal?.name ?? "");
    setAmount(goal?.amount?.toString() ?? "");
    setCurrency(goal?.currency ?? displayCurrency);
    setYear(goal?.targetDate ? goal.targetDate.slice(0, 4) : "");
  }

  function save() {
    const parsed = parseFloat(amount.replace(/,/g, ""));
    if (!parsed || parsed <= 0) return;
    const y = parseInt(year, 10);
    onSave({
      name: name.trim() || "Net worth goal",
      amount: parsed,
      currency,
      targetDate: y && y > new Date().getFullYear() ? `${y}-12-31` : null,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New goal"}</DialogTitle>
          <DialogDescription>A net worth target — with a deadline if you want a plan, without one if you want a forecast.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 100M baht" />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label>Target</Label>
              <Input type="number" min="0" step="1000" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000000" className="tabular-nums" />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(v: string | null) => v && setCurrency(v)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {enabledCurrencies.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>By year <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input type="number" min={new Date().getFullYear() + 1} value={year} onChange={(e) => setYear(e.target.value)} placeholder="leave empty for “when will I get there?”" className="tabular-nums" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={save}>{goal ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ForecastPage() {
  const { convert, format, symbol, currency: displayCurrency } = useCurrency();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [goals, setGoals] = useCloudStorage<Goal[]>("networth_goals", []);
  const [assumptions, setAssumptions] = useCloudStorage<ForecastAssumptions>("forecast_assumptions", DEFAULT_ASSUMPTIONS);
  const [snapshots] = useCloudStorage<SnapshotRow[]>("networth_snapshots", []);
  const [incomeEntries] = useCloudStorage<IncomeEntry[]>("income_entries", []);
  const [expenseEntries] = useCloudStorage<ExpenseEntry[]>("expense_entries", []);

  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [planYear, setPlanYear] = useState<number | null>(null);

  // ── Net worth now + measured pace, from the snapshot series ──
  const nwSeries = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const s of snapshots) {
      if (!(s.value > 0)) continue;
      byDay.set(String(s.date).slice(0, 10), convert(s.value, s.currency ?? "USD"));
    }
    return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [snapshots, convert]);

  const netWorth = nwSeries.at(-1)?.[1] ?? 0;
  const latestDay = nwSeries.at(-1)?.[0] ?? null;

  const measured = useMemo(() => {
    if (nwSeries.length < 2 || !latestDay) return { pacePct: null as number | null, days: 0, saving: null as number | null };
    // Window: up to 180 days back, or as far as history goes.
    const wanted = new Date(Date.now() - 180 * 86400e3).toISOString().slice(0, 10);
    const startRow = nwSeries.find(([d]) => d >= wanted) ?? nwSeries[0];
    const days = (Date.parse(latestDay) - Date.parse(startRow[0])) / 86400e3;
    const inWindow = (d: string) => d >= startRow[0] && d <= latestDay;
    const income = incomeEntries.filter((e) => inWindow(e.date)).reduce((s, e) => s + convert(e.amount, e.currency), 0);
    const spent = expenseEntries.filter((e) => inWindow(e.date)).reduce((s, e) => s + convert(e.amount, e.currency), 0);
    const pacePct = measuredAnnualPacePct({ nwStart: startRow[1], nwEnd: netWorth, netSavingsInWindow: income - spent, windowDays: days });

    // Monthly saving from the last six complete months.
    const monthly = getLastNMonthKeys(7).slice(0, 6).map((mk) => ({
      income: incomeEntries.filter((e) => getMonthKey(e.date) === mk).reduce((s, e) => s + convert(e.amount, e.currency), 0),
      expenses: expenseEntries.filter((e) => getMonthKey(e.date) === mk).reduce((s, e) => s + convert(e.amount, e.currency), 0),
    }));
    return { pacePct, days, saving: measuredMonthlySaving(monthly) };
  }, [nwSeries, latestDay, netWorth, incomeEntries, expenseEntries, convert]);

  // ── Effective inputs: assumptions override the measured values ──
  // The measured pace only LEADS once a full year stands behind it — four
  // months of a crypto dip annualised must not headline a 15-year forecast.
  // Under a year it stays a chip; the balanced preset is the default.
  const monthlySaving = assumptions.monthlySaving ?? measured.saving ?? 0;
  const measuredDefault = measured.days >= MEASURED_PACE_MIN_DAYS ? measured.pacePct : null;
  const returnPct = assumptions.annualReturnPct ?? measuredDefault ?? FALLBACK_RETURN_PCT;
  const usingMeasuredReturn = measured.pacePct != null && Math.abs(returnPct - measured.pacePct) < 1e-4;
  const usingPreset = (pct: number) => !usingMeasuredReturn && Math.abs(returnPct - pct) < 1e-4;
  const inputs: ForecastInputs = { netWorth, monthlySaving, annualReturnPct: returnPct, contributionGrowthPct: assumptions.contributionGrowthPct };

  // ── Goal ──
  const activeGoals = goals.filter((g) => !g.achievedAt);
  const goal = activeGoals.find((g) => g.id === selectedGoalId)
    ?? activeGoals.slice().sort((a, b) => convert(a.amount, a.currency) - convert(b.amount, b.currency))[0]
    ?? null;
  const target = goal ? convert(goal.amount, goal.currency) : 0;
  const progress = target > 0 ? Math.min(1, netWorth / target) : 0;
  const etaMonths = goal ? monthsToReach(inputs, target) : null;

  // Deadline: the goal's own, else the planner's pick, else nothing.
  const deadlineMonths = goal?.targetDate
    ? monthsUntil(goal.targetDate)
    : planYear
      ? monthsUntil(`${planYear}-12-31`)
      : null;
  const plan = useMemo(() => {
    if (!goal || deadlineMonths == null || deadlineMonths <= 0) return null;
    const needSaving = requiredMonthlySaving({ netWorth, annualReturnPct: returnPct, contributionGrowthPct: inputs.contributionGrowthPct }, target, deadlineMonths);
    const needReturn = requiredAnnualReturn({ netWorth, monthlySaving, contributionGrowthPct: inputs.contributionGrowthPct }, target, deadlineMonths);
    return { needSaving, needReturn, onTrack: etaMonths != null && etaMonths <= deadlineMonths };
  }, [goal, deadlineMonths, netWorth, returnPct, monthlySaving, target, etaMonths, inputs.contributionGrowthPct]);

  // ── Chart ──
  const chart = useMemo(() => {
    const horizon = Math.min(40 * 12, Math.max(24, (etaMonths ?? 20 * 12) + 24));
    const { withGrowth, savingsOnly } = projectPath(inputs, horizon);
    const now = new Date();
    const labels = withGrowth.map((_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    return { labels, withGrowth, savingsOnly, horizon };
  }, [inputs, etaMonths]);

  const chartOption = useMemo(() => {
    const base = getCartesianBaseOption(isDark, symbol);
    const compact = (v: number) => format(v, undefined, true);
    return {
      ...base,
      grid: { ...base.grid, left: 64, right: 16, top: 16 },
      xAxis: {
        ...base.xAxis,
        type: "category" as const,
        data: chart.labels,
        axisLabel: { ...base.xAxis.axisLabel, formatter: (v: string, i: number) => (i % 12 === 0 ? v.slice(0, 4) : ""), interval: 0 },
      },
      yAxis: { ...base.yAxis, type: "value" as const, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => compact(v) } },
      tooltip: {
        ...base.tooltip,
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          const head = `<div style="font-size:11px;opacity:.7;margin-bottom:4px">${params[0]?.axisValue ?? ""}</div>`;
          return head + params.map((p) => `<div style="display:flex;justify-content:space-between;gap:16px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName}</span><b>${compact(p.value)}</b></div>`).join("");
        },
      },
      series: [
        {
          name: "With growth", type: "line", data: chart.withGrowth, showSymbol: false, smooth: false,
          lineStyle: { width: 2, color: ECHARTS_COLORS[0] },
          areaStyle: { color: ECHARTS_COLORS[0], opacity: 0.08 },
          markLine: target > 0 ? {
            silent: true, symbol: "none",
            lineStyle: { type: "dashed", color: ECHARTS_COLORS[6], opacity: 0.8 },
            label: { formatter: goal?.name ?? "goal", position: "insideEndTop", fontSize: 10 },
            data: [{ yAxis: target }],
          } : undefined,
          markPoint: etaMonths != null && etaMonths <= chart.horizon ? {
            symbol: "circle", symbolSize: 10,
            itemStyle: { color: ECHARTS_COLORS[6] },
            label: { show: false },
            data: [{ coord: [etaMonths, chart.withGrowth[etaMonths]] }],
          } : undefined,
        },
        {
          name: "Savings only", type: "line", data: chart.savingsOnly, showSymbol: false,
          lineStyle: { width: 1.5, type: "dashed", color: ECHARTS_COLORS[2], opacity: 0.9 },
        },
      ],
    };
  }, [chart, isDark, symbol, format, target, goal?.name, etaMonths]);

  // ── Paths table: ETA under each return assumption ──
  const paths = useMemo(() => {
    if (!goal) return [];
    const rows: { label: string; pct: number; months: number | null; note: string; active: boolean }[] = [];
    if (measured.pacePct != null) {
      rows.push({ label: "Your pace", pct: measured.pacePct, months: monthsToReach({ ...inputs, annualReturnPct: measured.pacePct }, target), note: `measured over ${Math.round(measured.days)} days`, active: usingMeasuredReturn });
    }
    for (const p of RETURN_PRESETS) {
      rows.push({ label: p.label, pct: p.pct, months: monthsToReach({ ...inputs, annualReturnPct: p.pct }, target), note: p.note, active: usingPreset(p.pct) });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, measured, inputs, target, usingMeasuredReturn, returnPct]);

  // ── Sensitivity: what one notch on each lever buys ──
  const sensitivity = useMemo(() => {
    if (!goal || etaMonths == null) return [];
    const bump = Math.max(1000, Math.round((monthlySaving * 0.1) / 1000) * 1000);
    const out: { label: string; months: number | null }[] = [
      { label: `+${format(bump, undefined, true)}/mo saved`, months: monthsToReach({ ...inputs, monthlySaving: monthlySaving + bump }, target) },
      { label: "+1% yearly return", months: monthsToReach({ ...inputs, annualReturnPct: returnPct + 1 }, target) },
      { label: "+3% raise each year", months: monthsToReach({ ...inputs, contributionGrowthPct: inputs.contributionGrowthPct + 3 }, target) },
    ];
    return out.map((o) => ({ ...o, saved: o.months == null ? null : etaMonths - o.months }));
  }, [goal, etaMonths, monthlySaving, inputs, target, returnPct, format]);

  // ── Composition at goal: how much is deposits vs growth ──
  const composition = useMemo(() => {
    if (!goal || etaMonths == null) return null;
    const { withGrowth, savingsOnly } = projectPath(inputs, etaMonths);
    const deposits = savingsOnly[etaMonths] - netWorth;
    const growth = withGrowth[etaMonths] - savingsOnly[etaMonths];
    return { deposits, growth, start: netWorth };
  }, [goal, etaMonths, inputs, netWorth]);

  function saveGoal(data: Omit<Goal, "id" | "setAt" | "achievedAt">) {
    if (editingGoal) {
      setGoals((prev) => prev.map((g) => (g.id === editingGoal.id ? { ...g, ...data, achievedAt: null } : g)));
    } else {
      const g: Goal = { ...data, id: crypto.randomUUID(), setAt: Date.now(), achievedAt: null };
      setGoals((prev) => [...prev, g]);
      setSelectedGoalId(g.id);
    }
  }

  const eta = etaMonths == null ? null : addMonths(etaMonths);
  const chip = (active: boolean) => cn(
    "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border",
    active ? "bg-foreground text-background border-foreground" : "bg-secondary/60 text-secondary-foreground border-transparent hover:bg-secondary",
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <BlurFade delay={0}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Telescope className="h-4 w-4 text-muted-foreground" />
              <p className="label-mono">Forecast</p>
            </div>
            <p className="text-sm text-muted-foreground max-w-xl">
              Where your net worth is heading if you keep saving like this and your assets keep growing — and what one notch on each lever would change.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeGoals.length > 1 && (
              <div className="flex items-center gap-1 flex-wrap">
                {activeGoals.map((g) => (
                  <button key={g.id} onClick={() => setSelectedGoalId(g.id)} className={chip(goal?.id === g.id)}>
                    {g.name || format(g.amount, g.currency, true)}
                  </button>
                ))}
              </div>
            )}
            {goal && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditingGoal(goal); setEditorOpen(true); }}>
                <Pencil className="h-3 w-3" /> Edit goal
              </Button>
            )}
            <Button size="sm" className="gap-1.5" onClick={() => { setEditingGoal(null); setEditorOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> New goal
            </Button>
          </div>
        </div>
      </BlurFade>

      {/* Hero */}
      <BlurFade delay={0.05}>
        <div className="finance-card p-5">
          {!goal ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Flag className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium">Set a target to forecast against</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Say “100M baht” and the page will tell you when you get there at this pace, and what it would take to get there sooner.
              </p>
              <Button size="sm" className="mt-1 gap-1.5" onClick={() => { setEditingGoal(null); setEditorOpen(true); }}>
                <Plus className="h-3.5 w-3.5" /> New goal
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <p className="label-mono mb-1">{goal.name || "Goal"} · {format(goal.amount, goal.currency, true)}</p>
                {etaMonths === 0 ? (
                  <p className="display-number text-income">You&apos;re there.</p>
                ) : etaMonths == null ? (
                  <>
                    <p className="display-number text-expense">Not on this path</p>
                    <p className="text-xs text-muted-foreground mt-1">Net worth isn&apos;t growing toward the goal at these inputs — raise the saving or the return below to see when it could.</p>
                  </>
                ) : (
                  <>
                    <p className="display-number">{monthYear(eta!)}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      <span className="text-foreground font-medium">{describeMonths(etaMonths)}</span> from now,
                      saving <span className="text-foreground font-medium">{format(monthlySaving, undefined, true)}/mo</span> at{" "}
                      <span className="text-foreground font-medium">{returnPct.toFixed(1)}%/yr</span>
                      {usingMeasuredReturn ? " (your measured pace)" : ""}
                    </p>
                  </>
                )}
              </div>
              <div className="min-w-[220px]">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="tabular-nums">{format(netWorth, undefined, true)} <span className="text-muted-foreground">of {format(target, undefined, true)}</span></span>
                  <span className="font-semibold tabular-nums">{(progress * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-income transition-all duration-700" style={{ width: `${progress * 100}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">{format(Math.max(0, target - netWorth), undefined, true)} to go</p>
              </div>
            </div>
          )}
        </div>
      </BlurFade>

      {goal && (
        <>
          {/* Chart */}
          <BlurFade delay={0.1}>
            <div className="finance-card p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="label-mono">Projected net worth</p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: ECHARTS_COLORS[0] }} /> with growth</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-0 w-4 border-t border-dashed" style={{ borderColor: ECHARTS_COLORS[2] }} /> savings only</span>
                </div>
              </div>
              <ReactECharts option={chartOption} style={{ height: 280 }} notMerge />
              <p className="text-[10px] text-muted-foreground mt-1">
                The gap between the two lines is compounding — the part of the goal your money earns for you. Contributions land at month end; return compounds monthly.
              </p>
            </div>
          </BlurFade>

          {/* Levers + Paths */}
          <div className="grid gap-5 lg:grid-cols-2">
            <BlurFade delay={0.15}>
              <div className="finance-card p-5 space-y-5">
                <p className="label-mono">Your levers</p>

                {/* Monthly saving */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-xs">Monthly saving <span className="text-muted-foreground font-normal">(income − expenses)</span></Label>
                    {measured.saving != null && assumptions.monthlySaving != null && (
                      <button className="text-[10px] text-muted-foreground underline" onClick={() => setAssumptions((a) => ({ ...a, monthlySaving: null }))}>
                        reset to measured {format(measured.saving, undefined, true)}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{symbol}</span>
                    <Input
                      type="number" step="1000" className="tabular-nums"
                      value={Math.round(monthlySaving)}
                      onChange={(e) => setAssumptions((a) => ({ ...a, monthlySaving: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {measured.saving != null
                      ? `Measured: ${format(measured.saving, undefined, true)}/mo over the last six months where both income and expenses were logged.`
                      : "Not enough ledger history to measure — type what you save."}
                  </p>
                </div>

                {/* Return */}
                <div>
                  <Label className="text-xs">Yearly return on everything you own</Label>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {measured.pacePct != null && (
                      <button className={chip(usingMeasuredReturn)} onClick={() => setAssumptions((a) => ({ ...a, annualReturnPct: measured.pacePct }))}>
                        Your pace {measured.pacePct >= 0 ? "+" : ""}{measured.pacePct.toFixed(1)}%
                      </button>
                    )}
                    {RETURN_PRESETS.map((p) => (
                      <button key={p.pct} className={chip(usingPreset(p.pct))} onClick={() => setAssumptions((a) => ({ ...a, annualReturnPct: p.pct }))} title={p.note}>
                        {p.label} {p.pct}%
                      </button>
                    ))}
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" step="0.5" className="h-7 w-20 tabular-nums text-xs"
                        value={returnPct.toFixed(1)}
                        onChange={(e) => setAssumptions((a) => ({ ...a, annualReturnPct: parseFloat(e.target.value) || 0 }))}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {measured.pacePct != null
                      ? `Your pace = how fast net worth grew beyond what you deposited, over the last ${Math.round(measured.days)} days${measured.days < 365 ? " — a short window; treat it as a mood, not a law. The presets are long-run assumptions." : "."}`
                      : "Not enough net-worth history to measure your own pace yet (needs 90+ days). Presets are long-run assumptions."}
                  </p>
                </div>

                {/* Contribution growth */}
                <div>
                  <Label className="text-xs">Saving grows each year <span className="text-muted-foreground font-normal">(raises, bots scaling)</span></Label>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Input
                      type="number" step="1" className="h-8 w-24 tabular-nums"
                      value={assumptions.contributionGrowthPct}
                      onChange={(e) => setAssumptions((a) => ({ ...a, contributionGrowthPct: parseFloat(e.target.value) || 0 }))}
                    />
                    <span className="text-xs text-muted-foreground">% per year</span>
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground border-t border-border/50 pt-3">
                  Net worth today {format(netWorth, undefined, true)}{latestDay ? ` (snapshot ${latestDay})` : ""} · assumptions sync to your phone.
                </p>
              </div>
            </BlurFade>

            <BlurFade delay={0.2}>
              <div className="finance-card p-5">
                <p className="label-mono mb-3">Paths to {format(goal.amount, goal.currency, true)}</p>
                <div className="divide-y divide-border/50">
                  {paths.map((p) => (
                    <div key={p.label} className={cn("flex items-center justify-between py-2.5 text-sm", p.active && "font-medium")}>
                      <div className="min-w-0">
                        <span>{p.label} <span className="text-muted-foreground tabular-nums">{p.pct >= 0 ? "+" : ""}{p.pct.toFixed(1)}%/yr</span></span>
                        <p className="text-[10px] text-muted-foreground">{p.note}</p>
                      </div>
                      <div className="text-right tabular-nums shrink-0">
                        {p.months == null ? (
                          <span className="text-expense text-xs">not on this path</span>
                        ) : (
                          <>
                            <span>{monthYear(addMonths(p.months))}</span>
                            <p className="text-[10px] text-muted-foreground">{describeMonths(p.months)}</p>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {sensitivity.length > 0 && (
                  <>
                    <p className="label-mono mt-5 mb-2">What moves the needle</p>
                    <div className="grid gap-1.5">
                      {sensitivity.map((s) => (
                        <div key={s.label} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2 text-xs">
                          <span className="flex items-center gap-1.5"><TrendingUp className="h-3 w-3 text-income" />{s.label}</span>
                          <span className="tabular-nums font-medium text-income">
                            {s.saved == null ? "—" : s.saved <= 0 ? "no change" : `${describeMonths(s.saved)} sooner`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </BlurFade>
          </div>

          {/* Planner */}
          <BlurFade delay={0.25}>
            <div className="finance-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <p className="label-mono">Reach it by</p>
                {goal.targetDate ? (
                  <span className="text-xs text-muted-foreground">Deadline on the goal: <b className="text-foreground">{goal.targetDate.slice(0, 4)}</b> · <button className="underline" onClick={() => { setEditingGoal(goal); setEditorOpen(true); }}>change</button></span>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[3, 5, 10, 15, 20].map((y) => {
                      const yr = new Date().getFullYear() + y;
                      return (
                        <button key={y} className={chip(planYear === yr)} onClick={() => setPlanYear(planYear === yr ? null : yr)}>{yr}</button>
                      );
                    })}
                  </div>
                )}
              </div>
              {!plan ? (
                <p className="text-sm text-muted-foreground">Pick a year to see what it would take.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className={cn("rounded-lg border p-3", plan.onTrack ? "border-income/30 bg-income/5" : "border-border/60")}>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Current pace</p>
                    <p className={cn("text-lg font-bold tabular-nums", plan.onTrack ? "text-income" : "text-expense")}>
                      {plan.onTrack ? "On track" : etaMonths == null ? "Never" : `${describeMonths(etaMonths - (deadlineMonths ?? 0))} late`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {etaMonths == null ? "not on this path" : `arrives ${monthYear(addMonths(etaMonths))}`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 p-3">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Or save</p>
                    <p className="text-lg font-bold tabular-nums">{plan.needSaving == null ? "—" : `${format(plan.needSaving, undefined, true)}/mo`}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {plan.needSaving == null ? "no saving gets there in time" : `${plan.needSaving - monthlySaving >= 0 ? "+" : ""}${format(plan.needSaving - monthlySaving, undefined, true)} vs now, at ${returnPct.toFixed(1)}%`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 p-3">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Or earn</p>
                    <p className="text-lg font-bold tabular-nums">{plan.needReturn == null ? "—" : `${plan.needReturn.toFixed(1)}%/yr`}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {plan.needReturn == null ? "no sane return gets there in time" : `vs ${returnPct.toFixed(1)}% now, saving ${format(monthlySaving, undefined, true)}/mo`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </BlurFade>

          {/* Composition */}
          {composition && (
            <BlurFade delay={0.3}>
              <div className="finance-card p-5">
                <p className="label-mono mb-3">Where the {format(goal.amount, goal.currency, true)} comes from</p>
                {(() => {
                  const total = composition.start + composition.deposits + composition.growth;
                  const seg = (v: number) => (total > 0 ? (v / total) * 100 : 0);
                  return (
                    <>
                      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                        <div style={{ width: `${seg(composition.start)}%`, background: ECHARTS_COLORS[4] }} />
                        <div style={{ width: `${seg(composition.deposits)}%`, background: ECHARTS_COLORS[2] }} />
                        <div style={{ width: `${seg(composition.growth)}%`, background: ECHARTS_COLORS[0] }} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div><span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ background: ECHARTS_COLORS[4] }} />Already have <b className="tabular-nums">{format(composition.start, undefined, true)}</b></div>
                        <div><span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ background: ECHARTS_COLORS[2] }} />You&apos;ll deposit <b className="tabular-nums">{format(composition.deposits, undefined, true)}</b></div>
                        <div><span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ background: ECHARTS_COLORS[0] }} />Growth earns <b className="tabular-nums">{format(composition.growth, undefined, true)}</b></div>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        {seg(composition.growth) < 25
                          ? "Most of this goal is your own deposits — the saving lever matters far more than the return lever right now."
                          : "Compounding is doing real work here — protecting the return matters as much as saving more."}
                      </p>
                    </>
                  );
                })()}
              </div>
            </BlurFade>
          )}

          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <ArrowRight className="h-3 w-3" /> Your measured investment P&amp;L lives on{" "}
            <Link href="/performance" className="underline">Performance</Link> — this page projects net worth as a whole, in {displayCurrency}.
          </p>
        </>
      )}

      <GoalEditor goal={editingGoal} open={editorOpen} onOpenChange={setEditorOpen} onSave={saveGoal} />
    </div>
  );
}
