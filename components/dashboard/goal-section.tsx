"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Target, Pencil, Trash2, Check, Trophy } from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useCurrency } from "@/components/providers/currency-provider";
import { NumberTicker } from "@/components/ui/number-ticker";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Currency } from "@/lib/utils/types";
import { CURRENCIES } from "@/lib/utils/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoalData {
  amount: number;
  currency: Currency;
  setAt: number;
}

interface GoalSectionProps {
  netWorth: number;
  symbol: string;
  format: (amount: number, from?: Currency, compact?: boolean) => string;
}

// ---------------------------------------------------------------------------
// Gauge Config
// ---------------------------------------------------------------------------

const GC = {
  cx: 160,
  cy: 160,
  r: 120,
  startAngle: 150,
  totalDeg: 240,
  strokeWidth: 18,
  viewBox: "0 0 320 320",
} as const;

// ---------------------------------------------------------------------------
// Pure Helpers
// ---------------------------------------------------------------------------

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function computeArcLength(r: number, totalDeg: number) {
  return 2 * Math.PI * r * (totalDeg / 360);
}

function computeProjection(
  snapshots: { date: string; value: number }[],
  goalValue: number
): Date | null {
  const valid = snapshots.filter((s) => s.value > 0).slice(-60);
  if (valid.length < 3) return null;

  const points = valid.map((s) => ({
    x: Date.parse(s.date) / 86400000,
    y: s.value,
  }));

  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  if (slope <= 0 || !isFinite(slope)) return null;

  const intercept = (sumY - slope * sumX) / n;
  const targetX = (goalValue - intercept) / slope;
  if (!isFinite(targetX)) return null;

  const targetDate = new Date(targetX * 86400000);
  if (targetDate.getTime() < Date.now()) return null;
  if (targetDate.getFullYear() > new Date().getFullYear() + 50) return null;

  return targetDate;
}

function getMotivationalCopy(percent: number): string {
  if (percent >= 100) return "Goal achieved. Time to set a new one.";
  if (percent >= 90) return "One final push. You're nearly there.";
  if (percent >= 75) return "You can see the summit from here.";
  if (percent > 50) return "The second half always moves faster. Keep going.";
  if (percent === 50) return "Halfway there. The finish line is closer than the start.";
  if (percent >= 30) return "Almost halfway. The hardest part is behind you.";
  if (percent >= 15) return "You're building real momentum now.";
  if (percent >= 5) return "The foundation is set. Let it compound.";
  return "Every journey begins with a single step. You've started.";
}

const MILESTONES = [0, 25, 50, 75, 100];

// ---------------------------------------------------------------------------
// GoalDialog
// ---------------------------------------------------------------------------

