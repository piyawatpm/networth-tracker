"use client";

import { useState, useMemo } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { useCurrency } from "@/components/providers/currency-provider";
import type { PortfolioHolding, ExpenseEntry, CryptoHolding } from "@/lib/utils/types";
import { parseAndComputeHoldings } from "@/lib/utils/crypto-csv";
import { normalizeExpenseEntry } from "@/lib/utils/types";
import { getLastNMonthKeys, getMonthKey } from "@/lib/utils/timezone";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
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
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  Bitcoin,
  Building2,
  Landmark,
  Banknote,
  PiggyBank,
  Wallet,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const FUND_LOCATIONS = [
  { value: "bank_savings", label: "Bank Savings", icon: Building2 },
  { value: "bank_term", label: "Term Deposit", icon: Landmark },
  { value: "bond", label: "Bonds", icon: Banknote },
  { value: "cash", label: "Cash / Offset", icon: Wallet },
  { value: "stablecoin", label: "Stablecoins", icon: PiggyBank },
  { value: "other", label: "Other", icon: PiggyBank },
] as const;

const LOCATION_COLORS: Record<string, string> = {
  bank_savings: "#4d7cc7",
  bank_term: "#2e8b57",
  bond: "#d4a033",
  cash: "#708090",
  stablecoin: "#2ea598",
  other: "#9e5e8e",
};

// ---------------------------------------------------------------------------
// Account Dialog
// ---------------------------------------------------------------------------

