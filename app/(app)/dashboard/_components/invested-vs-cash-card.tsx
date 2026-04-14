"use client";

import { motion } from "motion/react";
import { TrendingUp, Wallet } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";

interface InvestedVsCashCardProps {
  /** Total assets (gross holdings, no debts) in user currency */
  totalAssets: number;
  /** Cash / dry-powder total in user currency */
  cashTotal: number;
  format: (value: number) => string;
  delay: number;
}

export function InvestedVsCashCard({
  totalAssets,
  cashTotal,
  format,
  delay,
}: InvestedVsCashCardProps) {
  const invested = Math.max(0, totalAssets - cashTotal);
  const investedPct = totalAssets > 0 ? (invested / totalAssets) * 100 : 0;
  const cashPct = totalAssets > 0 ? (cashTotal / totalAssets) * 100 : 0;

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="label-mono">Capital Allocation</p>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Invested vs Cash
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
          {/* Invested */}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-income/15">
                <TrendingUp className="h-3 w-3 text-income" />
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Invested
              </span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-income">
              {format(invested)}
            </p>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {investedPct.toFixed(1)}% of total
            </p>
          </div>

          {/* Divider (desktop) */}
          <div className="hidden md:block h-10 w-px bg-border/60" />

          {/* Cash */}
          <div className="md:text-right">
            <div className="flex items-center gap-1.5 md:justify-end">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#4d7cc7]/15">
                <Wallet className="h-3 w-3 text-[#4d7cc7]" />
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Cash / Dry Powder
              </span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-[#4d7cc7]">
              {format(cashTotal)}
            </p>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {cashPct.toFixed(1)}% of total
            </p>
          </div>
        </div>

        {/* Stacked bar */}
        <div className="mt-5">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <motion.div
              className="h-full bg-income"
              initial={{ width: 0 }}
              animate={{ width: `${investedPct}%` }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.div
              className="h-full bg-[#4d7cc7]"
              initial={{ width: 0 }}
              animate={{ width: `${cashPct}%` }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-income" />
              Working
            </span>
            <span className="tabular-nums">
              Total {format(totalAssets)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#4d7cc7]" />
              Ready
            </span>
          </div>
        </div>

        {cashTotal === 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
            Tag holdings as <span className="font-medium text-foreground">Dry Powder</span>{" "}
            on the Portfolio or Crypto page to track what you can deploy on the next opportunity.
          </p>
        )}
      </div>
    </BlurFade>
  );
}
