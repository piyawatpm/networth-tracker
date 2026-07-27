"use client";

import { useCurrency } from "@/components/providers/currency-provider";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";

function pct(v: number | null): string {
  if (v == null) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export function PerfStats({
  xirrPct,
  twrPct,
  twrLabel,
  netGainUsd,
  gainPct,
  gainSub,
  vs,
}: {
  xirrPct: number | null;
  twrPct: number | null;
  twrLabel: string;
  netGainUsd: number;
  /** Gain as a fraction of capital (cost basis / net contributions), for the % display. */
  gainPct: number | null;
  gainSub: string;
  vs: { label: string; pct: number | null; sub: string };
}) {
  const { format, convert } = useCurrency();
  const gain = convert(netGainUsd, "USD");

  const tiles = [
    {
      label: "XIRR / YR",
      value: pct(xirrPct),
      tone: xirrPct == null ? "muted" : xirrPct >= 0 ? "up" : "down",
      sub: "money-weighted, annualized",
    },
    {
      label: `TWR · ${twrLabel}`,
      value: pct(twrPct),
      tone: twrPct == null ? "muted" : twrPct >= 0 ? "up" : "down",
      sub: "strategy return, deposits stripped",
    },
    {
      label: "NET GAIN",
      value: `${gain >= 0 ? "+" : "-"}${format(Math.abs(gain))}${gainPct == null ? "" : ` (${pct(gainPct)})`}`,
      tone: gain >= 0 ? "up" : "down",
      sub: gainSub,
    },
    {
      label: vs.label,
      value: vs.pct == null ? "—" : `${vs.pct >= 0 ? "+" : ""}${(vs.pct * 100).toFixed(1)}pp`,
      tone: vs.pct == null ? "muted" : vs.pct >= 0 ? "up" : "down",
      sub: vs.sub,
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t, i) => (
        <BlurFade key={t.label} delay={0.05 + i * 0.05}>
          <div className="finance-card p-4 sm:p-5">
            <p className="label-mono mb-1.5">{t.label}</p>
            <p
              className={cn(
                "text-xl sm:text-2xl font-semibold tabular-nums",
                t.tone === "up" && "text-income",
                t.tone === "down" && "text-expense",
                t.tone === "muted" && "text-muted-foreground",
              )}
            >
              {t.value}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">{t.sub}</p>
          </div>
        </BlurFade>
      ))}
    </div>
  );
}
