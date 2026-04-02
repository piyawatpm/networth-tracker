"use client";

import { useMemo } from "react";
import { useLocalStorage } from "./use-local-storage";
import type { CustomIncomeCategory, IncomeType } from "@/lib/utils/types";
import {
  INCOME_TYPE_LABELS,
  INCOME_TYPE_COLORS,
  CHART_COLORS,
} from "@/lib/utils/constants";

const DEFAULT_TYPES = Object.keys(INCOME_TYPE_LABELS) as IncomeType[];

export function useIncomeCategories() {
  const [customCategories, setCustomCategories] = useLocalStorage<
    CustomIncomeCategory[]
  >("custom_income_categories", []);

  // Merged label map: defaults + custom
  const allLabels = useMemo(() => {
    const map: Record<string, string> = { ...INCOME_TYPE_LABELS };
    for (const c of customCategories) {
      map[c.id] = c.label;
    }
    return map;
  }, [customCategories]);

  // Merged color map: defaults + custom
  const allColors = useMemo(() => {
    const map: Record<string, string> = { ...INCOME_TYPE_COLORS };
    for (const c of customCategories) {
      map[c.id] = c.color;
    }
    return map;
  }, [customCategories]);

  // Ordered list of all type keys
  const allTypes = useMemo(() => {
    const custom = customCategories.map((c) => c.id);
    return [...DEFAULT_TYPES, ...custom];
  }, [customCategories]);

  function addCategory(label: string, color: string) {
    const id = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    if (!id || allLabels[id]) return;
    setCustomCategories((prev) => [...prev, { id, label, color }]);
  }

  function removeCategory(id: string) {
    if ((INCOME_TYPE_LABELS as Record<string, string>)[id]) return;
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

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
