"use client";

import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import {
  getCurrentMonthKey,
  getLastMonthKey,
  getMonthDateRange,
  getYTDStartDate,
  getSydneyDateString,
} from "@/lib/utils/timezone";

export type DatePreset = "this_month" | "last_month" | "last_90" | "ytd" | "custom";

export interface DateRange {
  from: string;
  to: string;
}

interface DateRangeFilterProps {
  value: DatePreset;
  customRange: DateRange;
  onChange: (preset: DatePreset, range: DateRange) => void;
}

function getPresetRange(preset: DatePreset): DateRange {
  const today = getSydneyDateString();
  switch (preset) {
    case "this_month":
      return getMonthDateRange(getCurrentMonthKey());
    case "last_month":
      return getMonthDateRange(getLastMonthKey());
    case "last_90": {
      const to = today;
      const d = new Date();
      d.setDate(d.getDate() - 89);
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { from, to };
    }
    case "ytd":
      return { from: getYTDStartDate(), to: today };
    default:
      return { from: today, to: today };
  }
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "last_90", label: "Last 90 Days" },
  { key: "ytd", label: "YTD" },
  { key: "custom", label: "Custom" },
];

export function DateRangeFilter({ value, customRange, onChange }: DateRangeFilterProps) {
  function handlePresetClick(preset: DatePreset) {
    if (preset === "custom") {
      onChange("custom", customRange);
    } else {
      onChange(preset, getPresetRange(preset));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => handlePresetClick(p.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              value === p.key
                ? "bg-foreground text-background"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex items-center gap-2">
          <DatePicker
            value={customRange.from}
            onChange={(v) => onChange("custom", { ...customRange, from: v })}
            className="w-auto"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <DatePicker
            value={customRange.to}
            onChange={(v) => onChange("custom", { ...customRange, to: v })}
            className="w-auto"
          />
        </div>
      )}
    </div>
  );
}

export { getPresetRange };
