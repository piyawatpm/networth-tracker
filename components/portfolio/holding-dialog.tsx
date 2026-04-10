"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { HOLDING_TYPE_LABELS } from "@/lib/utils/constants";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/components/providers/currency-provider";
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

interface TickerResult {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
  country: string;
  logo?: string;
}

export function HoldingDialog({ holding, onSave, trigger }: HoldingDialogProps) {
  const { enabledCurrencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(holding?.name ?? "");
  const [ticker, setTicker] = useState(holding?.ticker ?? "");
  const [tickerResults, setTickerResults] = useState<TickerResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState<HoldingType>(holding?.type ?? "stock");
  const [accountType, setAccountType] = useState<AccountType>(
    holding?.accountType ?? "normal"
  );
  const [isEmergencyFund, setIsEmergencyFund] = useState(holding?.isEmergencyFund ?? false);
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
      setIsEmergencyFund(holding?.isEmergencyFund ?? false);
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

  // Ticker search with debounce
  const searchTicker = useCallback((query: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (query.length < 1) { setTickerResults([]); setShowResults(false); return; }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ticker-search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setTickerResults(data.results ?? []);
          setShowResults(true);
        }
      } catch { /* silent */ }
      setSearching(false);
    }, 300);
  }, []);

  function selectTicker(result: TickerResult) {
    setTicker(result.symbol);
    setName(result.name);
    setCountry(result.country);
    // Auto-set type based on Yahoo's quoteType
    if (result.type === "ETF") setType("etf");
    else if (result.type === "MUTUALFUND") setType("fund");
    else if (result.type === "BOND") setType("bond");
    else setType("stock");
    setShowResults(false);
    setTickerResults([]);
  }

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
      isEmergencyFund,
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
          {/* Name with search + logo dropdown */}
          <div className="grid gap-1.5 relative">
            <Label htmlFor="holding-name">Name</Label>
            <div className="relative">
              <Input
                id="holding-name"
                value={name}
                onChange={(e) => {
                  const val = e.target.value;
                  setName(val);
                  searchTicker(val);
                }}
                onFocus={() => { if (tickerResults.length > 0) setShowResults(true); }}
                placeholder="Search: Apple, Vanguard S&P 500..."
                autoComplete="off"
              />
              {searching && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                  searching...
                </span>
              )}
            </div>

            {/* Search results dropdown with logos */}
            {showResults && tickerResults.length > 0 && (
              <div
                ref={resultsRef}
                className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
              >
                {tickerResults.map((r) => (
                  <button
                    key={`${r.symbol}-${r.exchange}`}
                    type="button"
                    onClick={() => selectTicker(r)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/60 transition-colors"
                  >
                    <span className="h-6 w-6 shrink-0 rounded-full bg-secondary/60 overflow-hidden flex items-center justify-center">
                      {r.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.logo}
                          alt=""
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {r.symbol.slice(0, 2)}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-xs font-semibold w-16 shrink-0">{r.symbol}</span>
                    <span className="text-xs truncate flex-1">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground/50 shrink-0">{r.exchange}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowResults(false)}
                  className="w-full px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-secondary/30 transition-colors border-t border-border/50"
                >
                  Close
                </button>
              </div>
            )}
          </div>

          {/* Ticker (auto-filled from search, editable) */}
          <div className="grid gap-1.5">
            <Label htmlFor="holding-ticker">Ticker</Label>
            <Input
              id="holding-ticker"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g. AAPL, VAS"
              className="uppercase"
              autoComplete="off"
            />
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

          {/* Emergency Fund toggle */}
          <button
            type="button"
            onClick={() => setIsEmergencyFund(!isEmergencyFund)}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-secondary/50 hover:bg-secondary/80 transition-colors"
          >
            <span className="text-sm font-medium">Emergency Fund</span>
            <span className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
              isEmergencyFund ? "bg-income" : "bg-border"
            )}>
              <span className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                isEmergencyFund ? "translate-x-[18px]" : "translate-x-[3px]"
              )} />
            </span>
          </button>

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
                  {enabledCurrencies.map((c) => (
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
