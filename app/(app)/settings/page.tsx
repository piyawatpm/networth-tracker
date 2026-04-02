"use client";

import { useState, useRef } from "react";
import { useTheme } from "next-themes";
import { useCurrency } from "@/components/providers/currency-provider";
import { ALL_CURRENCIES, getCurrencySymbol } from "@/lib/utils/types";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Download,
  Upload,
  Trash2,
  Sun,
  Moon,
  Database,
  Shield,
  Cloud,
  Check,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// localStorage keys we manage
// ---------------------------------------------------------------------------
const ALL_STORAGE_KEYS = [
  "income_entries",
  "expense_entries",
  "crypto_csv_text",
  "portfolio_holdings",
  "debt_records",
  "debt_transactions",
  "preferred_currency",
  "fx_rates_cache",
  "networth_snapshots",
  "networth_goal",
  "portfolio_snapshots",
  "price_cache",
  "price_update_log",
  "recurring_expense_templates",
  "recurring_income_templates",
  "expense_categories",
] as const;

function getStorageSize(): string {
  let total = 0;
  for (const key of ALL_STORAGE_KEYS) {
    const item = localStorage.getItem(key);
    if (item) total += item.length * 2; // UTF-16
  }
  if (total > 1_000_000) return `${(total / 1_000_000).toFixed(1)} MB`;
  if (total > 1_000) return `${(total / 1_000).toFixed(1)} KB`;
  return `${total} B`;
}