function AccountDialog({
  account,
  onSave,
  trigger,
}: {
  account?: PortfolioHolding;
  onSave: (h: PortfolioHolding) => void;
  trigger: React.ReactNode;
}) {
  const { enabledCurrencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account?.name ?? "");
  const [location, setLocation] = useState(account?.broker ?? "bank_savings");
  const [balance, setBalance] = useState(account?.currentValue?.toString() ?? "");
  const [currency, setCurrency] = useState(account?.currency ?? "AUD");
  const [notes, setNotes] = useState(account?.notes ?? "");

  function handleOpen(v: boolean) {
    if (v) {
      setName(account?.name ?? "");
      setLocation(account?.broker ?? "bank_savings");
      setBalance(account?.currentValue?.toString() ?? "");
      setCurrency(account?.currency ?? "AUD");
      setNotes(account?.notes ?? "");
    }
    setOpen(v);
  }

  function handleSave() {
    const parsed = parseFloat(balance);
    if (!name.trim() || isNaN(parsed) || parsed < 0) return;

    onSave({
      id: account?.id ?? crypto.randomUUID(),
      name: name.trim(),
      ticker: "",
      type: "savings",
      accountType: "normal",
      broker: location,
      country: "",
      link: "",
      units: 1,
      amountInvested: parsed,
      currentValue: parsed,
      currency,
      notes: notes.trim(),
      createdAt: account?.createdAt ?? Date.now(),
    });
    setOpen(false);
  }

  const locationLabel = FUND_LOCATIONS.find((l) => l.value === location)?.label ?? location;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{account ? "Edit Account" : "Add Account"}</DialogTitle>
          <DialogDescription>
            Track where your emergency fund is held.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Account Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ING Savings Maximiser" />
          </div>
          <div className="grid gap-1.5">
            <Label>Location / Type</Label>
            <Select value={location} onValueChange={(v) => v && setLocation(v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FUND_LOCATIONS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-1.5">
              <Label>Current Balance</Label>
              <Input type="number" min="0" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" className="tabular-nums" />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {enabledCurrencies.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 5.5% interest rate" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={handleSave}>{account ? "Update" : "Add Account"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EmergencyFundPage() {
  const [allHoldings, setHoldings] = useCloudStorage<PortfolioHolding[]>("portfolio_holdings", []);
  const [rawExpenses] = useCloudStorage<ExpenseEntry[]>("expense_entries", []);
  const [targetMonths, setTargetMonths] = useCloudStorage<number>("emergency_fund_target_months", 6);
  const [cryptoCsvText] = useCloudStorage<string>("crypto_csv_text", "");
  const [cryptoEmergencyTags] = useCloudStorage<Record<string, boolean>>("crypto_emergency_tags", {});
  const { convert, format, symbol } = useCurrency();

  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Crypto holdings tagged as emergency fund
  const cryptoHoldings = useMemo(() => cryptoCsvText ? parseAndComputeHoldings(cryptoCsvText) : [], [cryptoCsvText]);
  const cryptoEFHoldings = useMemo(() => cryptoHoldings.filter((h) => cryptoEmergencyTags[h.token]), [cryptoHoldings, cryptoEmergencyTags]);
  const cryptoEFTotal = useMemo(() => cryptoEFHoldings.reduce((s, h) => s + convert(h.currentValueUsd, "USD"), 0), [cryptoEFHoldings, convert]);

  // Filter emergency fund accounts: savings type OR explicitly tagged
  const savingsAccounts = useMemo(
    () => allHoldings.filter((h) => h.type === "savings" || h.isEmergencyFund),
    [allHoldings],
  );

  // Total emergency fund (portfolio + crypto)
  const portfolioEFTotal = useMemo(
    () => savingsAccounts.reduce((s, h) => s + convert(h.currentValue, h.currency), 0),
    [savingsAccounts, convert],
  );
  const totalFund = portfolioEFTotal + cryptoEFTotal;

  // Average monthly expenses (last 6 months)
  const expenses = useMemo(
    () => rawExpenses.map((e) => normalizeExpenseEntry(e as unknown as Record<string, unknown>)),
    [rawExpenses],
  );
  const monthKeys = useMemo(() => getLastNMonthKeys(6), []);
  const avgMonthlyExpense = useMemo(() => {
    const totals = monthKeys.map((mk) =>
      expenses
        .filter((e) => getMonthKey(e.date) === mk)
        .reduce((s, e) => s + convert(e.amount, e.currency), 0),
    );
    const withData = totals.filter((t) => t > 0);
    return withData.length > 0 ? withData.reduce((s, v) => s + v, 0) / withData.length : 0;
  }, [expenses, convert, monthKeys]);

  const targetAmount = avgMonthlyExpense * targetMonths;
  const coverageMonths = avgMonthlyExpense > 0 ? totalFund / avgMonthlyExpense : 0;
  const progressPct = targetAmount > 0 ? Math.min(100, (totalFund / targetAmount) * 100) : 0;
  const shortfall = Math.max(0, targetAmount - totalFund);
  const isOnTrack = totalFund >= targetAmount;

  // Location breakdown
  const locationBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of savingsAccounts) {
      const loc = h.broker || "other";
      map[loc] = (map[loc] ?? 0) + convert(h.currentValue, h.currency);
    }
    return Object.entries(map)
      .map(([loc, value]) => ({
        loc,
        label: FUND_LOCATIONS.find((l) => l.value === loc)?.label ?? loc,
        value,
        color: LOCATION_COLORS[loc] ?? "#708090",
        pct: totalFund > 0 ? (value / totalFund) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [savingsAccounts, convert, totalFund]);

  // Handlers
  function handleSave(h: PortfolioHolding) {
    setHoldings((prev) => {
      const idx = prev.findIndex((p) => p.id === h.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = h;
        return updated;
      }
      return [...prev, h];
    });
  }

  function handleDelete(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
    setDeleteId(null);
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <BlurFade delay={0}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <p className="label-mono">Emergency Fund</p>
            </div>
            <div className="display-number">
              <NumberTicker value={totalFund} prefix={symbol} decimalPlaces={0} />
            </div>
          </div>
          <AccountDialog
            onSave={handleSave}
            trigger={
              <Button className="gap-1.5 rounded-full px-4">
                <Plus className="h-4 w-4" />
                Add Account
              </Button>
            }
          />
        </div>
      </BlurFade>

      {/* Progress + Target */}
      <BlurFade delay={0.05}>
        <div className="finance-card p-5 space-y-4">
          {/* Target selector */}
          <div className="flex items-center justify-between">
            <p className="label-mono">Coverage Target</p>
            <div className="flex items-center gap-1.5">
              {[3, 6, 9, 12].map((m) => (
                <button
                  key={m}
                  onClick={() => setTargetMonths(m)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    targetMonths === m
                      ? "bg-foreground text-background"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  {m}mo
                </button>
              ))}
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="tabular-nums font-medium">
                {format(totalFund)}
                <span className="text-muted-foreground font-normal ml-1">
                  of {format(targetAmount)}
                </span>
              </span>
              <span className={cn(
                "text-xs font-semibold tabular-nums",
                isOnTrack ? "text-income" : progressPct >= 50 ? "text-foreground" : "text-expense",
              )}>
                {progressPct.toFixed(0)}%
              </span>
            </div>
            <div className="h-4 w-full rounded-full bg-muted overflow-hidden relative">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  isOnTrack ? "bg-income" : progressPct >= 50 ? "bg-[#d4a033]" : "bg-expense",
                )}
                style={{ width: `${progressPct}%` }}
              />
              {/* 3-month marker */}
              {targetMonths > 3 && (
                <div
                  className="absolute inset-y-0 w-px bg-foreground/20"
                  style={{ left: `${(3 / targetMonths) * 100}%` }}
                />
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 mt-1">
              <span>0</span>
              {targetMonths > 3 && <span>3mo</span>}
              <span>{targetMonths}mo</span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg bg-secondary/30 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Coverage</p>
              <p className={cn("text-base font-bold tabular-nums", coverageMonths >= targetMonths ? "text-income" : "text-foreground")}>
                {coverageMonths.toFixed(1)} mo
              </p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Expenses</p>
              <p className="text-base font-bold tabular-nums">{format(avgMonthlyExpense)}</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Target</p>
              <p className="text-base font-bold tabular-nums">{format(targetAmount)}</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {shortfall > 0 ? "Shortfall" : "Surplus"}
              </p>
              <p className={cn("text-base font-bold tabular-nums", shortfall > 0 ? "text-expense" : "text-income")}>
                {shortfall > 0 ? format(shortfall) : `+${format(totalFund - targetAmount)}`}
              </p>
            </div>
          </div>
        </div>
      </BlurFade>

      {/* Location Breakdown */}
      {locationBreakdown.length > 0 && (
        <BlurFade delay={0.1}>
          <div className="finance-card p-5">
            <p className="label-mono mb-4">Where It&apos;s Held</p>
            <div className="space-y-2.5">
              {locationBreakdown.map((loc) => (
                <div key={loc.loc} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: loc.color }} />
                      <span>{loc.label}</span>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {format(loc.value)} ({loc.pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${loc.pct}%`, backgroundColor: loc.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </BlurFade>
      )}

      {/* Accounts List */}
      <BlurFade delay={0.15}>
        <div className="space-y-3">
          <p className="label-mono">Accounts ({savingsAccounts.length})</p>

          {savingsAccounts.length === 0 ? (
            <div className="finance-card flex flex-col items-center justify-center gap-3 py-12">
              <Shield className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No emergency fund accounts yet</p>
              <AccountDialog
                onSave={handleSave}
                trigger={
                  <Button variant="outline" className="rounded-full gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add Account
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="space-y-2">
              {savingsAccounts
                .sort((a, b) => convert(b.currentValue, b.currency) - convert(a.currentValue, a.currency))
                .map((h) => {
                  const locationInfo = FUND_LOCATIONS.find((l) => l.value === h.broker);
                  const Icon = locationInfo?.icon ?? PiggyBank;
                  return (
                    <div key={h.id} className="finance-card p-4 flex items-center gap-4">
                      <div
                        className="flex items-center justify-center h-9 w-9 rounded-full shrink-0"
                        style={{ backgroundColor: (LOCATION_COLORS[h.broker] ?? "#708090") + "18" }}
                      >
                        <Icon className="h-4 w-4" style={{ color: LOCATION_COLORS[h.broker] ?? "#708090" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{h.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {locationInfo?.label ?? h.broker}
                          {h.notes && ` · ${h.notes}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold tabular-nums">
                          {format(h.currentValue, h.currency)}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono">{h.currency}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <AccountDialog
                          account={h}
                          onSave={handleSave}
                          trigger={
                            <Button variant="ghost" size="icon-xs">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        {deleteId === h.id ? (
                          <div className="flex gap-1">
                            <Button variant="destructive" size="xs" onClick={() => handleDelete(h.id)}>Delete</Button>
                            <Button variant="ghost" size="xs" onClick={() => setDeleteId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(h.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </BlurFade>

      {/* Crypto Holdings tagged as EF */}
      {cryptoEFHoldings.length > 0 && (
        <BlurFade delay={0.2}>
          <div className="space-y-3">
            <p className="label-mono">Crypto ({cryptoEFHoldings.length})</p>
            <div className="space-y-2">
              {cryptoEFHoldings
                .sort((a, b) => b.currentValueUsd - a.currentValueUsd)
                .map((h) => (
                  <div key={h.token} className="finance-card p-4 flex items-center gap-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-full shrink-0 bg-accent/10">
                      <Bitcoin className="h-4 w-4 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{h.token}</p>
                      <p className="text-xs text-muted-foreground">Crypto · tagged as EF</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums">{format(convert(h.currentValueUsd, "USD"))}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">USD</p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </BlurFade>
      )}
    </div>
  );
}
