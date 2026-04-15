"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Target, Plus, Pencil, Trash2, Check, Trophy, Sparkles, TrendingUp, Settings2 } from "lucide-react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogClose, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Goal {
  id: string;
  name: string;
  amount: number;
  currency: string;
  setAt: number;
  achievedAt: number | null;
}

interface GoalSectionProps {
  netWorth: number;
  symbol: string;
  format: (amount: number, from?: string, compact?: boolean) => string;
}

// ---------------------------------------------------------------------------
// Pure Helpers
// ---------------------------------------------------------------------------

function computeProjection(snapshots: { date: string; value: number }[], goal: number): Date | null {
  const pts = snapshots.filter((s) => s.value > 0).slice(-60);
  if (pts.length < 3) return null;
  const d = pts.map((s) => ({ x: Date.parse(s.date) / 86400000, y: s.value }));
  const n = d.length;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (const p of d) { sx += p.x; sy += p.y; sxy += p.x * p.y; sx2 += p.x * p.x; }
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
  if (slope <= 0 || !isFinite(slope)) return null;
  const intercept = (sy - slope * sx) / n;
  const tx = (goal - intercept) / slope;
  if (!isFinite(tx)) return null;
  const td = new Date(tx * 86400000);
  if (td.getTime() < Date.now() || td.getFullYear() > new Date().getFullYear() + 50) return null;
  return td;
}

function getProgressColor(pct: number): { bar: string; text: string; bg: string } {
  if (pct >= 90) return { bar: "bg-income", text: "text-income", bg: "bg-income/8" };
  if (pct >= 60) return { bar: "bg-[#b8860b]", text: "text-[#b8860b]", bg: "bg-[#b8860b]/8" };
  if (pct >= 30) return { bar: "bg-[#4d7cc7]", text: "text-[#4d7cc7]", bg: "bg-[#4d7cc7]/8" };
  return { bar: "bg-muted-foreground/50", text: "text-muted-foreground", bg: "bg-muted/50" };
}

// ---------------------------------------------------------------------------
// GoalDialog (add/edit)
// ---------------------------------------------------------------------------

