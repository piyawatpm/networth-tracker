"use client";

import { useMemo } from "react";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ExpenseEntry, PaymentMethod } from "@/lib/utils/types";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLORS } from "@/lib/utils/constants";

interface PaymentMethodBreakdownProps {
  entries: ExpenseEntry[];
}

export function PaymentMethodBreakdown({ entries }: PaymentMethodBreakdownProps) {
  const { convert, format: formatCur } = useCurrency();

  const breakdown = useMemo(() => {
    const map: Partial<Record<PaymentMethod, number>> = {};
    for (const e of entries) {
      const method = e.paymentMethod ?? "other";
      map[method] = (map[method] ?? 0) + convert(e.amount, e.currency);
    }
    return Object.entries(map)
      .filter(([_, v]) => (v as number) > 0)
      .map(([method, value]) => ({
        method: method as PaymentMethod,
        label: PAYMENT_METHOD_LABELS[method as PaymentMethod],
        value: value as number,
        color: PAYMENT_METHOD_COLORS[method as PaymentMethod],
      }))
      .sort((a, b) => b.value - a.value);
  }, [entries, convert]);

  const hasRealMethods = breakdown.some((b) => b.method !== "other");
  if (!hasRealMethods && breakdown.length <= 1) return null;

  const total = breakdown.reduce((s, b) => s + b.value, 0);

  return (
    <div className="space-y-3">
      <p className="label-mono">By Payment Method</p>
      <div className="space-y-2">
        {breakdown.map((item) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div key={item.method} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                </div>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatCur(item.value)} ({pct.toFixed(0)}%)
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: item.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
