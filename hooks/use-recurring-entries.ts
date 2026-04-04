"use client";

import { useEffect, useRef, useMemo } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { getSydneyDateString, computeOccurrences } from "@/lib/utils/timezone";
import { nextDay } from "@/lib/utils/entry-helpers";
import type { RecurringFrequency } from "@/lib/utils/types";

interface UseRecurringEntriesConfig<T, E> {
  storageKey: string;
  createEntry: (template: T, date: string) => E;
}

export function useRecurringEntries<
  T extends {
    id: string;
    frequency: RecurringFrequency;
    startDate: string;
    endDate?: string;
    lastGeneratedDate?: string;
    active: boolean;
  },
  E extends { id: string; date: string; recurringId?: string },
>(
  entries: E[],
  setEntries: (value: E[] | ((prev: E[]) => E[])) => void,
  config: UseRecurringEntriesConfig<T, E>,
) {
  const [templates, setTemplates] = useCloudStorage<T[]>(config.storageKey, []);
  const hasGenerated = useRef(false);

  // Stabilize config reference to avoid re-triggering effect
  const createEntry = config.createEntry;
  const storageKey = config.storageKey;

  useEffect(() => {
    if (hasGenerated.current) return;
    if (templates.length === 0) return;

    hasGenerated.current = true;
    const today = getSydneyDateString();
    const newEntries: E[] = [];
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

      const existingDates = new Set(
        entries
          .filter((e) => e.recurringId === template.id)
          .map((e) => e.date),
      );

      for (const date of occurrences) {
        if (existingDates.has(date)) continue;
        newEntries.push(createEntry(template, date));
      }

      if (occurrences.length > 0) {
        template.lastGeneratedDate = occurrences[occurrences.length - 1];
      }
    }

    if (newEntries.length > 0) {
      setEntries((prev) => [...prev, ...newEntries]);
      setTemplates(updatedTemplates);
    }
  }, [templates, entries, setEntries, setTemplates, createEntry, storageKey]);

  function addTemplate(template: T) {
    setTemplates((prev) => [...prev, template]);
  }

  function updateTemplate(updated: T) {
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
