"use client";

import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";

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

function DigitSlot({
  digit,
  goingUp,
  changeKey,
}: {
  digit: string;
  goingUp: boolean;
  changeKey: number;
}) {
  return (
    <span className="inline-block relative overflow-hidden" style={{ height: "1em" }}>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={changeKey}
          className="inline-block"
          initial={{ y: goingUp ? "100%" : "-100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: goingUp ? "-100%" : "100%", opacity: 0 }}
          transition={{
            y: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 },
            opacity: { duration: 0.15, ease: "easeOut" },
          }}
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  );
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
  const [visible, setVisible] = useState(delay === 0);
  const prevValueRef = useRef<number | null>(null);
  const prevFormattedRef = useRef("");
  const digitKeysRef = useRef<number[]>([]);

  useEffect(() => {
    if (delay > 0) {
      const t = setTimeout(() => setVisible(true), delay);
      return () => clearTimeout(t);
    }
  }, [delay]);

  const formatted = formatNumber(value, decimalPlaces);

  // Determine slide direction from value comparison
  const goingUp =
    prevValueRef.current === null
      ? direction === "up"
      : value >= prevValueRef.current;

  // Increment per-position keys only for digits that actually changed
  if (visible && formatted !== prevFormattedRef.current) {
    const prev = prevFormattedRef.current;
    const keys = digitKeysRef.current;
    for (let i = 0; i < formatted.length; i++) {
      if (i >= prev.length || formatted[i] !== prev[i]) {
        keys[i] = (keys[i] || 0) + 1;
      }
    }
    keys.length = formatted.length;
    prevFormattedRef.current = formatted;
    prevValueRef.current = value;
  }

  if (!visible) {
    return (
      <span className={cn("tabular-nums", className)}>
        {prefix}{formatNumber(0, decimalPlaces)}{suffix}
      </span>
    );
  }

  const chars = formatted.split("");

  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {chars.map((char, i) =>
        /\d/.test(char) ? (
          <DigitSlot
            key={i}
            digit={char}
            goingUp={goingUp}
            changeKey={digitKeysRef.current[i] || 0}
          />
        ) : (
          <span key={i}>{char}</span>
        )
      )}
      {suffix}
    </span>
  );
}