function getKeyCount(): number {
  let count = 0;
  for (const key of ALL_STORAGE_KEYS) {
    if (localStorage.getItem(key)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { currency, setCurrency, enabledCurrencies, setEnabledCurrencies, ratesFetchedAt, ratesLoaded } = useCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [storageInfo, setStorageInfo] = useState<{ size: string; keys: number } | null>(null);

  // Refresh storage info
  function refreshStorage() {
    setStorageInfo({ size: getStorageSize(), keys: getKeyCount() });
  }

  // Show storage info on first render
  if (typeof window !== "undefined" && !storageInfo) {
    refreshStorage();
  }

  // ---- Export ----------------------------------------------------------------
  function handleExport() {
    const data: Record<string, unknown> = {};
    for (const key of ALL_STORAGE_KEYS) {
      const item = localStorage.getItem(key);
      if (item) {
        try {
          data[key] = JSON.parse(item);
        } catch {
          data[key] = item;
        }
      }
    }

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `networth-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setStatus({ type: "success", message: "Backup exported successfully" });
    setTimeout(() => setStatus(null), 3000);
  }

  // ---- Import ----------------------------------------------------------------
  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (typeof data !== "object" || data === null) {
          throw new Error("Invalid backup format");
        }

        let importedCount = 0;
        for (const [key, value] of Object.entries(data)) {
          if (ALL_STORAGE_KEYS.includes(key as typeof ALL_STORAGE_KEYS[number])) {
            localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
            importedCount++;
          }
        }

        setStatus({
          type: "success",
          message: `Imported ${importedCount} data entries. Reload the page to see changes.`,
        });
        refreshStorage();
      } catch {
        setStatus({ type: "error", message: "Failed to import — invalid file format" });
      }
    };
    reader.readAsText(file);
  }

  // ---- Clear ----------------------------------------------------------------
  function handleClear() {
    for (const key of ALL_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
    setShowClearConfirm(false);
    setStatus({ type: "success", message: "All data cleared. Reload the page." });
    refreshStorage();
  }

  const lastFxUpdate = ratesFetchedAt
    ? new Date(ratesFetchedAt).toLocaleString("en-AU", {
        timeZone: "Australia/Sydney",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";

  return (
    <div className="max-w-2xl space-y-8">
      <BlurFade delay={0}>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your data, preferences, and backups.
        </p>
      </BlurFade>

      {/* Status message */}
      {status && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-3 text-sm",
            status.type === "success"
              ? "bg-income/10 text-income"
              : "bg-expense/10 text-expense"
          )}
        >
          {status.type === "success" ? (
            <Check className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          {status.message}
        </div>
      )}

      {/* ================================================================= */}
      {/* Appearance                                                         */}
      {/* ================================================================= */}
      <BlurFade delay={0.05}>
        <section className="finance-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Appearance</h2>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Theme</p>
              <p className="text-xs text-muted-foreground">Switch between light and dark mode</p>
            </div>
            <div className="flex items-center rounded-full bg-secondary p-0.5 gap-0.5">
              {[
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
              ].map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    theme === t.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <t.icon className="h-3 w-3" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </BlurFade>

      {/* ================================================================= */}
      {/* Currency                                                           */}
      {/* ================================================================= */}
      <BlurFade delay={0.1}>
        <section className="finance-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono text-sm">FX</span>
            <h2 className="text-sm font-semibold">Currency</h2>
          </div>

          {/* Display currency */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Display Currency</p>
              <p className="text-xs text-muted-foreground">All amounts converted to this currency</p>
            </div>
            <div className="flex items-center flex-wrap gap-1">
              {enabledCurrencies.map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={cn(
                    "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-mono font-medium transition-colors",
                    currency === c
                      ? "bg-foreground text-background"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  {getCurrencySymbol(c)} {c}
                </button>
              ))}
            </div>
          </div>

          {/* Manage currencies */}
          <div className="pt-2 border-t border-border/50">
            <p className="text-sm mb-2">Enabled Currencies</p>
            <p className="text-xs text-muted-foreground mb-3">
              Toggle currencies to show in the nav bar toggle. Click to add/remove.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ALL_CURRENCIES).map(([code, sym]) => {
                const isEnabled = enabledCurrencies.includes(code);
                return (
                  <button
                    key={code}
                    onClick={() => {
                      if (isEnabled) {
                        if (enabledCurrencies.length <= 1) return; // keep at least 1
                        setEnabledCurrencies(enabledCurrencies.filter((c) => c !== code));
                      } else {
                        setEnabledCurrencies([...enabledCurrencies, code]);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-colors border",
                      isEnabled
                        ? "bg-primary/10 border-primary/30 text-foreground"
                        : "bg-transparent border-border/50 text-muted-foreground hover:border-border"
                    )}
                  >
                    <span className="opacity-60">{sym}</span>
                    <span>{code}</span>
                    {isEnabled && <Check className="h-3 w-3 text-primary ml-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* FX status */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div>
              <p className="text-sm">FX Rates</p>
              <p className="text-xs text-muted-foreground">
                Source: open.er-api.com (free, no API key)
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs tabular-nums">
                {ratesLoaded ? (
                  <span className="text-income">Connected</span>
                ) : (
                  <span className="text-muted-foreground">Loading...</span>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Last: {lastFxUpdate}
              </p>
            </div>
          </div>
        </section>
      </BlurFade>

      {/* ================================================================= */}
      {/* Data Management                                                    */}
      {/* ================================================================= */}
      <BlurFade delay={0.15}>
        <section className="finance-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Data Management</h2>
          </div>

          {/* Storage info */}
          <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-4 py-3">
            <div>
              <p className="text-sm">Local Storage</p>
              <p className="text-xs text-muted-foreground">
                All data stored in your browser
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-mono tabular-nums">{storageInfo?.size ?? "—"}</p>
              <p className="text-[10px] text-muted-foreground">
                {storageInfo?.keys ?? 0} entries
              </p>
            </div>
          </div>

          {/* Export */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Export Backup</p>
              <p className="text-xs text-muted-foreground">
                Download all data as JSON file
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>

          {/* Import */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Import Backup</p>
              <p className="text-xs text-muted-foreground">
                Restore from a previously exported JSON file
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImport(file);
                e.target.value = "";
              }}
            />
          </div>

          {/* Clear all data */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div>
              <p className="text-sm text-destructive">Clear All Data</p>
              <p className="text-xs text-muted-foreground">
                Permanently delete all stored data
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </section>
      </BlurFade>

      {/* ================================================================= */}
      {/* Cloud Sync (Coming Soon)                                           */}
      {/* ================================================================= */}
      <BlurFade delay={0.2}>
        <section className="finance-card p-6 space-y-4 opacity-60">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Cloud Sync</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Coming Soon
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Sync to Database</p>
              <p className="text-xs text-muted-foreground">
                Turso (SQLite) — sync data across devices
              </p>
            </div>
            <Button variant="outline" size="sm" disabled className="gap-1.5">
              <Cloud className="h-3.5 w-3.5" />
              Connect
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Auto Backup</p>
              <p className="text-xs text-muted-foreground">
                Scheduled daily backups to cloud storage
              </p>
            </div>
            <Button variant="outline" size="sm" disabled>
              Enable
            </Button>
          </div>
        </section>
      </BlurFade>

      {/* ================================================================= */}
      {/* Security (Coming Soon)                                             */}
      {/* ================================================================= */}
      <BlurFade delay={0.25}>
        <section className="finance-card p-6 space-y-4 opacity-60">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Security</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Coming Soon
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Authentication</p>
              <p className="text-xs text-muted-foreground">
                Protect your data with login
              </p>
            </div>
            <Button variant="outline" size="sm" disabled>
              Set Up
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Data Encryption</p>
              <p className="text-xs text-muted-foreground">
                Encrypt sensitive financial data at rest
              </p>
            </div>
            <Button variant="outline" size="sm" disabled>
              Enable
            </Button>
          </div>
        </section>
      </BlurFade>

      {/* ================================================================= */}
      {/* App Info                                                           */}
      {/* ================================================================= */}
      <BlurFade delay={0.3}>
        <div className="text-center text-xs text-muted-foreground/50 space-y-1 pb-8">
          <p>Networth Tracker v1.0</p>
          <p>Data stored locally in your browser. Export regularly.</p>
        </div>
      </BlurFade>

      {/* Clear confirmation dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear All Data</DialogTitle>
            <DialogDescription>
              This will permanently delete all your income, expenses, portfolio,
              crypto, debts, goals, and settings. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleClear}>
              Yes, Clear Everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
