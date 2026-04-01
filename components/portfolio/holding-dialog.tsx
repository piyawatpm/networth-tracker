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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HOLDING_TYPE_LABELS, CURRENCIES } from "@/lib/utils/constants";
import type {
  PortfolioHolding,
  HoldingType,
  AccountType,
  Currency,
} from "@/lib/utils/types";

interface HoldingDialogProps {
  holding?: PortfolioHolding;
  onSave: (h: PortfolioHolding) => void;
  trigger: React.ReactNode;
}

export function HoldingDialog({ holding, onSave, trigger }: HoldingDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(holding?.name ?? "");
  const [ticker, setTicker] = useState(holding?.ticker ?? "");
  const [type, setType] = useState<HoldingType>(holding?.type ?? "stock");
  const [accountType, setAccountType] = useState<AccountType>(
    holding?.accountType ?? "normal"
  );
  const [broker, setBroker] = useState(holding?.broker ?? "");
  const [country, setCountry] = useState(holding?.country ?? "");
  const [link, setLink] = useState(holding?.link ?? "");
  const [units, setUnits] = useState(holding?.units?.toString() ?? "");
  const [amountInvested, setAmountInvested] = useState(
    holding?.amountInvested?.toString() ?? ""
  );
  const [currentValue, setCurrentValue] = useState(
    holding?.currentValue?.toString() ?? ""
  );
  const [currency, setCurrency] = useState<Currency>(holding?.currency ?? "AUD");
  const [notes, setNotes] = useState(holding?.notes ?? "");

  // Reset form when opening for a new entry or switching entry
  useEffect(() => {
    if (open) {
      setName(holding?.name ?? "");
      setTicker(holding?.ticker ?? "");
      setType(holding?.type ?? "stock");
      setAccountType(holding?.accountType ?? "normal");
      setBroker(holding?.broker ?? "");
      setCountry(holding?.country ?? "");
      setLink(holding?.link ?? "");
      setUnits(holding?.units?.toString() ?? "");
      setAmountInvested(holding?.amountInvested?.toString() ?? "");
      setCurrentValue(holding?.currentValue?.toString() ?? "");
      setCurrency(holding?.currency ?? "AUD");
      setNotes(holding?.notes ?? "");
    }
  }, [open, holding]);

  function handleSave() {
    const parsedUnits = parseFloat(units);
    const parsedInvested = parseFloat(amountInvested);
    const parsedCurrent = parseFloat(currentValue);

    if (
      !name.trim() ||
      isNaN(parsedUnits) ||
      parsedUnits < 0 ||
      isNaN(parsedInvested) ||
      parsedInvested < 0 ||
      isNaN(parsedCurrent) ||
      parsedCurrent < 0
    ) {
      return;
    }

    const saved: PortfolioHolding = {
      id: holding?.id ?? crypto.randomUUID(),
      name: name.trim(),
      ticker: ticker.trim().toUpperCase(),
      type,
      accountType,
      broker: broker.trim(),
      country: country.trim(),
      link: link.trim(),
      units: parsedUnits,
      amountInvested: parsedInvested,
      currentValue: parsedCurrent,
      currency,
      notes: notes.trim(),
      createdAt: holding?.createdAt ?? Date.now(),
    };

    onSave(saved);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {holding ? "Edit Holding" : "Add Holding"}
          </DialogTitle>
          <DialogDescription>
            {holding
              ? "Update the details of this holding."
              : "Add a new investment holding to your portfolio."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Name + Ticker row */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="holding-name">Name</Label>
              <Input
                id="holding-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Vanguard S&P 500"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="holding-ticker">Ticker</Label>
              <Input
                id="holding-ticker"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder="VOO"
                className="w-24 uppercase"
              />
            </div>
          </div>

          {/* Type + Account Type row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => v && setType(v as HoldingType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(HOLDING_TYPE_LABELS) as HoldingType[]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {HOLDING_TYPE_LABELS[t]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Account</Label>
              <Select
                value={accountType}
                onValueChange={(v) => v && setAccountType(v as AccountType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="super">Super</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Broker + Country row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="holding-broker">Broker</Label>
              <Input
                id="holding-broker"
                value={broker}
                onChange={(e) => setBroker(e.target.value)}
                placeholder="e.g. CommSec"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="holding-country">Country</Label>
              <Input
                id="holding-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. AU"
              />
            </div>
          </div>

          {/* Link */}
          <div className="grid gap-1.5">
            <Label htmlFor="holding-link">Link (optional)</Label>
            <Input
              id="holding-link"
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://..."
            />
          </div>

          {/* Units */}
          <div className="grid gap-1.5">
            <Label htmlFor="holding-units">Units</Label>
            <Input
              id="holding-units"
              type="number"
              min="0"
              step="any"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </div>

          {/* Amount Invested + Currency row */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="holding-invested">Amount Invested</Label>
              <Input
                id="holding-invested"
                type="number"
                min="0"
                step="0.01"
                value={amountInvested}
                onChange={(e) => setAmountInvested(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <Select
                value={currency}
                onValueChange={(v) => v && setCurrency(v as Currency)}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Current Value */}
          <div className="grid gap-1.5">
            <Label htmlFor="holding-current">Current Value</Label>
            <Input
              id="holding-current"
              type="number"
              min="0"
              step="0.01"
              value={currentValue}
              onChange={(e) => setCurrentValue(e.target.value)}
              placeholder="0.00"
              className="tabular-nums"
            />
          </div>

          {/* Notes */}
          <div className="grid gap-1.5">
            <Label htmlFor="holding-notes">Notes (optional)</Label>
            <Textarea
              id="holding-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={handleSave}>
            {holding ? "Save Changes" : "Add Holding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