function GoalDialog({
  goal,
  onSave,
  trigger,
}: {
  goal: GoalData | null;
  onSave: (g: GoalData) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(goal?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(goal?.currency ?? "AUD");

  function handleOpen(isOpen: boolean) {
    if (isOpen) {
      setAmount(goal?.amount?.toString() ?? "");
      setCurrency(goal?.currency ?? "AUD");
    }
    setOpen(isOpen);
  }

  function handleSave() {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0 || !isFinite(parsed)) return;
    onSave({ amount: parsed, currency, setAt: Date.now() });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit Goal" : "Set Net Worth Goal"}</DialogTitle>
          <DialogDescription>
            Set a target net worth to track your progress.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label>Target Amount</Label>
              <Input
                type="number"
                min="0"
                step="1000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500000"
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <Select
                value={currency}
                onValueChange={(v) => v && setCurrency(v as Currency)}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={handleSave}>
            {goal ? "Update Goal" : "Set Goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// GoalSection
// ---------------------------------------------------------------------------

export function GoalSection({ netWorth, symbol, format }: GoalSectionProps) {
  const [goal, setGoal] = useLocalStorage<GoalData | null>("networth_goal", null);
  const [snapshots] = useLocalStorage<{ date: string; value: number }[]>(
    "networth_snapshots",
    []
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { convert } = useCurrency();

  // Derived
  const goalInDisplay = useMemo(
    () => (goal ? convert(goal.amount, goal.currency) : 0),
    [goal, convert]
  );

  const rawPercent = goalInDisplay > 0 ? (netWorth / goalInDisplay) * 100 : 0;
  const clampedPercent = Math.min(rawPercent, 100);

  const arcLength = computeArcLength(GC.r, GC.totalDeg);
  const targetOffset = arcLength * (1 - clampedPercent / 100);

  const dotPos = useMemo(
    () =>
      polarToCartesian(
        GC.cx,
        GC.cy,
        GC.r,
        GC.startAngle + GC.totalDeg * (clampedPercent / 100)
      ),
    [clampedPercent]
  );

  const milestoneData = useMemo(
    () =>
      MILESTONES.map((m) => ({
        percent: m,
        reached: clampedPercent >= m,
        pos: polarToCartesian(
          GC.cx,
          GC.cy,
          GC.r + 28,
          GC.startAngle + GC.totalDeg * (m / 100)
        ),
        tickStart: polarToCartesian(
          GC.cx,
          GC.cy,
          GC.r + 12,
          GC.startAngle + GC.totalDeg * (m / 100)
        ),
        tickEnd: polarToCartesian(
          GC.cx,
          GC.cy,
          GC.r + 4,
          GC.startAngle + GC.totalDeg * (m / 100)
        ),
      })),
    [clampedPercent]
  );

  const projectedDate = useMemo(
    () => (goalInDisplay > 0 ? computeProjection(snapshots, goalInDisplay) : null),
    [snapshots, goalInDisplay]
  );

  const copy = getMotivationalCopy(rawPercent);

  const remaining = Math.max(0, goalInDisplay - netWorth);
  const achieved = rawPercent >= 100;

  const trackPath = describeArc(GC.cx, GC.cy, GC.r, GC.startAngle, GC.startAngle + GC.totalDeg);

  // ---- Empty state --------------------------------------------------------
  if (!goal) {
    return (
      <BlurFade delay={0}>
        <div className="finance-card p-6">
          <p className="label-mono mb-4">Net Worth Goal</p>
          <div className="flex flex-col items-center justify-center gap-3 py-10 border-2 border-dashed border-border/60 rounded-2xl">
            <Target className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium">Set a net worth goal</p>
            <p className="text-xs text-muted-foreground max-w-[240px] text-center">
              Track your progress with a beautiful radial gauge and projected timeline.
            </p>
            <GoalDialog
              goal={null}
              onSave={setGoal}
              trigger={
                <Button className="mt-2 rounded-full px-6">Set Goal</Button>
              }
            />
          </div>
        </div>
      </BlurFade>
    );
  }

  // ---- Gauge view ---------------------------------------------------------
  return (
    <BlurFade delay={0}>
      <div className="finance-card p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <p className="label-mono">Net Worth Goal</p>
          <div className="flex items-center gap-1">
            <GoalDialog
              goal={goal}
              onSave={setGoal}
              trigger={
                <Button variant="ghost" size="icon-xs">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setConfirmDelete(!confirmDelete)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Delete confirmation */}
        <AnimatePresence>
          {confirmDelete && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-4"
            >
              <div className="flex items-center justify-between rounded-lg bg-destructive/5 px-3 py-2">
                <span className="text-xs text-destructive">Remove goal?</span>
                <div className="flex gap-1.5">
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => {
                      setGoal(null);
                      setConfirmDelete(false);
                    }}
                  >
                    Remove
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gauge */}
        <div className="relative mx-auto max-w-[280px] aspect-square">
          <svg viewBox={GC.viewBox} className="w-full h-full">
            <defs>
              <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="oklch(0.55 0.16 155)" />
                <stop offset="60%" stopColor="oklch(0.58 0.09 65)" />
                <stop offset="100%" stopColor="oklch(0.62 0.10 50)" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="dotShadow">
                <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.2" />
              </filter>
            </defs>

            {/* Track */}
            <path
              d={trackPath}
              fill="none"
              stroke="currentColor"
              strokeWidth={GC.strokeWidth}
              strokeLinecap="round"
              className="text-border/40"
            />

            {/* Milestone ticks */}
            {milestoneData.map((m) => (
              <line
                key={m.percent}
                x1={m.tickStart.x}
                y1={m.tickStart.y}
                x2={m.tickEnd.x}
                y2={m.tickEnd.y}
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                className={cn(
                  m.reached ? "text-accent" : "text-border"
                )}
              />
            ))}

            {/* Glow layer */}
            {clampedPercent > 0 && (
              <motion.path
                d={trackPath}
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth={GC.strokeWidth + 14}
                strokeLinecap="round"
                strokeDasharray={arcLength}
                initial={{ strokeDashoffset: arcLength }}
                animate={{ strokeDashoffset: targetOffset }}
                transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                opacity={0.2}
                filter="url(#glow)"
              />
            )}

            {/* Progress arc */}
            {clampedPercent > 0 && (
              <motion.path
                d={trackPath}
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth={GC.strokeWidth}
                strokeLinecap="round"
                strokeDasharray={arcLength}
                initial={{ strokeDashoffset: arcLength }}
                animate={{ strokeDashoffset: targetOffset }}
                transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              />
            )}

            {/* Progress dot */}
            {clampedPercent > 0 && (
              <motion.circle
                r={10}
                fill="url(#gaugeGradient)"
                filter="url(#dotShadow)"
                initial={{ cx: polarToCartesian(GC.cx, GC.cy, GC.r, GC.startAngle).x, cy: polarToCartesian(GC.cx, GC.cy, GC.r, GC.startAngle).y }}
                animate={{
                  cx: dotPos.x,
                  cy: dotPos.y,
                  scale: [1, 1.12, 1],
                }}
                transition={{
                  cx: { duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.3 },
                  cy: { duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.3 },
                  scale: { duration: 2.5, repeat: Infinity, repeatDelay: 1.5 },
                }}
              />
            )}
          </svg>

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="label-mono mb-1">Progress</span>
            <div className="text-4xl md:text-5xl font-bold tracking-tighter tabular-nums">
              <NumberTicker
                value={Math.round(rawPercent * 10) / 10}
                suffix="%"
                decimalPlaces={1}
                delay={400}
              />
            </div>
            {achieved && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1.2, type: "spring" }}
                className="mt-1"
              >
                <Trophy className="h-5 w-5 text-accent" />
              </motion.div>
            )}
          </div>

          {/* Milestone badges */}
          {milestoneData.map((m) => (
            <div
              key={m.percent}
              className="absolute"
              style={{
                left: `${(m.pos.x / 320) * 100}%`,
                top: `${(m.pos.y / 320) * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <motion.div
                className={cn(
                  "flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-bold tabular-nums",
                  m.reached
                    ? "bg-accent text-white ring-2 ring-accent/20"
                    : "bg-border/60 text-muted-foreground/60"
                )}
                animate={m.reached ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 0.4, delay: 1.6 }}
              >
                {m.percent === 100 && m.reached ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  m.percent
                )}
              </motion.div>
            </div>
          ))}
        </div>

        {/* Stats Row */}
        <BlurFade delay={0.2}>
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="text-center p-3 rounded-xl bg-secondary/50">
              <p className="label-mono mb-1">Current</p>
              <p className="text-sm font-semibold tabular-nums">
                {format(netWorth, undefined, true)}
              </p>
            </div>
            <div className="text-center p-3 rounded-xl bg-secondary/50">
              <p className="label-mono mb-1">
                {achieved ? "Exceeded" : "Remaining"}
              </p>
              <p
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  achieved ? "text-income" : ""
                )}
              >
                {achieved ? (
                  <>{format(netWorth - goalInDisplay, undefined, true)}</>
                ) : (
                  format(remaining, undefined, true)
                )}
              </p>
            </div>
            <div className="text-center p-3 rounded-xl bg-secondary/50">
              <p className="label-mono mb-1">On Track</p>
              {achieved ? (
                <p className="text-sm font-semibold text-income">Achieved</p>
              ) : projectedDate ? (
                <p className="text-sm font-semibold tabular-nums">
                  {projectedDate.toLocaleDateString("en-AU", {
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Need more data</p>
              )}
            </div>
          </div>
        </BlurFade>

        {/* Motivational copy */}
        <BlurFade delay={0.3}>
          <div className="mt-4 text-center">
            <AnimatePresence mode="wait">
              <motion.p
                key={copy}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.35 }}
                className="text-xs text-muted-foreground italic"
              >
                {copy}
              </motion.p>
            </AnimatePresence>
          </div>
        </BlurFade>
      </div>
    </BlurFade>
  );
}
