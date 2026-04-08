"use client";

import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { TrendingUp, Clock, Zap, PiggyBank } from "lucide-react";

interface KeyNumber {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: "income" | "expense" | "accent" | "muted";
}

interface KeyNumbersCardProps {
  savingsRate: number;
  runwayMonths: number;
  fiRatio: number;
  investRate: number;
  format: (v: number) => string;
  delay: number;
}

export function KeyNumbersCard({
  savingsRate,
  runwayMonths,
  fiRatio,
  investRate,
  format,
  delay,
}: KeyNumbersCardProps) {
  const numbers: KeyNumber[] = [
    {
      label: "Savings Rate",
      value: `${savingsRate.toFixed(0)}%`,
      sub: savingsRate >= 20 ? "Excellent" : savingsRate >= 10 ? "Good" : savingsRate > 0 ? "Low" : "—",
      icon: PiggyBank,
      color: savingsRate >= 20 ? "income" : savingsRate >= 10 ? "accent" : "expense",
    },
    {
      label: "Runway",
      value: runwayMonths >= 99 ? "99+" : `${runwayMonths.toFixed(0)}`,
      sub: `month${runwayMonths !== 1 ? "s" : ""} at current burn`,
      icon: Clock,
      color: runwayMonths >= 12 ? "income" : runwayMonths >= 6 ? "accent" : "expense",
    },
    {
      label: "FI Ratio",
      value: `${Math.min(fiRatio, 999).toFixed(0)}%`,
      sub: fiRatio >= 100 ? "Independent!" : "passive / expenses",
      icon: Zap,
      color: fiRatio >= 100 ? "income" : fiRatio >= 25 ? "accent" : "muted",
    },
    {
      label: "Invest Rate",
      value: `${Math.min(investRate, 100).toFixed(0)}%`,
      sub: "of net worth invested",
      icon: TrendingUp,
      color: investRate >= 70 ? "income" : investRate >= 40 ? "accent" : "muted",
    },
  ];

  const colorMap = {
    income: "text-income",
    expense: "text-expense",
    accent: "text-accent",
    muted: "text-muted-foreground",
  };

  const bgMap = {
    income: "bg-income/10",
    expense: "bg-expense/10",
    accent: "bg-accent/10",
    muted: "bg-muted",
  };

  return (
    <BlurFade delay={delay} className="md:col-span-6">
      <div className="finance-card px-3 py-4 sm:p-5 h-full">
        <p className="label-mono mb-4">Key Numbers</p>

        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {numbers.map((n) => (
            <div key={n.label} className="rounded-xl bg-muted/30 px-3 py-3 sm:py-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <span className={cn("inline-flex items-center justify-center h-5 w-5 rounded-md", bgMap[n.color])}>
                  <n.icon className={cn("h-3 w-3", colorMap[n.color])} />
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none">{n.label}</span>
              </div>
              <p className={cn("text-xl sm:text-2xl font-bold tabular-nums leading-none", colorMap[n.color])}>
                {n.value}
              </p>
              {n.sub && (
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{n.sub}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </BlurFade>
  );
}