function GoalDialog({ goal, onSave, trigger }: {
  goal?: Goal;
  onSave: (g: Omit<Goal, "id" | "setAt" | "achievedAt">) => void;
  trigger: React.ReactNode;
}) {
  const { enabledCurrencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(goal?.name ?? "");
  const [amount, setAmount] = useState(goal?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState(goal?.currency ?? "AUD");

  function handleOpen(v: boolean) {
    if (v) { setName(goal?.name ?? ""); setAmount(goal?.amount?.toString() ?? ""); setCurrency(goal?.currency ?? "AUD"); }
    setOpen(v);
  }

  function handleSave() {
    const parsed = parseFloat(amount);
    if (!name.trim() || !parsed || parsed <= 0) return;
    onSave({ name: name.trim(), amount: parsed, currency });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit Goal" : "Add Goal"}</DialogTitle>
          <DialogDescription>Set a net worth milestone to track.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Goal Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. First 100K, House Deposit" />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label>Target Amount</Label>
              <Input type="number" min="0" step="1000" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000" className="tabular-nums" />
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
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={handleSave}>{goal ? "Update" : "Add Goal"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// GoalRow — used inside the Manage modal
// ---------------------------------------------------------------------------

function ActiveGoalRow({
  g,
  pct,
  netWorth,
  snapshots,
  format,
  rank,
  onEdit,
  onDelete,
}: {
  g: Goal;
  pct: number;
  netWorth: number;
  snapshots: { date: string; value: number }[];
  format: GoalSectionProps["format"];
  rank: number;
  onEdit: (data: Omit<Goal, "id" | "setAt" | "achievedAt">) => void;
  onDelete: () => void;
}) {
  const { convert } = useCurrency();
  const gVal = convert(g.amount, g.currency);
  const remaining = Math.max(0, gVal - netWorth);
  const projected = computeProjection(snapshots, gVal);
  const colors = getProgressColor(pct);

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            "flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold tabular-nums shrink-0",
            colors.bg, colors.text,
          )}>
            {rank}
          </div>
          <span className="text-sm font-semibold truncate">{g.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("text-lg font-bold tabular-nums tracking-tight", colors.text)}>
            {pct.toFixed(0)}%
          </span>
          <div
            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <GoalDialog goal={g} onSave={onEdit} trigger={<Button variant="ghost" size="icon-xs"><Pencil className="h-3 w-3" /></Button>} />
            <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 className="h-3 w-3" /></Button>
          </div>
        </div>
      </div>
      <div className="relative h-2 w-full rounded-full bg-secondary overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full", colors.bar)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="tabular-nums">
            {format(netWorth, undefined, true)}
            <span className="mx-0.5 opacity-40">/</span>
            {format(gVal, undefined, true)}
          </span>
          <span className="tabular-nums opacity-70">
            {format(remaining, undefined, true)} to go
          </span>
        </div>
        {projected && (
          <span className="flex items-center gap-1 tabular-nums">
            <TrendingUp className="h-3 w-3 opacity-50" />
            {projected.toLocaleDateString("en-AU", { month: "short", year: "numeric" })}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ManageGoalsDialog — full CRUD list
// ---------------------------------------------------------------------------

function ManageGoalsDialog({
  open,
  onOpenChange,
  active,
  achieved,
  netWorth,
  snapshots,
  format,
  onAdd,
  onEdit,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  active: { goal: Goal; pct: number }[];
  achieved: { goal: Goal; pct: number }[];
  netWorth: number;
  snapshots: { date: string; value: number }[];
  format: GoalSectionProps["format"];
  onAdd: (data: Omit<Goal, "id" | "setAt" | "achievedAt">) => void;
  onEdit: (goalId: string, data: Omit<Goal, "id" | "setAt" | "achievedAt">) => void;
  onDelete: (goalId: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-4">
            <div>
              <DialogTitle>Manage Goals</DialogTitle>
              <DialogDescription>Net worth milestones and achievements.</DialogDescription>
            </div>
            <GoalDialog
              onSave={onAdd}
              trigger={<Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" />Add</Button>}
            />
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Active */}
          {active.length > 0 && (
            <div className="space-y-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Active ({active.length})
              </p>
              <div className="space-y-5">
                {active.map(({ goal: g, pct }, i) => (
                  <ActiveGoalRow
                    key={g.id}
                    g={g}
                    pct={pct}
                    netWorth={netWorth}
                    snapshots={snapshots}
                    format={format}
                    rank={i + 1}
                    onEdit={(d) => onEdit(g.id, d)}
                    onDelete={() => setConfirmDelete(g.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Achieved */}
          {achieved.length > 0 && (
            <div className={cn(active.length > 0 && "pt-4 border-t border-border/50")}>
              <div className="flex items-center gap-1.5 mb-3">
                <Trophy className="h-3.5 w-3.5 text-[#c9963f]" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Achieved ({achieved.length})
                </p>
              </div>
              <div className="grid gap-2">
                {achieved.map(({ goal: g }) => (
                  <div
                    key={g.id}
                    className="group/ach flex items-center justify-between rounded-lg bg-income/5 border border-income/10 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex items-center justify-center h-5 w-5 rounded-full bg-income/15 shrink-0">
                        <Check className="h-3 w-3 text-income" />
                      </div>
                      <span className="text-sm font-medium truncate">{g.name}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                        {format(g.amount, g.currency, true)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {g.achievedAt && (
                        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                          {new Date(g.achievedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setConfirmDelete(g.id)}
                        className="opacity-0 group-hover/ach:opacity-100 transition-opacity h-5 w-5"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirm delete */}
          <AnimatePresence>
            {confirmDelete && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                <div className="flex items-center justify-between rounded-lg bg-destructive/5 px-3 py-2">
                  <span className="text-xs text-destructive">
                    Remove &quot;{[...active, ...achieved].find(({ goal }) => goal.id === confirmDelete)?.goal.name}&quot;?
                  </span>
                  <div className="flex gap-1.5">
                    <Button variant="destructive" size="xs" onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }}>Remove</Button>
                    <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// GoalSection (exported) — compact "next up" card + manage modal
// ---------------------------------------------------------------------------

export function GoalSection({ netWorth, format }: GoalSectionProps) {
  const [goals, setGoals] = useCloudStorage<Goal[]>("networth_goals", []);
  const [oldGoal, setOldGoal] = useCloudStorage<{ amount: number; currency: string; setAt: number } | null>("networth_goal", null);
  if (oldGoal && goals.length === 0) {
    const migrated: Goal = { id: crypto.randomUUID(), name: "Net Worth Goal", amount: oldGoal.amount, currency: oldGoal.currency, setAt: oldGoal.setAt, achievedAt: null };
    setGoals([migrated]);
    setOldGoal(null);
  }

  const [snapshots] = useCloudStorage<{ date: string; value: number }[]>("networth_snapshots", []);
  const [manageOpen, setManageOpen] = useState(false);
  const { convert } = useCurrency();

  // Auto-mark achieved goals when netWorth changes
  useEffect(() => {
    let changed = false;
    const updated = goals.map((g) => {
      if (g.achievedAt) return g;
      const goalVal = convert(g.amount, g.currency);
      if (netWorth >= goalVal) {
        changed = true;
        return { ...g, achievedAt: Date.now() };
      }
      return g;
    });
    if (changed) setGoals(updated);
  }, [netWorth, goals, convert, setGoals]);

  const sortedGoals = useMemo(() => {
    const withPct = goals.map((g) => {
      const gVal = convert(g.amount, g.currency);
      const pct = gVal > 0 ? Math.min((netWorth / gVal) * 100, 100) : 0;
      return { goal: g, pct };
    });
    const active = withPct.filter((g) => !g.goal.achievedAt).sort((a, b) => b.pct - a.pct);
    const achieved = withPct.filter((g) => g.goal.achievedAt).sort((a, b) => (b.goal.achievedAt ?? 0) - (a.goal.achievedAt ?? 0));
    return { active, achieved };
  }, [goals, netWorth, convert]);

  function addGoal(data: Omit<Goal, "id" | "setAt" | "achievedAt">) {
    setGoals((prev) => [...prev, { ...data, id: crypto.randomUUID(), setAt: Date.now(), achievedAt: null }]);
  }
  function editGoal(goalId: string, data: Omit<Goal, "id" | "setAt" | "achievedAt">) {
    setGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, ...data, achievedAt: null } : g));
  }
  function removeGoal(goalId: string) {
    setGoals((prev) => prev.filter((g) => g.id !== goalId));
  }

  // Empty state
  if (goals.length === 0) {
    return (
      <BlurFade delay={0}>
        <div className="finance-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="label-mono">Goals</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-border/50 rounded-xl">
            <div className="relative">
              <Target className="h-8 w-8 text-muted-foreground/30" />
              <Sparkles className="h-3.5 w-3.5 text-primary/50 absolute -top-1 -right-1" />
            </div>
            <p className="text-sm font-medium">Set your first goal</p>
            <p className="text-xs text-muted-foreground max-w-[240px] text-center">
              Track milestones like &quot;First 100K&quot; or &quot;House Deposit&quot;.
            </p>
            <GoalDialog onSave={addGoal} trigger={<Button size="sm" className="mt-1 rounded-full gap-1.5"><Plus className="h-3.5 w-3.5" />Add Goal</Button>} />
          </div>
        </div>
      </BlurFade>
    );
  }

  // Pick the closest active goal, or fall back to most recent achievement
  const next = sortedGoals.active[0];
  const latestAchieved = !next ? sortedGoals.achieved[0] : null;

  return (
    <BlurFade delay={0}>
      <div className="finance-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <p className="label-mono">Next Goal</p>
            <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
              {sortedGoals.achieved.length}/{goals.length} completed
            </span>
          </div>
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5"
            onClick={() => setManageOpen(true)}
          >
            <Settings2 className="h-3 w-3" />
            Manage
          </Button>
        </div>

        {next ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setManageOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setManageOpen(true); } }}
            className="w-full cursor-pointer text-left rounded-lg p-3 -m-3 hover:bg-secondary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ActiveGoalRow
              g={next.goal}
              pct={next.pct}
              netWorth={netWorth}
              snapshots={snapshots}
              format={format}
              rank={1}
              onEdit={(d) => editGoal(next.goal.id, d)}
              onDelete={() => removeGoal(next.goal.id)}
            />
          </div>
        ) : latestAchieved ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setManageOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setManageOpen(true); } }}
            className="w-full cursor-pointer text-left rounded-lg bg-income/5 border border-income/10 p-3 hover:bg-income/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center h-6 w-6 rounded-full bg-income/15 shrink-0">
                <Trophy className="h-3 w-3 text-income" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">All goals achieved!</p>
                <p className="text-[11px] text-muted-foreground">
                  Last: {latestAchieved.goal.name} · {format(latestAchieved.goal.amount, latestAchieved.goal.currency, true)}
                </p>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <GoalDialog onSave={addGoal} trigger={<Button size="xs" className="gap-1"><Plus className="h-3 w-3" />New</Button>} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <ManageGoalsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        active={sortedGoals.active}
        achieved={sortedGoals.achieved}
        netWorth={netWorth}
        snapshots={snapshots}
        format={format}
        onAdd={addGoal}
        onEdit={editGoal}
        onDelete={removeGoal}
      />
    </BlurFade>
  );
}
