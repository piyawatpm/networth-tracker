"use client";

import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { format, parse } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import "react-day-picker/style.css";

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export function DatePicker({
  value,
  onChange,
  className,
  placeholder = "Pick a date",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const selected = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;

  function handleSelect(day: Date | undefined) {
    if (day) {
      onChange(format(day, "yyyy-MM-dd"));
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors",
              "hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              !value && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="tabular-nums">
          {value ? format(selected!, "d MMM yyyy") : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <DayPicker
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={handleSelect}
          showOutsideDays
          className="rdp-custom"
          classNames={{
            months: "flex gap-4",
            month_caption: "flex items-center justify-center h-7",
            caption_label: "text-sm font-medium",
            nav: "flex items-center gap-1 absolute inset-x-0 justify-between z-10",
            button_previous: "h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-muted",
            button_next: "h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-muted",
            weekdays: "flex",
            weekday: "w-8 text-center text-[10px] font-mono uppercase text-muted-foreground",
            week: "flex",
            day: "w-8 h-8 text-center text-sm",
            day_button: "w-8 h-8 rounded-md hover:bg-muted transition-colors inline-flex items-center justify-center tabular-nums",
            today: "font-bold text-foreground",
            selected: "!bg-primary !text-primary-foreground rounded-md",
            outside: "text-muted-foreground/40",
            disabled: "text-muted-foreground/30",
          }}
          components={{
            Chevron: ({ orientation }) =>
              orientation === "left" ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              ),
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
