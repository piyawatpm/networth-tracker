"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  Shield,
  Cloud,
  CloudOff,
  RefreshCw,
  Check,
  Camera,
  ChevronDown,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import { cn } from "@/lib/utils";
import { getCurrencySymbol } from "@/lib/utils/types";

import { useSaveToCloud, useCloudStorage } from "@/components/providers/data-provider";

// Primary = always visible in top bar. Secondary = in "More" dropdown.
const PRIMARY_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/income", label: "Income", icon: TrendingUp },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/crypto", label: "Crypto", icon: Bitcoin },
];

const SECONDARY_NAV = [
  { href: "/liabilities", label: "Liabilities", icon: Handshake },
  { href: "/emergency-fund", label: "Emergency", icon: Shield },
  { href: "/budget", label: "Budget", icon: FileSpreadsheet },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/debug", label: "Debug", icon: LayoutDashboard },
];

const ALL_NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

// Mobile bottom bar: 4 primary + More
const MOBILE_NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/income", label: "Income", icon: TrendingUp },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
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
  const { status: syncStatus, lastSaveTime: lastSyncTime, save } = useSaveToCloud();

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

  const isSyncing = syncStatus === "saving";
  const isSynced = syncStatus === "saved";
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


function SnapshotButton() {
  const [status, setStatus] = useState<"idle" | "taking" | "done" | "error" | "prompt">("idle");
  const [manualHoldings, setManualHoldings] = useState<{ id: string; name: string; ticker: string; currentValue: number }[]>([]);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});

  // Read holdings to check which need manual input
  const [holdings] = useCloudStorage<{ id: string; name: string; ticker: string; type: string; currentValue: number }[]>("portfolio_holdings", []);

  const BALANCE_TYPES = new Set(["savings"]);

  function startSnapshot() {
    // Find holdings that can't auto-update and aren't savings/emergency
    const needsManual = (holdings ?? []).filter((h: { ticker: string; type: string }) => {
      if (BALANCE_TYPES.has(h.type)) return false; // savings/emergency don't need updates
      if (!h.ticker || h.ticker === "SUPER" || h.ticker.startsWith("IFM-")) return true; // can't auto-fetch
      return false;
    });

    if (needsManual.length > 0) {
      setManualHoldings(needsManual);
      const initial: Record<string, string> = {};
      for (const h of needsManual) initial[h.id] = h.currentValue.toString();
      setManualValues(initial);
      setStatus("prompt");
    } else {
      doSnapshot();
    }
  }

  async function doSnapshot(updatedValues?: Record<string, number>) {
    setStatus("taking");
    try {
      const res = await fetch("/api/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualUpdates: updatedValues }),
      });
      if (res.ok) {
        setStatus("done");
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  function submitManualValues() {
    const updates: Record<string, number> = {};
    for (const [id, val] of Object.entries(manualValues)) {
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed >= 0) updates[id] = parsed;
    }
    setManualHoldings([]);
    doSnapshot(updates);
  }

  return (
    <>
      <button
        onClick={startSnapshot}
        disabled={status === "taking"}
        title="Take snapshot now"
        className={cn(
          "flex items-center justify-center h-8 w-8 rounded-full transition-colors",
          status === "done" ? "bg-income/10 text-income" :
          status === "error" ? "bg-expense/10 text-expense" :
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        )}
      >
        {status === "taking" ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : status === "done" ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Camera className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Manual value prompt dialog */}
      {status === "prompt" && manualHoldings.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setStatus("idle")}>
          <div className="bg-popover rounded-xl shadow-xl ring-1 ring-border/50 p-5 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Update Values</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Enter current values for holdings that can&apos;t auto-fetch.
            </p>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {manualHoldings.map((h) => (
                <div key={h.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{h.name}</p>
                    {h.ticker && <p className="text-[10px] text-muted-foreground font-mono">{h.ticker}</p>}
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={manualValues[h.id] ?? ""}
                    onChange={(e) => setManualValues((prev) => ({ ...prev, [h.id]: e.target.value }))}
                    className="w-28 h-8 rounded-md border border-border bg-background px-2 text-xs tabular-nums text-right"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setStatus("idle"); setManualHoldings([]); }}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Skip
              </button>
              <button
                onClick={submitManualValues}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
              >
                Save & Snapshot
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);

  // Check if current path is in secondary nav (to highlight "More")
  const isSecondaryActive = SECONDARY_NAV.some((item) => pathname === item.href);

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Top nav (Liquid Glass) ── */}
      <header
        className="sticky top-0 z-50 liquid-glass-bar"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className="mr-3 text-sm font-bold tracking-tight"
            >
              Networth
            </Link>

            {/* Primary nav items */}
            <nav className="hidden md:flex items-center">
              {PRIMARY_NAV.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                      isActive
                        ? "bg-foreground/[0.06] text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]",
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              {/* "More" dropdown */}
              <div className="relative">
                <button
                  onClick={() => setMoreOpen(!moreOpen)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                    isSecondaryActive
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]",
                  )}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span>More</span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform", moreOpen && "rotate-180")} />
                </button>

                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 w-48 rounded-2xl liquid-glass p-1 z-50">
                      {SECONDARY_NAV.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMoreOpen(false)}
                            className={cn(
                              "relative z-10 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                              isActive
                                ? "liquid-glass-pill text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-white/[0.08]",
                            )}
                          >
                            <item.icon className={cn("h-4 w-4", isActive && "text-accent")} />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </nav>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-1">
            <SnapshotButton />
            <SaveButton />
            <ThemeToggle />
            <CurrencyToggle />
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main
        className="flex-1"
        style={{
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>

      {/* ── Mobile bottom nav (Liquid Glass) ── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden px-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        <nav className="liquid-glass rounded-[22px]">
          <div className="relative z-10 flex items-center justify-around h-[64px] px-1">
            {MOBILE_NAV.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="relative flex flex-col items-center justify-center gap-[3px] w-[60px] h-[52px] rounded-2xl transition-all duration-300"
                >
                  {isActive && (
                    <span className="absolute inset-[3px] rounded-xl liquid-glass-pill animate-in fade-in-0 zoom-in-90 duration-200" />
                  )}
                  <item.icon
                    className={cn(
                      "h-[21px] w-[21px] relative z-10 transition-all duration-300",
                      isActive ? "text-accent" : "text-muted-foreground/50",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[10px] font-semibold relative z-10 transition-all duration-300 leading-none",
                      isActive ? "text-foreground" : "text-muted-foreground/50",
                    )}
                  >
                    {item.label}
                  </span>
                  {isActive && (
                    <span className="absolute bottom-[2px] w-1 h-1 rounded-full bg-accent z-10 animate-in fade-in-0 zoom-in-50 duration-300" />
                  )}
                </Link>
              );
            })}
            {/* More */}
            <button
              onClick={() => setMobileDrawer(true)}
              className="relative flex flex-col items-center justify-center gap-[3px] w-[60px] h-[52px] rounded-2xl transition-all duration-300"
            >
              {isSecondaryActive && (
                <span className="absolute inset-[3px] rounded-xl liquid-glass-pill" />
              )}
              <MoreHorizontal
                className={cn(
                  "h-[21px] w-[21px] relative z-10 transition-all duration-300",
                  isSecondaryActive ? "text-accent" : "text-muted-foreground/50",
                )}
              />
              <span
                className={cn(
                  "text-[10px] font-semibold relative z-10 transition-all duration-300 leading-none",
                  isSecondaryActive ? "text-foreground" : "text-muted-foreground/50",
                )}
              >
                More
              </span>
              {isSecondaryActive && (
                <span className="absolute bottom-[2px] w-1 h-1 rounded-full bg-accent z-10" />
              )}
            </button>
          </div>
        </nav>
      </div>

      {/* ── Mobile drawer (Liquid Glass) ── */}
      {mobileDrawer && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-in fade-in-0 duration-200"
            onClick={() => setMobileDrawer(false)}
          />
          <div
            className="absolute bottom-0 left-0 right-0 px-3 animate-in slide-in-from-bottom duration-300"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
          >
            <div className="liquid-glass rounded-[22px]">
              <div className="relative z-10">
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-8 h-[3px] rounded-full bg-foreground/15" />
                </div>
                {/* Items */}
                <div className="px-2 pb-3">
                  {[...PRIMARY_NAV.slice(4), ...SECONDARY_NAV].map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileDrawer(false)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-200",
                          isActive
                            ? "liquid-glass-pill"
                            : "active:bg-white/[0.08]",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "h-5 w-5 transition-colors",
                            isActive ? "text-accent" : "text-muted-foreground/60",
                          )}
                        />
                        <span
                          className={cn(
                            "text-sm font-medium transition-colors",
                            isActive ? "text-foreground" : "text-muted-foreground/80",
                          )}
                        >
                          {item.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom padding for mobile floating nav + safe area */}
      <div className="h-24 md:hidden" />
    </div>
  );
}
