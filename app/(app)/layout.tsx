"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  Bitcoin,
  Briefcase,
  Handshake,
  Moon,
  Sun,
  Settings,
  FileSpreadsheet,
  AlertTriangle,
  X,
  Cloud,
  CloudOff,
  RefreshCw,
  Check,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import { cn } from "@/lib/utils";
import { getCurrencySymbol } from "@/lib/utils/types";
import { generateSampleData } from "@/app/(app)/seed/page";
import { SyncProvider, useSyncStatus } from "@/components/providers/sync-provider";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/income", label: "Income", icon: TrendingUp },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/crypto", label: "Crypto", icon: Bitcoin },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/liabilities", label: "Liabilities", icon: Handshake },
  { href: "/budget", label: "Budget", icon: FileSpreadsheet },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="flex items-center justify-center h-8 w-8 rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-secondary/80"
    >
      <Sun className="h-3.5 w-3.5 rotate-0 scale-100 transition-transform dark:rotate-90 dark:scale-0" />
      <Moon className="absolute h-3.5 w-3.5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
    </button>
  );
}

function CurrencyToggle() {
  const { currency, setCurrency, cycleCurrency, enabledCurrencies, rates, ratesFetchedAt, ratesLoaded } = useCurrency();
  const [open, setOpen] = useState(false);
  const usePopover = enabledCurrencies.length > 3;

  // Build FX pairs from enabled currencies vs USD
  const fxPairs = rates
    ? enabledCurrencies
        .filter((c) => c !== "USD")
        .slice(0, 8)
        .map((c) => ({
          label: `${c}/USD`,
          value: (1 / (rates[c] ?? 1)).toFixed(4),
        }))
    : [];

  const lastUpdated = ratesFetchedAt
    ? new Date(ratesFetchedAt).toLocaleString("en-AU", {
        timeZone: "Australia/Sydney",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  function handleClick() {
    if (usePopover) {
      setOpen((v) => !v);
    } else {
      cycleCurrency();
    }
  }

  function selectCurrency(c: string) {
    setCurrency(c);
    setOpen(false);
  }

  return (
    <div className={cn("relative", !usePopover && "group")}>
      <button
        onClick={handleClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-sm font-mono font-medium transition-colors hover:bg-secondary/80 cursor-pointer"
      >
        <span className="text-xs opacity-60">FX</span>
        <span>{getCurrencySymbol(currency)}</span>
        <span className="text-xs">{currency}</span>
        {ratesLoaded && (
          <span className="h-1.5 w-1.5 rounded-full bg-income" />
        )}
      </button>

      {/* Popover for > 3 currencies */}
      {usePopover && open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-popover p-3 shadow-lg ring-1 ring-border/50 z-50 animate-in fade-in-0 zoom-in-95 duration-100">
            <p className="label-mono mb-2">Display Currency</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {enabledCurrencies.map((c) => (
                <button
                  key={c}
                  onClick={() => selectCurrency(c)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono font-medium transition-colors",
                    currency === c
                      ? "bg-foreground text-background"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  )}
                >
                  {getCurrencySymbol(c)} {c}
                </button>
              ))}
            </div>

            {fxPairs.length > 0 && (
              <>
                <p className="label-mono mb-2">Live Rates</p>
                <div className="space-y-1.5">
                  {fxPairs.map((pair) => (
                    <div key={pair.label} className="flex items-center justify-between">
                      <span className="text-muted-foreground font-mono text-xs">{pair.label}</span>
                      <span className="font-mono tabular-nums text-xs">{pair.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {lastUpdated && (
              <div className="pt-2 mt-2 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground/60">
                  Source: open.er-api.com · Updated: {lastUpdated}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Hover dropdown for ≤ 3 currencies */}
      {!usePopover && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg bg-popover p-3 shadow-lg ring-1 ring-border/50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50 pointer-events-none">
          {fxPairs.length > 0 && (
            <>
              <p className="label-mono mb-2.5">Live Exchange Rates</p>
              <div className="space-y-2">
                {fxPairs.map((pair) => (
                  <div key={pair.label} className="flex items-center justify-between">
                    <span className="text-muted-foreground font-mono text-xs">{pair.label}</span>
                    <span className="font-mono tabular-nums text-sm">{pair.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {lastUpdated && (
            <div className="pt-2 mt-2.5 border-t border-border/50">
              <p className="text-[10px] text-muted-foreground/60">Source: open.er-api.com</p>
              <p className="text-[10px] text-muted-foreground/60">Updated: {lastUpdated} (cached 24h)</p>
            </div>
          )}
          {!ratesLoaded && (
            <p className="text-[10px] text-muted-foreground/40 mt-2">Fetching rates...</p>
          )}
        </div>
      )}
    </div>
  );
}

function SaveButton() {
  const { syncStatus, lastSyncTime, save } = useSyncStatus();

  function formatTimeAgo(ts: number | null): string {
    if (!ts) return "Never";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // Next cron: midnight UTC
  function getNextCron(): string {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0); // next midnight UTC
    const diff = next.getTime() - now.getTime();
    const hrs = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    return `${hrs}h ${mins}m`;
  }

  const isSyncing = syncStatus === "syncing";
  const isSynced = syncStatus === "synced";
  const isError = syncStatus === "error";

  return (
    <div className="relative group">
      <button
        onClick={() => save()}
        disabled={isSyncing}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
          isSyncing && "bg-secondary text-muted-foreground",
          isSynced && "bg-income/10 text-income",
          isError && "bg-expense/10 text-expense",
          !isSyncing && !isSynced && !isError && "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        )}
      >
        {isSyncing ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : isSynced ? (
          <Check className="h-3.5 w-3.5" />
        ) : isError ? (
          <CloudOff className="h-3.5 w-3.5" />
        ) : (
          <Cloud className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline text-xs">
          {isSyncing ? "Saving..." : isSynced ? "Saved" : isError ? "Failed" : "Save"}
        </span>
      </button>

      {/* Hover tooltip */}
      <div className="absolute right-0 top-full mt-2 w-52 rounded-lg bg-popover p-3 shadow-lg ring-1 ring-border/50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50 pointer-events-none">
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Last saved</span>
            <span className="font-mono">{formatTimeAgo(lastSyncTime)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Next snapshot</span>
            <span className="font-mono">in {getNextCron()}</span>
          </div>
          <div className="pt-1.5 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground/60">
              Click to save to cloud. Also auto-saves when you close the tab.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoBanner() {
  const [visible, setVisible] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const isDemo = localStorage.getItem("demo_data_active") === "true";
    if (isDemo) {
      setVisible(true);
      return;
    }

    // First visit detection: check if app has any data
    const hasIncome = localStorage.getItem("income_entries");
    const hasExpenses = localStorage.getItem("expense_entries");
    const hasPortfolio = localStorage.getItem("portfolio_holdings");

    const isEmpty =
      (!hasIncome || hasIncome === "[]") &&
      (!hasExpenses || hasExpenses === "[]") &&
      (!hasPortfolio || hasPortfolio === "[]");

    if (isEmpty) {
      // Auto-seed demo data
      const data = generateSampleData();
      localStorage.setItem("income_entries", JSON.stringify(data.incomeEntries));
      localStorage.setItem("expense_entries", JSON.stringify(data.expenseEntries));
      localStorage.setItem("portfolio_holdings", JSON.stringify(data.portfolioHoldings));
      localStorage.setItem("crypto_csv_text", JSON.stringify(data.cryptoCsvText));
      localStorage.setItem("debt_records", JSON.stringify(data.debtRecords));
      localStorage.setItem("debt_transactions", JSON.stringify(data.debtTransactions));
      localStorage.setItem("networth_snapshots", JSON.stringify(data.networthSnapshots));
      localStorage.setItem("portfolio_snapshots", JSON.stringify(data.portfolioSnapshots));
      localStorage.setItem("networth_goals", JSON.stringify(data.networthGoals));
      localStorage.removeItem("networth_goal");
      localStorage.setItem("recurring_income_templates", JSON.stringify(data.recurringIncomeTemplates));
      localStorage.setItem("recurring_expense_templates", JSON.stringify(data.recurringExpenseTemplates));
      localStorage.setItem("price_update_log", JSON.stringify(data.priceUpdateLog));
      localStorage.setItem("enabled_currencies", JSON.stringify(["AUD", "USD", "THB", "EUR"]));
      localStorage.setItem("demo_data_active", "true");
      setVisible(true);
      router.refresh();
    }
  }, [router]);

  function handleClear() {
    localStorage.clear();
    localStorage.removeItem("demo_data_active");
    setVisible(false);
    router.refresh();
  }

  function handleDismiss() {
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2">
      <div className="mx-auto max-w-7xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-amber-800 dark:text-amber-200">
            <strong>Demo Mode</strong> — You&apos;re viewing sample data. Go to{" "}
            <button onClick={handleClear} className="underline font-medium hover:no-underline">
              Settings
            </button>{" "}
            to clear and start fresh, or dismiss this banner to explore.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleClear}
            className="text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-500/20 hover:bg-amber-500/30 px-3 py-1 rounded-full transition-colors"
          >
            Clear All Data
          </button>
          <button
            onClick={handleDismiss}
            className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <SyncProvider>
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      {/* Desktop top nav */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className="mr-4 text-base font-semibold tracking-tight"
            >
              Networth
            </Link>
            <nav className="hidden md:flex items-center gap-0.5">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-foreground/[0.06] text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-1.5">
            <SaveButton />
            <Link
              href="/settings"
              className="flex items-center justify-center h-8 w-8 rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-secondary/80"
            >
              <Settings className="h-3.5 w-3.5" />
            </Link>
            <ThemeToggle />
            <CurrencyToggle />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/90 backdrop-blur-md md:hidden">
        <div className="flex items-center justify-around h-16 px-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <item.icon
                  className={cn("h-5 w-5", isActive && "text-accent")}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Bottom padding for mobile nav */}
      <div className="h-16 md:hidden" />
    </div>
    </SyncProvider>
  );
}
