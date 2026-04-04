"use client";

import { useMemo } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { CHART_COLORS } from "@/lib/utils/constants";
import { hashCode } from "@/lib/utils/entry-helpers";

interface CustomCategory {
  id: string;
  label: string;
  color: string;
}

interface UseCategoriesConfig {
  storageKey: string;
  defaultLabels: Record<string, string>;
  defaultColors: Record<string, string>;
}

export function useCategories({ storageKey, defaultLabels, defaultColors }: UseCategoriesConfig) {
  const [customCategories, setCustomCategories] = useCloudStorage<CustomCategory[]>(
    storageKey,
    [],
  );

  const defaultTypes = Object.keys(defaultLabels);

  const allLabels = useMemo(() => {
    const map: Record<string, string> = { ...defaultLabels };
    for (const c of customCategories) {
      map[c.id] = c.label;
    }
    return map;
  }, [customCategories, defaultLabels]);

  const allColors = useMemo(() => {
    const map: Record<string, string> = { ...defaultColors };
    for (const c of customCategories) {
      map[c.id] = c.color;
    }
    return map;
  }, [customCategories, defaultColors]);

  const allTypes = useMemo(() => {
    const custom = customCategories.map((c) => c.id);
    return [...defaultTypes, ...custom];
  }, [customCategories, defaultTypes]);

  function addCategory(label: string, color: string) {
    const id = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    if (!id || allLabels[id]) return;
    setCustomCategories((prev) => [...prev, { id, label, color }]);
  }

  function removeCategory(id: string) {
    if ((defaultLabels as Record<string, string>)[id]) return;
    setCustomCategories((prev) => prev.filter((c) => c.id !== id));
  }

  function getLabel(type: string): string {
    return allLabels[type] ?? type;
  }

  function getColor(type: string): string {
    return allColors[type] ?? CHART_COLORS[Math.abs(hashCode(type)) % CHART_COLORS.length];
  }

  return {
    allTypes,
    allLabels,
    allColors,
    customCategories,
    addCategory,
    removeCategory,
    getLabel,
    getColor,
  };
}
