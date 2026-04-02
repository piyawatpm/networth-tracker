"use client";

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
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import { cn } from "@/lib/utils";
import { getCurrencySymbol } from "@/lib/utils/types";

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
  const { currency, cycleCurrency, enabledCurrencies, rates, ratesFetchedAt, ratesLoaded } = useCurrency();

  // Build FX pairs from enabled currencies vs USD
  const fxPairs = rates
    ? enabledCurrencies
        .filter((c) => c !== "USD")
        .slice(0, 5)
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

  return (
    <div className="relative group">
      <button
        onClick={cycleCurrency}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-sm font-mono font-medium transition-colors hover:bg-secondary/80 cursor-pointer"
      >
        <span className="text-xs opacity-60">FX</span>
        <span>{getCurrencySymbol(currency)}</span>
        <span className="text-xs">{currency}</span>
        {ratesLoaded && (
          <span className="h-1.5 w-1.5 rounded-full bg-income" />
        )}
      </button>

      {/* Hover dropdown */}
      <div className="absolute right-0 top-full mt-2 w-56 rounded-lg bg-popover p-3 shadow-lg ring-1 ring-border/50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
        <p className="label-mono mb-2.5">Live Exchange Rates</p>
        <div className="space-y-2">
          {fxPairs.map((pair) => (
            <div
              key={pair.label}
              className="flex items-center justify-between"
            >
              <span className="text-muted-foreground font-mono text-xs">
                {pair.label}
              </span>
              <span className="font-mono tabular-nums text-sm">{pair.value}</span>
            </div>
          ))}
        </div>
        {lastUpdated && (
          <div className="pt-2 mt-2.5 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground/60">
              Source: open.er-api.com
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              Updated: {lastUpdated} (cached 24h)
            </p>
          </div>
        )}
        {!ratesLoaded && (
          <p className="text-[10px] text-muted-foreground/40 mt-2">
            Fetching rates...
          </p>
        )}
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
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
  );
}
