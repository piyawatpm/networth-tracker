"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useInView, useMotionValue, useSpring } from "motion/react";

interface NumberTickerProps {
  value: number;
  direction?: "up" | "down";
  delay?: number;
  className?: string;
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
}

function formatNumber(value: number, decimalPlaces: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

export function NumberTicker({
  value,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 2,
  prefix = "",
  suffix = "",
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const motionValue = useMotionValue(direction === "down" ? value : 0);
  const springValue = useSpring(motionValue, {
    damping: 30,
    stiffness: 220,
    mass: 0.6,
  });

  useEffect(() => {
    if (!isInView) return;
    const t = setTimeout(() => {
      motionValue.set(direction === "down" ? 0 : value);
    }, delay);
    return () => clearTimeout(t);
  }, [motionValue, isInView, delay, value, direction]);

  useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = formatNumber(latest, decimalPlaces);
      }
    });
    return () => unsubscribe();
  }, [springValue, decimalPlaces]);

  return (
    <span className={cn("inline-flex items-baseline tabular-nums", className)}>
      {prefix}
      <span ref={ref}>{formatNumber(direction === "down" ? value : 0, decimalPlaces)}</span>
      {suffix}
    </span>
  );
}
