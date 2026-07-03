"use client";

import { useState, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrency } from "@/components/providers/currency-provider";
import { getSydneyDateString } from "@/lib/utils/timezone";
import type {
  DebtRecord,
  DebtTransaction,
  DebtDirection,
  Currency,
} from "@/lib/utils/types";

// ---------------------------------------------------------------------------
// LiabilityDialog
// ---------------------------------------------------------------------------

interface LiabilityDialogProps {
  debt?: DebtRecord;
  onSave: (d: DebtRecord) => void;
  trigger: React.ReactNode;
}

export function LiabilityDialog({ debt, onSave, trigger }: LiabilityDialogProps) {
  const { enabledCurrencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState(debt?.person ?? "");
  const [direction, setDirection] = useState<DebtDirection>(
    debt?.direction ?? "i_owe"
  );
  const [reason, setReason] = useState(debt?.reason ?? "");
  const [originalAmount, setOriginalAmount] = useState(
    debt?.originalAmount?.toString() ?? ""
  );
  const [currency, setCurrency] = useState<Currency>(debt?.currency ?? "AUD");
  const [notes, setNotes] = useState(debt?.notes ?? "");

  // Reset form when dialog opens or debt changes
  useEffect(() => {
    if (open) {
      setPerson(debt?.person ?? "");
      setDirection(debt?.direction ?? "i_owe");
      setReason(debt?.reason ?? "");
      setOriginalAmount(debt?.originalAmount?.toString() ?? "");
      setCurrency(debt?.currency ?? "AUD");
      setNotes(debt?.notes ?? "");
    }
  }, [open, debt]);

  function handleSave() {
    const parsed = parseFloat(originalAmount);
    if (!person.trim() || !reason.trim() || isNaN(parsed) || parsed <= 0) {
      return;
    }

    const saved: DebtRecord = {
      id: debt?.id ?? crypto.randomUUID(),
      person: person.trim(),
      direction,
      reason: reason.trim(),
      originalAmount: parsed,
      currency,
      notes: notes.trim(),
      images: debt?.images ?? [],
      createdAt: debt?.createdAt ?? Date.now(),
    };

    onSave(saved);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{debt ? "Edit Entry" : "Add Entry"}</DialogTitle>
          <DialogDescription>
            {debt
              ? "Update the details of this record."
              : "Record a new liability between you and someone else."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Person */}
          <div className="grid gap-1.5">
            <Label htmlFor="debt-person">Person</Label>
            <Input
              id="debt-person"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              placeholder="e.g. John"
            />
          </div>

          {/* Direction */}
          <div className="grid gap-1.5">
            <Label htmlFor="debt-direction">Direction</Label>
            <Select
              value={direction}
              onValueChange={(v) => v && setDirection(v as DebtDirection)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="i_owe">I Owe</SelectItem>
                <SelectItem value="owed_to_me">Owed to Me</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Reason */}
          <div className="grid gap-1.5">
            <Label htmlFor="debt-reason">Reason</Label>
            <Input
              id="debt-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Dinner split, Loan, etc."
            />
          </div>

          {/* Amount + Currency */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="debt-amount">Original Amount</Label>
              <Input
                id="debt-amount"
                type="number"
                min="0"
                step="0.01"
                value={originalAmount}
                onChange={(e) => setOriginalAmount(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="debt-currency">Currency</Label>
              <Select
                value={currency}
                onValueChange={(v) => v && setCurrency(v as Currency)}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enabledCurrencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes */}
          <div className="grid gap-1.5">
            <Label htmlFor="debt-notes">Notes (optional)</Label>
            <Textarea
              id="debt-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional details"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={handleSave}>
            {debt ? "Save Changes" : "Add Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// PaymentDialog
// ---------------------------------------------------------------------------

interface PaymentDialogProps {
  debtId: string;
  direction: DebtDirection;
  personName: string;
  transaction?: DebtTransaction;
  onSave: (t: DebtTransaction) => void;
  trigger: React.ReactNode;
}

export function PaymentDialog({
  debtId,
  direction,
  personName,
  transaction,
  onSave,
  trigger,
}: PaymentDialogProps) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"pay" | "borrow">("pay");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getSydneyDateString());
  const [notes, setNotes] = useState("");

  const isOwedToMe = direction === "owed_to_me";
  const isEditing = Boolean(transaction);

  useEffect(() => {
    if (open) {
      if (transaction) {
        setAction(transaction.amount >= 0 ? "pay" : "borrow");
        setAmount(Math.abs(transaction.amount).toString());
        setDate(transaction.date);
        setNotes(transaction.notes);
      } else {
        setAction("pay");
        setAmount("");
        setDate(getSydneyDateString());
        setNotes("");
      }
    }
  }, [open, transaction]);

  // Labels based on direction + action
  const payLabel = isOwedToMe ? `${personName} Paid Back` : "I Paid Back";
  const borrowLabel = isOwedToMe ? `${personName} Borrowed More` : "I Borrowed More";

  function handleSave() {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;

    // "pay" reduces debt (positive), "borrow" increases debt (negative)
    const finalAmount = action === "pay" ? parsed : -parsed;

    const saved: DebtTransaction = {
      id: transaction?.id ?? crypto.randomUUID(),
      debtId,
      amount: finalAmount,
      date,
      notes: notes.trim(),
      images: transaction?.images ?? [],
      createdAt: transaction?.createdAt ?? Date.now(),
    };

    onSave(saved);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? "Edit Transaction"
              : isOwedToMe
                ? `${personName} owes you`
                : `You owe ${personName}`}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this payment or borrowing record."
              : "Record a payment or additional borrowing."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Action toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAction("pay")}
              className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                action === "pay"
                  ? "border-income bg-income/10 text-income"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {payLabel}
            </button>
            <button
              onClick={() => setAction("borrow")}
              className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                action === "borrow"
                  ? "border-expense bg-expense/10 text-expense"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {borrowLabel}
            </button>
          </div>

          {/* Amount */}
          <div className="grid gap-1.5">
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="tabular-nums"
            />
          </div>

          {/* Date */}
          <div className="grid gap-1.5">
            <Label htmlFor="payment-date">Date</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>

          {/* Notes */}
          <div className="grid gap-1.5">
            <Label htmlFor="payment-notes">Notes (optional)</Label>
            <Input
              id="payment-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={action === "pay" ? "e.g. Bank transfer" : "e.g. Dinner last night"}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            onClick={handleSave}
            disabled={isNaN(parseFloat(amount)) || parseFloat(amount) <= 0}
            className={action === "borrow" ? "bg-expense hover:bg-expense/90" : ""}
          >
            {isEditing
              ? "Save Changes"
              : action === "pay"
                ? "Record Payment"
                : "Record Borrowing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// DeleteConfirmDialog
// ---------------------------------------------------------------------------

interface DeleteConfirmDialogProps {
  title: string;
  description: string;
  onConfirm: () => void;
  trigger: React.ReactNode;
}

export function DeleteConfirmDialog({
  title,
  description,
  onConfirm,
  trigger,
}: DeleteConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  function handleConfirm() {
    onConfirm();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button variant="destructive" onClick={handleConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
