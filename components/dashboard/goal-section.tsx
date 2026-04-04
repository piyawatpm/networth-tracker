"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Target, Plus, Pencil, Trash2, Check, Trophy, Sparkles } from "lucide-react";
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
// GoalSection (exported)
// ---------------------------------------------------------------------------

export function GoalSection({ netWorth, symbol, format }: GoalSectionProps) {
  const [goals, setGoals] = useCloudStorage<Goal[]>("networth_goals", []);
  const [oldGoal, setOldGoal] = useCloudStorage<{ amount: number; currency: string; setAt: number } | null>("networth_goal", null);
  if (oldGoal && goals.length === 0) {
    const migrated: Goal = { id: crypto.randomUUID(), name: "Net Worth Goal", amount: oldGoal.amount, currency: oldGoal.currency, setAt: oldGoal.setAt, achievedAt: null };
    setGoals([migrated]);
    setOldGoal(null);
  }

  const [snapshots] = useCloudStorage<{ date: string; value: number }[]>("networth_snapshots", []);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { convert } = useCurrency();

  const sortedGoals = useMemo(() => {
    const active = goals.filter((g) => !g.achievedAt).sort((a, b) => a.amount - b.amount);
    const achieved = goals.filter((g) => g.achievedAt).sort((a, b) => (b.achievedAt ?? 0) - (a.achievedAt ?? 0));
    return [...active, ...achieved];
  }, [goals]);

  const activeGoals = sortedGoals.filter((g) => !g.achievedAt);
  const achievedGoals = sortedGoals.filter((g) => g.achievedAt);

  // Check for newly achieved goals
  useMemo(() => {
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

  function addGoal(data: Omit<Goal, "id" | "setAt" | "achievedAt">) {
    setGoals((prev) => [...prev, { ...data, id: crypto.randomUUID(), setAt: Date.now(), achievedAt: null }]);
  }
  function editGoal(goalId: string, data: Omit<Goal, "id" | "setAt" | "achievedAt">) {
    setGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, ...data, achievedAt: null } : g));
  }
  function removeGoal(goalId: string) {
    setGoals((prev) => prev.filter((g) => g.id !== goalId));
    setDeleteId(null);
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

  return (
    <BlurFade delay={0}>
      <div className="finance-card p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <p className="label-mono">Goals</p>
          <GoalDialog onSave={addGoal} trigger={<Button variant="ghost" size="xs" className="gap-1"><Plus className="h-3 w-3" />Add</Button>} />
        </div>

        {/* Active Goals */}
        {activeGoals.length > 0 && (
          <div className="space-y-3">
            {activeGoals.map((g) => {
              const gVal = convert(g.amount, g.currency);
              const pct = gVal > 0 ? Math.min((netWorth / gVal) * 100, 100) : 0;
              const remaining = Math.max(0, gVal - netWorth);
              const projected = computeProjection(snapshots, gVal);

              return (
                <div key={g.id} className="group">
                  {/* Name + target row */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold truncate">{g.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {format(g.amount, g.currency, true)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <GoalDialog goal={g} onSave={(d) => editGoal(g.id, d)} trigger={<Button variant="ghost" size="icon-xs"><Pencil className="h-3 w-3" /></Button>} />
                      <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(g.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="relative">
                    <div className="h-4 w-full rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                      />
                    </div>
                    {/* Percentage label on bar */}
                    <div className="absolute inset-0 flex items-center px-2">
                      <span className={cn(
                        "text-[10px] font-bold tabular-nums",
                        pct > 40 ? "text-background" : "text-foreground",
                      )}>
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 mt-1.5 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">
                      {format(netWorth, undefined, true)} of {format(gVal, undefined, true)}
                    </span>
                    <span className="tabular-nums">
                      {format(remaining, undefined, true)} to go
                    </span>
                    {projected && (
                      <span className="ml-auto tabular-nums">
                        Est. {projected.toLocaleDateString("en-AU", { month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Achievements */}
        {achievedGoals.length > 0 && (
          <div className={cn(activeGoals.length > 0 && "mt-4 pt-3 border-t border-border/50")}>
            <div className="flex items-center gap-1.5 mb-2.5">
              <Trophy className="h-3 w-3 text-[#c9963f]" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Achieved</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {achievedGoals.map((g) => (
                <div
                  key={g.id}
                  className="group/ach flex items-center gap-1.5 rounded-full bg-income/8 border border-income/15 pl-2 pr-1 py-1"
                >
                  <Check className="h-3 w-3 text-income shrink-0" />
                  <span className="text-xs font-medium">{g.name}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {format(g.amount, g.currency, true)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setDeleteId(g.id)}
                    className="opacity-0 group-hover/ach:opacity-100 transition-opacity h-5 w-5"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        <AnimatePresence>
          {deleteId && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden mt-3">
              <div className="flex items-center justify-between rounded-lg bg-destructive/5 px-3 py-2">
                <span className="text-xs text-destructive">Remove &quot;{goals.find((g) => g.id === deleteId)?.name}&quot;?</span>
                <div className="flex gap-1.5">
                  <Button variant="destructive" size="xs" onClick={() => removeGoal(deleteId)}>Remove</Button>
                  <Button variant="ghost" size="xs" onClick={() => setDeleteId(null)}>Cancel</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </BlurFade>
  );
}
