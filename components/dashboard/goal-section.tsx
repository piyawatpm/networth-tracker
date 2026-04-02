"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Target, Plus, Pencil, Trash2, Check, Trophy, Star, Sparkles } from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import { NumberTicker } from "@/components/ui/number-ticker";
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
// Gauge Config
// ---------------------------------------------------------------------------

const GC = { cx: 140, cy: 140, r: 108, startAngle: 150, totalDeg: 240, strokeWidth: 14, viewBox: "0 0 280 280" } as const;

// ---------------------------------------------------------------------------
// Pure Helpers
// ---------------------------------------------------------------------------

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, s: number, e: number) {
  const start = polar(cx, cy, r, s);
  const end = polar(cx, cy, r, e);
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
}

function arcLen(r: number, deg: number) { return 2 * Math.PI * r * (deg / 360); }

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

function getCopy(pct: number): string {
  if (pct >= 100) return "Goal achieved! Set your next milestone.";
  if (pct >= 90) return "Almost there. One final push.";
  if (pct >= 75) return "The summit is in sight.";
  if (pct >= 50) return "Past halfway. Keep the momentum.";
  if (pct >= 25) return "Building real progress now.";
  if (pct >= 5) return "The foundation is set.";
  return "Every journey starts with a single step.";
}

// Achievement medal colors
const MEDAL_COLORS = ["#c9963f", "#c0c0c0", "#cd7f32", "#2e8b57", "#4d7cc7", "#8b5cf6"];

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
// Mini Gauge for non-primary goals
// ---------------------------------------------------------------------------

