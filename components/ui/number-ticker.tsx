"use client";

import NumberFlow, { type Format } from "@number-flow/react";
import { cn } from "@/lib/utils";

interface NumberTickerProps {
  value: number;
  className?: string;
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
}

// Odometer-style money figure: each digit column slides up or down to its
// new value (direction follows the change), instead of the old spring that
// tweened the whole number and rewrote every digit ~60×/s — visible as a
// slot-machine churn of random digits on every live tick. Also no more
// "count up from 0" on mount: the first render is the real number.
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function NumberTicker({
  value,
  className,
  decimalPlaces = 2,
  prefix = "",
  suffix = "",
}: NumberTickerProps) {
  const format: Format = {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  };
  return (
    <NumberFlow
      value={Number.isFinite(value) ? value : 0}
      locales="en-US"
      format={format}
      prefix={prefix}
      suffix={suffix}
      className={cn("inline-flex items-baseline tabular-nums", className)}
      spinTiming={{ duration: 700, easing: EASE }}
      transformTiming={{ duration: 700, easing: EASE }}
      opacityTiming={{ duration: 300, easing: "ease-out" }}
      willChange
    />
  );
}
