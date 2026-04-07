"use client";

import { useState } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Database,
  Zap,
  Bug,
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

  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

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
    </div>
  );
}