function MiniGauge({ percent, size = 40 }: { percent: number; size?: number }) {
  const r = (size - 6) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const totalDeg = 240;
  const startAngle = 150;
  const clamped = Math.min(percent, 100);
  const len = arcLen(r, totalDeg);
  const offset = len * (1 - clamped / 100);
  const trackPath = arc(cx, cy, r, startAngle, startAngle + totalDeg);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <path d={trackPath} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" className="text-border/30" />
      {clamped > 0 && (
        <motion.path
          d={trackPath} fill="none" stroke="#c95f3f" strokeWidth={3} strokeLinecap="round"
          strokeDasharray={len}
          initial={{ strokeDashoffset: len }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        />
      )}
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.22} fontWeight="700" fill="currentColor" className="tabular-nums">
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// GoalSection (exported)
// ---------------------------------------------------------------------------

export function GoalSection({ netWorth, symbol, format }: GoalSectionProps) {
  const [goals, setGoals] = useLocalStorage<Goal[]>("networth_goals", []);
  // Migrate old single goal
  const [oldGoal, setOldGoal] = useLocalStorage<{ amount: number; currency: string; setAt: number } | null>("networth_goal", null);
  if (oldGoal && goals.length === 0) {
    const migrated: Goal = { id: crypto.randomUUID(), name: "Net Worth Goal", amount: oldGoal.amount, currency: oldGoal.currency, setAt: oldGoal.setAt, achievedAt: null };
    setGoals([migrated]);
    setOldGoal(null);
  }

  const [snapshots] = useLocalStorage<{ date: string; value: number }[]>("networth_snapshots", []);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { convert } = useCurrency();

  // Sort: active goals by amount asc, then achieved by achievedAt desc
  const sortedGoals = useMemo(() => {
    const active = goals.filter((g) => !g.achievedAt).sort((a, b) => a.amount - b.amount);
    const achieved = goals.filter((g) => g.achievedAt).sort((a, b) => (b.achievedAt ?? 0) - (a.achievedAt ?? 0));
    return [...active, ...achieved];
  }, [goals]);

  // Primary = first unachieved goal (lowest amount)
  const primary = sortedGoals.find((g) => !g.achievedAt) ?? null;
  const achievedGoals = sortedGoals.filter((g) => g.achievedAt);
  const activeGoals = sortedGoals.filter((g) => !g.achievedAt);

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

  // Primary goal derived values
  const primaryVal = primary ? convert(primary.amount, primary.currency) : 0;
  const rawPct = primaryVal > 0 ? (netWorth / primaryVal) * 100 : 0;
  const clampedPct = Math.min(rawPct, 100);
  const aLen = arcLen(GC.r, GC.totalDeg);
  const tOffset = aLen * (1 - clampedPct / 100);
  const dotPos = polar(GC.cx, GC.cy, GC.r, GC.startAngle + GC.totalDeg * (clampedPct / 100));
  const trackPath = arc(GC.cx, GC.cy, GC.r, GC.startAngle, GC.startAngle + GC.totalDeg);
  const projected = primary ? computeProjection(snapshots, primaryVal) : null;
  const remaining = Math.max(0, primaryVal - netWorth);

  // Handlers
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

  // ---- Empty state --------------------------------------------------------
  if (goals.length === 0) {
    return (
      <BlurFade delay={0}>
        <div className="finance-card p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="label-mono">Goals</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-3 py-10 border-2 border-dashed border-border/60 rounded-2xl">
            <div className="relative">
              <Target className="h-10 w-10 text-muted-foreground/30" />
              <Sparkles className="h-4 w-4 text-primary/50 absolute -top-1 -right-1" />
            </div>
            <p className="text-sm font-medium">Set your first goal</p>
            <p className="text-xs text-muted-foreground max-w-[260px] text-center">
              Track milestones like &quot;First 100K&quot;, &quot;Emergency Fund&quot;, or &quot;House Deposit&quot;.
            </p>
            <GoalDialog onSave={addGoal} trigger={<Button className="mt-2 rounded-full px-6 gap-1.5"><Plus className="h-3.5 w-3.5" />Add Goal</Button>} />
          </div>
        </div>
      </BlurFade>
    );
  }

  // ---- Goals view ---------------------------------------------------------
  return (
    <BlurFade delay={0}>
      <div className="finance-card p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <p className="label-mono">Goals</p>
          <GoalDialog onSave={addGoal} trigger={<Button variant="ghost" size="xs" className="gap-1"><Plus className="h-3 w-3" />Add</Button>} />
        </div>

        {/* Primary Goal Gauge */}
        {primary && (
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* SVG Gauge */}
            <div className="relative shrink-0" style={{ width: 220, height: 220 }}>
              <svg viewBox={GC.viewBox} className="w-full h-full">
                <defs>
                  <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#2e8b57" />
                    <stop offset="50%" stopColor="#c95f3f" />
                    <stop offset="100%" stopColor="#c9963f" />
                  </linearGradient>
                  <filter id="gl"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  <filter id="ds"><feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.15" /></filter>
                </defs>

                <path d={trackPath} fill="none" stroke="currentColor" strokeWidth={GC.strokeWidth} strokeLinecap="round" className="text-border/30" />

                {clampedPct > 0 && <>
                  <motion.path d={trackPath} fill="none" stroke="url(#gg)" strokeWidth={GC.strokeWidth + 10} strokeLinecap="round" strokeDasharray={aLen} initial={{ strokeDashoffset: aLen }} animate={{ strokeDashoffset: tOffset }} transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }} opacity={0.15} filter="url(#gl)" />
                  <motion.path d={trackPath} fill="none" stroke="url(#gg)" strokeWidth={GC.strokeWidth} strokeLinecap="round" strokeDasharray={aLen} initial={{ strokeDashoffset: aLen }} animate={{ strokeDashoffset: tOffset }} transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }} />
                  <motion.circle r={8} fill="url(#gg)" filter="url(#ds)"
                    initial={{ cx: polar(GC.cx, GC.cy, GC.r, GC.startAngle).x, cy: polar(GC.cx, GC.cy, GC.r, GC.startAngle).y }}
                    animate={{ cx: dotPos.x, cy: dotPos.y, scale: [1, 1.1, 1] }}
                    transition={{ cx: { duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }, cy: { duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }, scale: { duration: 2.5, repeat: Infinity, repeatDelay: 2 } }}
                  />
                </>}
              </svg>

              {/* Center */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="label-mono mb-0.5">{primary.name}</span>
                <div className="text-3xl font-bold tracking-tighter tabular-nums">
                  <NumberTicker value={Math.round(rawPct * 10) / 10} suffix="%" decimalPlaces={1} delay={400} />
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="flex-1 space-y-3 min-w-0">
              <div>
                <p className="label-mono mb-1">Target</p>
                <p className="text-xl font-bold tabular-nums">{format(primary.amount, primary.currency)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-secondary/50 p-2.5">
                  <p className="label-mono mb-0.5">Remaining</p>
                  <p className="text-sm font-semibold tabular-nums">{format(remaining, undefined, true)}</p>
                </div>
                <div className="rounded-lg bg-secondary/50 p-2.5">
                  <p className="label-mono mb-0.5">On Track</p>
                  {projected ? (
                    <p className="text-sm font-semibold tabular-nums">{projected.toLocaleDateString("en-AU", { month: "short", year: "numeric" })}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Need more data</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <GoalDialog goal={primary} onSave={(d) => editGoal(primary.id, d)} trigger={<Button variant="ghost" size="icon-xs"><Pencil className="h-3 w-3" /></Button>} />
                <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(primary.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
              <AnimatePresence mode="wait">
                <motion.p key={getCopy(rawPct)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }} className="text-xs text-muted-foreground italic">
                  {getCopy(rawPct)}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Other active goals */}
        {activeGoals.length > 1 && (
          <div className="mt-6 pt-4 border-t border-border/50">
            <p className="label-mono mb-3">Other Goals</p>
            <div className="grid gap-2">
              {activeGoals.filter((g) => g.id !== primary?.id).map((g) => {
                const gVal = convert(g.amount, g.currency);
                const gPct = gVal > 0 ? Math.min((netWorth / gVal) * 100, 100) : 0;
                return (
                  <div key={g.id} className="flex items-center gap-3 rounded-lg bg-secondary/30 p-3">
                    <MiniGauge percent={gPct} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{format(g.amount, g.currency, true)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <GoalDialog goal={g} onSave={(d) => editGoal(g.id, d)} trigger={<Button variant="ghost" size="icon-xs"><Pencil className="h-3 w-3" /></Button>} />
                      <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(g.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Achievements */}
        {achievedGoals.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="h-3.5 w-3.5 text-[#c9963f]" />
              <p className="label-mono">Achievements</p>
            </div>
            <div className="grid gap-2">
              {achievedGoals.map((g, i) => (
                <motion.div
                  key={g.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-lg bg-gradient-to-r from-[#c9963f]/5 to-transparent border border-[#c9963f]/15 p-3"
                >
                  <div className="flex items-center justify-center w-9 h-9 rounded-full shrink-0" style={{ backgroundColor: MEDAL_COLORS[i % MEDAL_COLORS.length] + "18" }}>
                    <Star className="h-4 w-4" style={{ color: MEDAL_COLORS[i % MEDAL_COLORS.length] }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{g.name}</p>
                      <Check className="h-3.5 w-3.5 text-income shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {format(g.amount, g.currency, true)} — achieved {g.achievedAt ? new Date(g.achievedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(g.id)}><Trash2 className="h-3 w-3 text-muted-foreground/50" /></Button>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        <AnimatePresence>
          {deleteId && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden mt-4">
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
