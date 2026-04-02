"use client";

import { useState } from "react";
import { Settings2, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssetRow {
  key: string;
  label: string;
  value: number;
  negative: boolean;
}

export interface AssetBreakdownProps {
  rows: AssetRow[];
  hiddenSections: string[];
  onToggleSection: (key: string) => void;
  format: (amount: number) => string;
  delay: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssetBreakdown({
  rows,
  hiddenSections,
  onToggleSection,
  format,
  delay,
}: AssetBreakdownProps) {
  const [showSectionSettings, setShowSectionSettings] = useState(false);
  const isVisible = (key: string) => !hiddenSections.includes(key);

  return (
    <BlurFade delay={delay} className="md:col-span-5">
      <div className="relative">
        {/* Settings toggle */}
        <button
          onClick={() => setShowSectionSettings(!showSectionSettings)}
          className="absolute -top-1 right-0 p-1 rounded-md text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>

        {/* Section visibility editor */}
        <AnimatePresence>
          {showSectionSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-3"
            >
              <div className="rounded-lg bg-secondary/50 p-2.5 space-y-1">
                <p className="label-mono mb-1.5">Show / Hide</p>
                {rows.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => onToggleSection(item.key)}
                    className="flex items-center justify-between w-full px-2 py-1 rounded text-xs hover:bg-secondary transition-colors"
                  >
                    <span
                      className={cn(
                        !isVisible(item.key) && "text-muted-foreground/50",
                      )}
                    >
                      {item.label}
                    </span>
                    {isVisible(item.key) ? (
                      <Eye className="h-3 w-3 text-income" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-muted-foreground/40" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="divide-y divide-border">
          {rows
            .filter((row) => isVisible(row.key))
            .map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between py-3"
              >
                <span className="label-mono">{row.label}</span>
                <span
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    row.negative ? "text-expense" : "text-foreground",
                  )}
                >
                  {row.negative ? "-" : ""}
                  {format(Math.abs(row.value))}
                </span>
              </div>
            ))}
        </div>
      </div>
    </BlurFade>
  );
}
