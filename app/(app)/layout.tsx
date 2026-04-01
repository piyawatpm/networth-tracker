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
} from "lucide-react";
import { useCurrency } from "@/components/providers/currency-provider";
import { cn } from "@/lib/utils";
import { CURRENCY_SYMBOLS } from "@/lib/utils/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/income", label: "Income", icon: TrendingUp },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/crypto", label: "Crypto", icon: Bitcoin },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/debts", label: "Debts", icon: Handshake },
];

function CurrencyToggle() {
  const { currency, cycleCurrency, rates, ratesFetchedAt } = useCurrency();

  const fxPairs = rates
    ? [
        { label: "AUD/USD", value: (1 / (rates["AUD"] ?? 1)).toFixed(4) },
        { label: "USD/THB", value: (rates["THB"] ?? 1).toFixed(2) },
        { label: "AUD/THB", value: ((rates["THB"] ?? 1) / (rates["AUD"] ?? 1)).toFixed(2) },
      ]
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
    <Popover>
      <PopoverTrigger
        render={
          <button
            onClick={cycleCurrency}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-sm font-mono font-medium transition-colors hover:bg-secondary/80 cursor-pointer"
          />
        }
      >
        <span className="text-xs opacity-60">FX</span>
        <span>{CURRENCY_SYMBOLS[currency]}</span>
        <span className="text-xs">{currency}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-3">
        <div className="space-y-2">
          <p className="label-mono mb-2">Exchange Rates</p>
          {fxPairs.map((pair) => (
            <div
              key={pair.label}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted-foreground font-mono text-xs">
                {pair.label}
              </span>
              <span className="font-mono tabular-nums">{pair.value}</span>
            </div>
          ))}
          {lastUpdated && (
            <p className="text-[10px] text-muted-foreground/60 pt-1 border-t border-border mt-2">
              Updated {lastUpdated}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
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
              Life Investment
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
          <CurrencyToggle />
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
