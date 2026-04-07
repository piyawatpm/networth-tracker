"use client";

import { useState } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Database,
  Zap,
  Bug,
  Trash2,
  Pencil,
  Check,
  X,
  Camera,
} from "lucide-react";
import type { RecurringExpense, RecurringIncome } from "@/lib/utils/types";

interface CronLogEntry {
  date: string;
  timestamp: string;
  success: boolean;
  log: string[];
}

export default function DebugPage() {
  const [cronLogs] = useCloudStorage<CronLogEntry[]>("cron_log", []);
  const [recurringExpenses] = useCloudStorage<RecurringExpense[]>("recurring_expense_templates", []);
  const [recurringIncomes] = useCloudStorage<RecurringIncome[]>("recurring_income_templates", []);
  const [expenseEntries] = useCloudStorage<{ id: string; isRecurring?: boolean; recurringId?: string; date: string; description: string }[]>("expense_entries", []);
  const [incomeEntries] = useCloudStorage<{ id: string; isRecurring?: boolean; recurringId?: string; date: string; description: string }[]>("income_entries", []);

  const [nwSnapshots, setNwSnapshots] = useCloudStorage<{ date: string; value: number; valueNoSuper?: number }[]>("networth_snapshots", []);
  const [portfolioSnapshots, setPortfolioSnapshots] = useCloudStorage<{ date: string; value: number; valueWithSuper: number }[]>("portfolio_snapshots", []);
  const [cryptoSnapshots, setCryptoSnapshots] = useCloudStorage<{ date: string; value: number; currency: string }[]>("crypto_snapshots", []);

  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [editingSnapshot, setEditingSnapshot] = useState<{ type: "nw" | "portfolio"; date: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editValue2, setEditValue2] = useState("");

  // Count generated recurring entries
  const recurringExpenseEntries = expenseEntries.filter((e) => e.isRecurring);
  const recurringIncomeEntries = incomeEntries.filter((e) => e.isRecurring);

  async function triggerCronManually() {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch("/api/cron/snapshot", {
        headers: { Authorization: `Bearer ${prompt("Enter CRON_SECRET:")}` },
      });
      const data = await res.json();
      setTriggerResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setTriggerResult(`Error: ${e}`);
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="space-y-8">
      <BlurFade delay={0}>
        <div className="flex items-center gap-3">
          <Bug className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Debug & Cron Status</h1>
        </div>
      </BlurFade>

      {/* Recurring Templates Status */}
      <BlurFade delay={0.05}>
        <div className="finance-card p-5">
          <p className="label-mono mb-4">Recurring Templates</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Income Templates */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-3.5 w-3.5 text-income" />
                <p className="text-sm font-medium text-income">
                  Income Templates ({recurringIncomes.length})
                </p>
              </div>
              {recurringIncomes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No templates</p>
              ) : (
                <div className="space-y-1.5">
                  {recurringIncomes.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-xs rounded-lg bg-secondary/30 px-3 py-2">
                      <div className="min-w-0">
                        <span className="font-medium">{t.description}</span>
                        <span className="text-muted-foreground ml-2">{t.frequency}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn("font-mono", t.active ? "text-income" : "text-muted-foreground")}>
                          {t.active ? "Active" : "Paused"}
                        </span>
                        <span className="text-muted-foreground/50 tabular-nums">
                          last: {t.lastGeneratedDate ?? "never"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-2">
                Generated entries: {recurringIncomeEntries.length}
              </p>
            </div>

            {/* Expense Templates */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-3.5 w-3.5 text-expense" />
                <p className="text-sm font-medium text-expense">
                  Expense Templates ({recurringExpenses.length})
                </p>
              </div>
              {recurringExpenses.length === 0 ? (
                <p className="text-xs text-muted-foreground">No templates</p>
              ) : (
                <div className="space-y-1.5">
                  {recurringExpenses.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-xs rounded-lg bg-secondary/30 px-3 py-2">
                      <div className="min-w-0">
                        <span className="font-medium">{t.description}</span>
                        <span className="text-muted-foreground ml-2">{t.frequency}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn("font-mono", t.active ? "text-income" : "text-muted-foreground")}>
                          {t.active ? "Active" : "Paused"}
                        </span>
                        <span className="text-muted-foreground/50 tabular-nums">
                          last: {t.lastGeneratedDate ?? "never"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-2">
                Generated entries: {recurringExpenseEntries.length}
              </p>
            </div>
          </div>
        </div>
      </BlurFade>

      {/* Cron Run History */}
      <BlurFade delay={0.1}>
        <div className="finance-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <p className="label-mono">Cron Run History</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={triggerCronManually}
              disabled={triggering}
              className="gap-1.5"
            >
              {triggering ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Trigger Manually
            </Button>
          </div>

          {triggerResult && (
            <div className="mb-4 rounded-lg bg-secondary/30 p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Manual Trigger Result</p>
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground overflow-x-auto">
                {triggerResult}
              </pre>
            </div>
          )}

          {cronLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No cron runs recorded yet. The cron runs daily at midnight (UTC).
            </p>
          ) : (
            <div className="space-y-3">
              {cronLogs.map((run, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg border p-3",
                    run.success ? "border-income/20" : "border-expense/20",
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {run.success ? (
                        <CheckCircle className="h-4 w-4 text-income" />
                      ) : (
                        <XCircle className="h-4 w-4 text-expense" />
                      )}
                      <span className="text-sm font-medium">{run.date}</span>
                      <span className={cn(
                        "text-[10px] font-mono px-1.5 py-0.5 rounded",
                        run.success ? "bg-income/10 text-income" : "bg-expense/10 text-expense",
                      )}>
                        {run.success ? "SUCCESS" : "FAILED"}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {new Date(run.timestamp).toLocaleString("en-AU", {
                        timeZone: "Australia/Sydney",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {run.log.map((line, j) => (
                      <p key={j} className="text-[11px] font-mono text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </BlurFade>

      {/* Net Worth Snapshots */}
      <BlurFade delay={0.15}>
        <div className="finance-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <p className="label-mono">Net Worth Snapshots ({nwSnapshots.length})</p>
            </div>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive text-[10px]"
              onClick={() => { if (confirm("Clear ALL net worth snapshots?")) setNwSnapshots([]); }}
            >
              Clear All
            </Button>
          </div>
          {nwSnapshots.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No snapshots</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Value (w/ Super)</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Value (no Super)</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...nwSnapshots].reverse().map((s) => {
                    const isEditing = editingSnapshot?.type === "nw" && editingSnapshot.date === s.date;
                    return (
                      <tr key={s.date} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-mono tabular-nums">{s.date}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {isEditing ? (
                            <Input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-6 w-24 text-xs tabular-nums px-1.5 ml-auto" />
                          ) : (
                            s.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {isEditing ? (
                            <Input type="number" value={editValue2} onChange={(e) => setEditValue2(e.target.value)} className="h-6 w-24 text-xs tabular-nums px-1.5 ml-auto" />
                          ) : (
                            (s.valueNoSuper ?? s.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon-xs" onClick={() => {
                                const v = parseFloat(editValue);
                                const v2 = parseFloat(editValue2);
                                if (!isNaN(v)) {
                                  setNwSnapshots((prev) => prev.map((snap) =>
                                    snap.date === s.date ? { ...snap, value: v, valueNoSuper: isNaN(v2) ? v : v2 } : snap
                                  ));
                                }
                                setEditingSnapshot(null);
                              }}>
                                <Check className="h-3 w-3 text-income" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" onClick={() => setEditingSnapshot(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon-xs" onClick={() => {
                                setEditingSnapshot({ type: "nw", date: s.date });
                                setEditValue(s.value.toString());
                                setEditValue2((s.valueNoSuper ?? s.value).toString());
                              }}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={() => {
                                setNwSnapshots((prev) => prev.filter((snap) => snap.date !== s.date));
                              }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </BlurFade>

      {/* Portfolio Snapshots */}
      <BlurFade delay={0.2}>
        <div className="finance-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <p className="label-mono">Portfolio Snapshots ({portfolioSnapshots.length})</p>
            </div>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive text-[10px]"
              onClick={() => { if (confirm("Clear ALL portfolio snapshots?")) setPortfolioSnapshots([]); }}
            >
              Clear All
            </Button>
          </div>
          {portfolioSnapshots.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No snapshots</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Value (no Super)</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Value (w/ Super)</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...portfolioSnapshots].reverse().map((s) => {
                    const isEditing = editingSnapshot?.type === "portfolio" && editingSnapshot.date === s.date;
                    return (
                      <tr key={s.date} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-mono tabular-nums">{s.date}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {isEditing ? (
                            <Input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-6 w-24 text-xs tabular-nums px-1.5 ml-auto" />
                          ) : (
                            s.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {isEditing ? (
                            <Input type="number" value={editValue2} onChange={(e) => setEditValue2(e.target.value)} className="h-6 w-24 text-xs tabular-nums px-1.5 ml-auto" />
                          ) : (
                            s.valueWithSuper.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon-xs" onClick={() => {
                                const v = parseFloat(editValue);
                                const v2 = parseFloat(editValue2);
                                if (!isNaN(v)) {
                                  setPortfolioSnapshots((prev) => prev.map((snap) =>
                                    snap.date === s.date ? { ...snap, value: v, valueWithSuper: isNaN(v2) ? v : v2 } : snap
                                  ));
                                }
                                setEditingSnapshot(null);
                              }}>
                                <Check className="h-3 w-3 text-income" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" onClick={() => setEditingSnapshot(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon-xs" onClick={() => {
                                setEditingSnapshot({ type: "portfolio", date: s.date });
                                setEditValue(s.value.toString());
                                setEditValue2(s.valueWithSuper.toString());
                              }}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={() => {
                                setPortfolioSnapshots((prev) => prev.filter((snap) => snap.date !== s.date));
                              }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </BlurFade>

      {/* Crypto Snapshots */}
      <BlurFade delay={0.25}>
        <div className="finance-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <p className="label-mono">Crypto Snapshots ({cryptoSnapshots.length})</p>
            </div>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive text-[10px]"
              onClick={() => { if (confirm("Clear ALL crypto snapshots?")) setCryptoSnapshots([]); }}
            >
              Clear All
            </Button>
          </div>
          {cryptoSnapshots.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No snapshots</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Value</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Currency</th>
                    <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cryptoSnapshots].reverse().map((s) => {
                    const isEditing = editingSnapshot?.type === "portfolio" && editingSnapshot.date === `crypto-${s.date}`;
                    return (
                      <tr key={s.date} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-mono tabular-nums">{s.date}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {isEditing ? (
                            <Input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-6 w-24 text-xs tabular-nums px-1.5 ml-auto" />
                          ) : (
                            s.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">{s.currency}</td>
                        <td className="px-2 py-1.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon-xs" onClick={() => {
                                const v = parseFloat(editValue);
                                if (!isNaN(v)) {
                                  setCryptoSnapshots((prev) => prev.map((snap) =>
                                    snap.date === s.date ? { ...snap, value: v } : snap
                                  ));
                                }
                                setEditingSnapshot(null);
                              }}>
                                <Check className="h-3 w-3 text-income" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" onClick={() => setEditingSnapshot(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon-xs" onClick={() => {
                                setEditingSnapshot({ type: "portfolio", date: `crypto-${s.date}` });
                                setEditValue(s.value.toString());
                              }}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={() => {
                                setCryptoSnapshots((prev) => prev.filter((snap) => snap.date !== s.date));
                              }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </BlurFade>
    </div>
  );
}
