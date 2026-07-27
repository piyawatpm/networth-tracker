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
  dividendsUsd,
  vsSpyPct,
}: {
  xirrPct: number | null;
  twrPct: number | null;
  twrLabel: string;
  netGainUsd: number;
  dividendsUsd: number;
  vsSpyPct: number | null;
}) {
  const { format, convert } = useCurrency();
  const gain = convert(netGainUsd, "USD");
  const divs = convert(dividendsUsd, "USD");

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
      value: `${gain >= 0 ? "+" : "-"}${format(Math.abs(gain))}`,
      tone: gain >= 0 ? "up" : "down",
      sub: divs > 0 ? `+ ${format(divs)} dividends received` : "value − net contributions",
    },
    {
      label: "VS S&P 500",
      value:
        vsSpyPct == null ? "—" : `${vsSpyPct >= 0 ? "+" : ""}${(vsSpyPct * 100).toFixed(1)}pp`,
      tone: vsSpyPct == null ? "muted" : vsSpyPct >= 0 ? "up" : "down",
      sub: "TWR minus SPY, same period",
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
