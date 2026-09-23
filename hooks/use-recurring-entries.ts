"use client";

import { useCallback } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { getSydneyDateString, computeOccurrences } from "@/lib/utils/timezone";
import { nextDay } from "@/lib/utils/entry-helpers";
import type { RecurringFrequency } from "@/lib/utils/types";
import type { ListItem } from "@/lib/storage/list-change";

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
  setEntries: (value: E[] | ((prev: E[]) => E[])) => void,
  config: UseRecurringEntriesConfig<T, E>,
) {
  const [templates, setTemplates, patchTemplates] = useCloudStorage<T[]>(config.storageKey, []);
  const createEntry = config.createEntry;

  // No generation on page load: the server cron does it every 5 minutes from
  // the latest stored data. A web tab can hold an old copy, and generating
  // from it re-added occurrences deleted elsewhere or reverted edited ones.
  //
  // A NEW template is the exception: its occurrences can't exist anywhere yet
  // (their ids derive from the new template's id), so its past occurrences
  // are generated at once instead of waiting for the cron.
  const addTemplate = useCallback((template: T) => {
    const today = getSydneyDateString();
    const fromDate = template.lastGeneratedDate
      ? nextDay(template.lastGeneratedDate)
      : template.startDate;
    const dates =
      template.active && !(template.endDate && template.endDate < today) && fromDate <= today
        ? computeOccurrences(template.startDate, template.frequency, fromDate, today)
        : [];
    if (dates.length > 0) {
      const generated = dates.map((date) => createEntry(template, date));
      setEntries((prev) => [...prev, ...generated]);
    }
    setTemplates((prev) => [
      ...prev,
      dates.length > 0 ? { ...template, lastGeneratedDate: dates[dates.length - 1] } : template,
    ]);
  }, [setEntries, setTemplates, createEntry]);

  // Edits apply to the LATEST stored template and never move its
  // lastGeneratedDate backwards: this page's copy may predate a cron run, and
  // an older date would let the cron re-create occurrences deleted since.
  const updateTemplate = useCallback((updated: T) => {
    patchTemplates([
      {
        id: updated.id,
        apply: (stored) => {
          const storedThrough = typeof stored.lastGeneratedDate === "string" ? stored.lastGeneratedDate : "";
          const localThrough = updated.lastGeneratedDate ?? "";
          const through = storedThrough > localThrough ? storedThrough : localThrough;
          return { ...(updated as unknown as ListItem), ...(through ? { lastGeneratedDate: through } : {}) };
        },
      },
    ]);
  }, [patchTemplates]);

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, [setTemplates]);

  // Sets the opposite of what's on screen, on the latest stored template —
  // only `active` changes.
  const toggleTemplate = useCallback((id: string) => {
    const shown = templates.find((t) => t.id === id);
    if (!shown) return;
    const active = !shown.active;
    patchTemplates([{ id, apply: (stored) => ({ ...stored, active }) }]);
  }, [templates, patchTemplates]);

  return {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTemplate,
  };
}
