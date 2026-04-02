"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type {
  RecurringExpense,
  Currency,
  PaymentMethod,
  RecurringFrequency,
} from "@/lib/utils/types";
import {
  CURRENCIES,
  PAYMENT_METHOD_LABELS,
  FREQUENCY_LABELS,
} from "@/lib/utils/constants";
import { getSydneyDateString } from "@/lib/utils/timezone";
import { Plus, Pencil, Trash2, Pause, Play } from "lucide-react";

// ---------------------------------------------------------------------------
// Template Form (used for add/edit)
// ---------------------------------------------------------------------------

function RecurringForm({
  template,
  onSave,
  onCancel,
  categoryTypes,
  categoryLabels,
}: {
  template?: RecurringExpense;
  onSave: (t: RecurringExpense) => void;
  onCancel: () => void;
  categoryTypes: string[];
  categoryLabels: Record<string, string>;
}) {
  const [type, setType] = useState<string>(template?.type ?? (categoryTypes[0] ?? "food"));
  const [description, setDescription] = useState(template?.description ?? "");
  const [amount, setAmount] = useState(template?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(template?.currency ?? "AUD");
  const [vendor, setVendor] = useState(template?.vendor ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(template?.paymentMethod ?? "other");
  const [frequency, setFrequency] = useState<RecurringFrequency>(template?.frequency ?? "monthly");
  const [startDate, setStartDate] = useState(template?.startDate ?? getSydneyDateString());
  const [endDate, setEndDate] = useState(template?.endDate ?? "");

  const isValid =
    description.trim().length > 0 &&
    !isNaN(parseFloat(amount)) &&
    parseFloat(amount) > 0;

  function handleSave() {
    if (!isValid) return;
    onSave({
      id: template?.id ?? crypto.randomUUID(),
      type,
      description: description.trim(),
      amount: parseFloat(amount),
      currency,
      vendor: vendor.trim(),
      paymentMethod,
      notes: "",
      frequency,
      startDate,
      endDate: endDate || undefined,
      lastGeneratedDate: template?.lastGeneratedDate,
      active: template?.active ?? true,
      createdAt: template?.createdAt ?? Date.now(),
    });
  }

  const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];
  const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as RecurringFrequency[];

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => v && setType(v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categoryTypes.map((t) => (
              <SelectItem key={t} value={t}>{categoryLabels[t] ?? t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Monthly rent" />
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="grid gap-2">
          <Label>Amount</Label>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="tabular-nums" />
        </div>
        <div className="grid gap-2">
          <Label>Currency</Label>
          <Select value={currency} onValueChange={(v) => v && setCurrency(v as Currency)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-2">
          <Label>Vendor</Label>
          <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Landlord" />
        </div>
        <div className="grid gap-2">
          <Label>Payment Method</Label>
          <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (<SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Frequency</Label>
        <Select value={frequency} onValueChange={(v) => v && setFrequency(v as RecurringFrequency)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (<SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-2">
          <Label>Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>End Date (optional)</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!isValid}>
          {template ? "Update" : "Add Template"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Recurring Dialog
// ---------------------------------------------------------------------------

interface RecurringDialogProps {
  templates: RecurringExpense[];
  onAdd: (t: RecurringExpense) => void;
  onUpdate: (t: RecurringExpense) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  trigger: React.ReactNode;
  categoryTypes: string[];
  categoryLabels: Record<string, string>;
}

export function RecurringDialog({
  templates,
  onAdd,
  onUpdate,
  onDelete,
  onToggle,
  trigger,
  categoryTypes,
  categoryLabels,
}: RecurringDialogProps) {
  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [editTarget, setEditTarget] = useState<RecurringExpense | undefined>();

  function handleStartEdit(t: RecurringExpense) {
    setEditTarget(t);
    setMode("edit");
  }

  function handleSaveNew(t: RecurringExpense) {
    onAdd(t);
    setMode("list");
  }

  function handleSaveEdit(t: RecurringExpense) {
    onUpdate(t);
    setMode("list");
    setEditTarget(undefined);
  }

  return (
    <Dialog onOpenChange={() => { setMode("list"); setEditTarget(undefined); }}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recurring Expenses</DialogTitle>
          <DialogDescription>
            Manage your recurring expense templates. Active templates auto-generate entries.
          </DialogDescription>
        </DialogHeader>

        {mode === "list" && (
          <div className="space-y-3">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No recurring expenses set up yet.
              </p>
            ) : (
              templates.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition-opacity ${
                    !t.active ? "opacity-50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{t.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-[10px]">
                        {FREQUENCY_LABELS[t.frequency]}
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t.currency} {t.amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onToggle(t.id)}
                      title={t.active ? "Pause" : "Resume"}
                    >
                      {t.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleStartEdit(t)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDelete(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setMode("add")}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Recurring Expense
            </Button>
          </div>
        )}

        {mode === "add" && (
          <RecurringForm onSave={handleSaveNew} onCancel={() => setMode("list")} categoryTypes={categoryTypes} categoryLabels={categoryLabels} />
        )}

        {mode === "edit" && editTarget && (
          <RecurringForm
            template={editTarget}
            onSave={handleSaveEdit}
            onCancel={() => { setMode("list"); setEditTarget(undefined); }}
            categoryTypes={categoryTypes}
            categoryLabels={categoryLabels}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
