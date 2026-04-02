"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EXPENSE_TYPE_LABELS } from "@/lib/utils/constants";
import type { CustomExpenseCategory } from "@/lib/utils/types";
import { Plus, Trash2 } from "lucide-react";

const PRESET_COLORS = [
  "#b8860b", "#2e8b57", "#cd5c5c", "#8b5e3c", "#6b8e23",
  "#708090", "#9e5e8e", "#c4a35a", "#2e7d5b", "#c05040",
  "#5f6b80", "#c4943a", "#2e7d7b", "#4d7cc7", "#d4a033",
];

interface ManageCategoriesDialogProps {
  customCategories: CustomExpenseCategory[];
  onAdd: (label: string, color: string) => void;
  onRemove: (id: string) => void;
  /** category ids that are currently in use by entries */
  usedCategoryIds: Set<string>;
  trigger: React.ReactNode;
}

export function ManageCategoriesDialog({
  customCategories,
  onAdd,
  onRemove,
  usedCategoryIds,
  trigger,
}: ManageCategoriesDialogProps) {
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [showForm, setShowForm] = useState(false);

  const defaultTypes = Object.entries(EXPENSE_TYPE_LABELS);

  function handleAdd() {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    onAdd(trimmed, newColor);
    setNewLabel("");
    setNewColor(PRESET_COLORS[(customCategories.length + 1) % PRESET_COLORS.length]);
    setShowForm(false);
  }

  return (
    <Dialog onOpenChange={() => { setShowForm(false); setNewLabel(""); }}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
          <DialogDescription>
            Default categories are always available. Add custom ones or remove unused custom categories.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Default categories */}
          <div className="space-y-1">
            <p className="label-mono mb-2">Default</p>
            <div className="flex flex-wrap gap-1.5">
              {defaultTypes.map(([id, label]) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: (EXPENSE_TYPE_LABELS as Record<string, string>)[id] ? undefined : "#708090" }}
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Custom categories */}
          <div className="space-y-2">
            <p className="label-mono">Custom</p>
            {customCategories.length === 0 && !showForm && (
              <p className="text-xs text-muted-foreground">
                No custom categories yet.
              </p>
            )}
            {customCategories.map((cat) => {
              const inUse = usedCategoryIds.has(cat.id);
              return (
                <div
                  key={cat.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-sm font-medium">{cat.label}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onRemove(cat.id)}
                    disabled={inUse}
                    title={inUse ? "Category is in use — remove entries first" : "Delete category"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}

            {/* Add new form */}
            {showForm ? (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="grid gap-2">
                  <Label className="text-xs">Category Name</Label>
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. Pet Care, Charity, Childcare"
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs">Color</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setNewColor(c)}
                        className={`h-6 w-6 rounded-full border-2 transition-all ${
                          newColor === c ? "border-foreground scale-110" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleAdd} disabled={!newLabel.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowForm(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Category
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
