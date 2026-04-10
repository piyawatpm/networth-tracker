"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface NumberTickerProps {
  value: number;
  direction?: "up" | "down";
  delay?: number;
  className?: string;
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
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
  const [displayValue, setDisplayValue] = useState(direction === "up" ? 0 : value);
  const prevValue = useRef(direction === "up" ? 0 : value);
  const startTime = useRef<number | null>(null);
  const animationFrame = useRef<number>(0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const startValue = prevValue.current;
    const endValue = value;
    const duration = isFirstRender.current ? 800 : 300;

    isFirstRender.current = false;

    // Skip animation if value didn't change
    if (startValue === endValue) return;

    const timeout = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startTime.current) startTime.current = timestamp;
        const elapsed = timestamp - startTime.current;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = startValue + (endValue - startValue) * eased;

        setDisplayValue(current);

        if (progress < 1) {
          animationFrame.current = requestAnimationFrame(animate);
        } else {
          prevValue.current = endValue;
        }
      };

      startTime.current = null;
      animationFrame.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(animationFrame.current);
      // Save where we are so next animation starts from here
      prevValue.current = displayValue;
    };
  }, [value, delay]);

  const formatted = displayValue.toLocaleString("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });

  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
