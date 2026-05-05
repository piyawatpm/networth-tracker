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
import { createClient } from "@/lib/supabase/client";
import { rowToCamel, rowToSnake } from "@/lib/supabase/tables";
import { clearSnapshotCache } from "@/lib/storage/snapshot-cache";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { currency, setCurrency, enabledCurrencies, setEnabledCurrencies, ratesFetchedAt, ratesLoaded } = useCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // ---- Export ----------------------------------------------------------------
  async function handleExport() {
    try {
      const supabase = createClient();
      const obj: Record<string, unknown> = {};

      // Entity tables — read from proper tables, convert to camelCase
      const entityTables = [
        "income_entries", "expense_entries",
        "recurring_income_templates", "recurring_expense_templates",
        "portfolio_holdings", "portfolio_transactions",
        "debt_records", "debt_transactions", "networth_goals",
      ];

      await Promise.all(
        entityTables.map(async (table) => {
          const { data } = await supabase.from(table).select("*");
          obj[table] = (data ?? []).map((r) => rowToCamel(r as Record<string, unknown>));
        }),
      );

      // Snapshots — export split by type (backward compatible key names)
      const { data: snapshots } = await supabase.from("snapshots").select("*").order("date");
      const allSnaps = (snapshots ?? []).map((r) => rowToCamel(r as Record<string, unknown>));
      obj["portfolio_snapshots"] = allSnaps.filter((s) => s.type === "portfolio").map(({ id, type, createdAt, ...rest }) => rest);
      obj["crypto_snapshots"] = allSnaps.filter((s) => s.type === "crypto").map(({ id, type, createdAt, ...rest }) => rest);
      obj["networth_snapshots"] = allSnaps.filter((s) => s.type === "networth").map(({ id, type, createdAt, ...rest }) => rest);

      // Custom categories — export split by kind (backward compatible)
      const { data: cats } = await supabase.from("custom_categories").select("*");
      obj["custom_income_categories"] = (cats ?? []).filter((c) => c.kind === "income").map(({ kind, ...r }) => r);
      obj["custom_expense_categories"] = (cats ?? []).filter((c) => c.kind === "expense").map(({ kind, ...r }) => r);

      // Cron logs
      const { data: cronLogs } = await supabase.from("cron_logs").select("*").order("created_at", { ascending: false }).limit(30);
      obj["cron_log"] = (cronLogs ?? []).map((r) => ({
        date: r.date,
        timestamp: r.timestamp,
        success: r.success,
        log: typeof r.log === "string" ? JSON.parse(r.log) : r.log,
      }));

      // KV settings (everything remaining in app_data)
      const { data: kvData } = await supabase.from("app_data").select("key, value");
      for (const row of kvData ?? []) {
        if (!obj[row.key]) {
          try { obj[row.key] = JSON.parse(row.value); } catch { obj[row.key] = row.value; }
        }
      }

      // Download as JSON
      const json = JSON.stringify(obj, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vesta-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setStatus({ type: "success", message: "Backup exported successfully" });
      setTimeout(() => setStatus(null), 3000);
    } catch {
      setStatus({ type: "error", message: "Failed to export data" });
      setTimeout(() => setStatus(null), 5000);
    }
  }

  // ---- Import ----------------------------------------------------------------
  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const obj = JSON.parse(e.target?.result as string);
        if (typeof obj !== "object" || obj === null) throw new Error("Invalid backup format");

        const supabase = createClient();

        // Entity tables
        const entityTables = [
          "income_entries", "expense_entries",
          "recurring_income_templates", "recurring_expense_templates",
          "portfolio_holdings", "portfolio_transactions",
          "debt_records", "debt_transactions", "networth_goals",
        ];
        for (const table of entityTables) {
          if (obj[table] && Array.isArray(obj[table])) {
            const snakeRows = (obj[table] as Record<string, unknown>[]).map(rowToSnake);
            if (snakeRows.length > 0) {
              await supabase.from(table).upsert(snakeRows);
            }
          }
        }

        // Snapshots
        const snapshotKeys: Record<string, string> = {
          portfolio_snapshots: "portfolio",
          crypto_snapshots: "crypto",
          networth_snapshots: "networth",
        };
        for (const [key, type] of Object.entries(snapshotKeys)) {
          if (obj[key] && Array.isArray(obj[key])) {
            // Delete existing, then insert
            await supabase.from("snapshots").delete().eq("type", type);
            const rows = (obj[key] as Record<string, unknown>[]).map((r) => {
              const snake = rowToSnake(r);
              delete snake["id"];
              snake["type"] = type;
              return snake;
            });
            if (rows.length > 0) {
              // Insert in chunks of 500
              for (let i = 0; i < rows.length; i += 500) {
                await supabase.from("snapshots").insert(rows.slice(i, i + 500));
              }
            }
          }
        }

        // Custom categories
        const categoryKeys: Record<string, string> = {
          custom_income_categories: "income",
          custom_expense_categories: "expense",
        };
        for (const [key, kind] of Object.entries(categoryKeys)) {
          if (obj[key] && Array.isArray(obj[key])) {
            await supabase.from("custom_categories").delete().eq("kind", kind);
            const rows = (obj[key] as Record<string, unknown>[]).map((r) => ({ ...r, kind }));
            if (rows.length > 0) {
              await supabase.from("custom_categories").insert(rows);
            }
          }
        }

        // KV settings — everything else goes to app_data
        const tableKeys = new Set([
          ...entityTables,
          ...Object.keys(snapshotKeys),
          ...Object.keys(categoryKeys),
          "cron_log",
        ]);
        const kvRows: { key: string; value: string; updated_at: string }[] = [];
        for (const [key, value] of Object.entries(obj)) {
          if (!tableKeys.has(key)) {
            kvRows.push({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
          }
        }
        if (kvRows.length > 0) {
          await supabase.from("app_data").upsert(kvRows, { onConflict: "key" });
        }

        // Import does delete-then-insert on the snapshots table, so any
        // localStorage snapshot cache we built up before is now stale.
        // Wipe it; next page load will rebuild from the imported data.
        clearSnapshotCache();

        setStatus({ type: "success", message: `Imported data. Reloading...` });
        setTimeout(() => window.location.reload(), 1000);
      } catch {
        setStatus({ type: "error", message: "Failed to import — invalid file format" });
      }
    };
    reader.readAsText(file);
  }

  // ---- Clear ----------------------------------------------------------------
  async function handleClear() {
    try {
      const supabase = createClient();
      const allTables = [
        "income_entries", "expense_entries",
        "recurring_income_templates", "recurring_expense_templates",
        "portfolio_holdings", "portfolio_transactions",
        "debt_records", "debt_transactions", "networth_goals",
        "custom_categories",
      ];
      // Delete from entity tables (id-based)
      await Promise.all(allTables.map((t) => supabase.from(t).delete().neq("id", "")));
      // Delete from UUID-based tables
      await supabase.from("snapshots").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("cron_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      // Delete KV
      await supabase.from("app_data").delete().neq("key", "");

      // Snapshot localStorage cache mirrors the snapshots table — clear it
      // too, otherwise the next load would resurrect old rows from the cache.
      clearSnapshotCache();

      setShowClearConfirm(false);
      setStatus({ type: "success", message: "All data cleared. Reloading..." });
      setTimeout(() => window.location.reload(), 1000);
    } catch {
      setStatus({ type: "error", message: "Failed to clear data" });
    }
  }

  // ---- Seed sample data ---------------------------------------------------
  async function handleSeed() {
    try {
      const { generateSampleData } = await import("@/app/(app)/seed/page");
      const data = generateSampleData();
      const supabase = createClient();

      // Entity tables
      const entityInserts = [
        { table: "income_entries", data: data.incomeEntries },
        { table: "expense_entries", data: data.expenseEntries },
        { table: "portfolio_holdings", data: data.portfolioHoldings },
        { table: "debt_records", data: data.debtRecords },
        { table: "debt_transactions", data: data.debtTransactions },
        { table: "recurring_income_templates", data: data.recurringIncomeTemplates },
        { table: "recurring_expense_templates", data: data.recurringExpenseTemplates },
        { table: "networth_goals", data: data.networthGoals },
      ];
      for (const { table, data: rows } of entityInserts) {
        if (rows && Array.isArray(rows) && rows.length > 0) {
          await supabase.from(table).upsert(rows.map((r) => rowToSnake(r as Record<string, unknown>)));
        }
      }

      // Snapshots
      const snapshotTypes = [
        { data: data.portfolioSnapshots, type: "portfolio" },
        { data: data.networthSnapshots, type: "networth" },
      ];
      for (const { data: snapRows, type } of snapshotTypes) {
        if (snapRows && Array.isArray(snapRows) && snapRows.length > 0) {
          const insertRows = snapRows.map((r) => {
            const snake = rowToSnake(r as Record<string, unknown>);
            delete snake["id"];
            snake["type"] = type;
            return snake;
          });
          await supabase.from("snapshots").insert(insertRows);
        }
      }

      // KV data (crypto CSV, settings)
      const kvRows = [
        { key: "crypto_csv_text", value: JSON.stringify(data.cryptoCsvText) },
        { key: "enabled_currencies", value: JSON.stringify(["AUD", "USD", "THB", "EUR"]) },
        data.priceUpdateLog ? { key: "price_update_log", value: JSON.stringify(data.priceUpdateLog) } : null,
      ].filter(Boolean).map((r) => ({ ...r!, updated_at: new Date().toISOString() }));

      if (kvRows.length > 0) {
        await supabase.from("app_data").upsert(kvRows, { onConflict: "key" });
      }

      // Seeding inserts fresh snapshots directly (bypassing persist()), so
      // the localStorage cache must be invalidated to avoid mixing seeded
      // rows with whatever was cached previously.
      clearSnapshotCache();

      setStatus({ type: "success", message: "Sample data loaded. Reloading..." });
      setTimeout(() => window.location.reload(), 1000);
    } catch {
      setStatus({ type: "error", message: "Failed to load sample data" });
    }
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
              <p className="text-sm">Cloud Storage</p>
              <p className="text-xs text-muted-foreground">
                All data stored in Supabase
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-income font-medium">Connected</p>
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

          {/* Generate sample data */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div>
              <p className="text-sm">Load Sample Data</p>
              <p className="text-xs text-muted-foreground">
                Populate with 6 months of realistic mock data
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeed}
              className="gap-1.5"
            >
              <Database className="h-3.5 w-3.5" />
              Generate
            </Button>
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
      {/* Security (Coming Soon)                                             */}
      {/* ================================================================= */}
      <BlurFade delay={0.2}>
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
      <BlurFade delay={0.25}>
        <div className="text-center text-xs text-muted-foreground/50 space-y-1 pb-8">
          <p>Networth Tracker v1.0</p>
          <p>Data stored in Supabase. Export regularly for backups.</p>
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
