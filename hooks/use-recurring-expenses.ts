"use client";

import { useEffect, useRef } from "react";
import { useLocalStorage } from "./use-local-storage";
import type { RecurringExpense, ExpenseEntry } from "@/lib/utils/types";
import { getSydneyDateString, computeOccurrences } from "@/lib/utils/timezone";

export function useRecurringExpenses(
  entries: ExpenseEntry[],
  setEntries: (value: ExpenseEntry[] | ((prev: ExpenseEntry[]) => ExpenseEntry[])) => void,
) {
  const [templates, setTemplates] = useLocalStorage<RecurringExpense[]>(
    "recurring_expenses",
    [],
  );
  const hasGenerated = useRef(false);

  // Auto-generate missing entries on mount
  useEffect(() => {
    if (hasGenerated.current) return;
    if (templates.length === 0) return;

    hasGenerated.current = true;
    const today = getSydneyDateString();
    const newEntries: ExpenseEntry[] = [];
    const updatedTemplates = templates.map((t) => ({ ...t }));

    for (const template of updatedTemplates) {
      if (!template.active) continue;
      if (template.endDate && template.endDate < today) continue;

      const fromDate = template.lastGeneratedDate
        ? nextDay(template.lastGeneratedDate)
        : template.startDate;

      if (fromDate > today) continue;

      const occurrences = computeOccurrences(
        template.startDate,
        template.frequency,
        fromDate,
        today,
      );

      // Filter out dates that already have an entry with this recurringId
      const existingDates = new Set(
        entries
          .filter((e) => e.recurringId === template.id)
          .map((e) => e.date),
      );

      for (const date of occurrences) {
        if (existingDates.has(date)) continue;
        newEntries.push({
          id: crypto.randomUUID(),
          type: template.type,
          description: template.description,
          amount: template.amount,
          currency: template.currency,
          vendor: template.vendor,
          paymentMethod: template.paymentMethod,
          date,
          notes: template.notes,
          images: [],
          createdAt: Date.now(),
          isRecurring: true,
          recurringId: template.id,
        });
      }

      if (occurrences.length > 0) {
        template.lastGeneratedDate = occurrences[occurrences.length - 1];
      }
    }

    if (newEntries.length > 0) {
      setEntries((prev) => [...prev, ...newEntries]);
      setTemplates(updatedTemplates);
    }
  }, [templates, entries, setEntries, setTemplates]);

  function addTemplate(template: RecurringExpense) {
    setTemplates((prev) => [...prev, template]);
  }

  function updateTemplate(updated: RecurringExpense) {
    setTemplates((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t)),
    );
  }

  function deleteTemplate(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  function toggleTemplate(id: string) {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)),
    );
  }

  return {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTemplate,
  };
}

function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
