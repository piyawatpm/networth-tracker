"use client";

import { useMemo, useState } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import type { PortfolioHolding } from "@/lib/utils/types";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { CHART_COLORS } from "@/lib/utils/constants";
import { cn } from "@/lib/utils";
import { Boxes, Plus, Pencil, Trash2, ChevronDown } from "lucide-react";

/**
 * A user-defined basket of holdings — "Quantum", "AI" — synced with the iOS
 * app via the `portfolio_groups` blob. Ticker-keyed on purpose: holdings get
 * deleted and re-created by imports, tickers persist.
 */
export interface PortfolioGroup {
  id: string;
  name: string;
  tickers: string[];
  createdAt: number;
}

function GroupDialog({
  group, holdings, open, onOpenChange, onSave, format, convert,
}: {
  group: PortfolioGroup | null;
  holdings: PortfolioHolding[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (name: string, tickers: string[]) => void;
  format: (v: number, currency?: string, compact?: boolean) => string;
  convert: (v: number, from: string) => number;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Re-seed per open/target.
  const seedKey = `${group?.id ?? "new"}-${open}`;
  const [seeded, setSeeded] = useState("");
  if (open && seeded !== seedKey) {
    setSeeded(seedKey);
    setName(group?.name ?? "");
    setSelected(new Set((group?.tickers ?? []).map((t) => t.toUpperCase())));
  }

  const sorted = useMemo(
    () => holdings.slice().sort((a, b) => convert(b.currentValue, b.currency) - convert(a.currentValue, a.currency)),
    [holdings, convert],
  );

  function toggle(ticker: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
          <DialogDescription>Pick the holdings that belong to this theme.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quantum" autoFocus />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
            {sorted.map((h) => {
              const ticker = (h.ticker || h.name).toUpperCase();
              const on = selected.has(ticker);
              return (
                <button
                  key={h.id}
                  onClick={() => toggle(ticker)}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors",
                    on ? "bg-income/10" : "hover:bg-secondary/40",
                  )}
                >
                  <span className="min-w-0">
                    <span className="font-medium">{h.ticker || h.name}</span>
                    {h.ticker && <span className="ml-1.5 text-xs text-muted-foreground truncate">{h.name}</span>}
                  </span>
                  <span className="flex items-center gap-2 shrink-0 tabular-nums font-mono text-xs text-muted-foreground">
                    {format(h.currentValue, h.currency, true)}
                    <span className={cn(
                      "inline-flex h-4 w-4 items-center justify-center rounded-full border",
                      on ? "border-income bg-income text-black" : "border-border",
                    )}>
                      {on && "✓"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={!name.trim() || selected.size === 0}
            onClick={() => { onSave(name.trim(), [...selected].sort()); onOpenChange(false); }}
          >
            {group ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HoldingGroups({
  holdings, format, convert, delay = 0.1,
}: {
  /** Visible (filtered) holdings — the group values follow the page's scope. */
  holdings: PortfolioHolding[];
  format: (v: number, currency?: string, compact?: boolean) => string;
  convert: (v: number, from: string) => number;
  delay?: number;
}) {
  const [groups, setGroups] = useCloudStorage<PortfolioGroup[]>("portfolio_groups", []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PortfolioGroup | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const value = (h: PortfolioHolding) => convert(h.currentValue, h.currency);
  const portfolioTotal = holdings.reduce((s, h) => s + value(h), 0);

  const rows = useMemo(() => groups.map((g, i) => {
    const set = new Set(g.tickers.map((t) => t.toUpperCase()));
    const members = holdings
      .filter((h) => set.has((h.ticker || h.name).toUpperCase()))
      .sort((a, b) => value(b) - value(a));
    const total = members.reduce((s, h) => s + value(h), 0);
    const missing = g.tickers.filter((t) => !members.some((h) => (h.ticker || h.name).toUpperCase() === t.toUpperCase()));
    return { group: g, members, total, missing, color: CHART_COLORS[i % CHART_COLORS.length] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [groups, holdings, convert]);

  const groupedTickers = new Set(groups.flatMap((g) => g.tickers.map((t) => t.toUpperCase())));
  const ungrouped = holdings.filter((h) => !groupedTickers.has((h.ticker || h.name).toUpperCase()));
  const ungroupedTotal = ungrouped.reduce((s, h) => s + value(h), 0);

  function save(name: string, tickers: string[]) {
    if (editing) {
      setGroups((prev) => prev.map((g) => (g.id === editing.id ? { ...g, name, tickers } : g)));
    } else {
      setGroups((prev) => [...prev, { id: crypto.randomUUID(), name, tickers, createdAt: Date.now() }]);
    }
  }

  return (
    <BlurFade delay={delay}>
      <div className="finance-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-muted-foreground" />
            <p className="label-mono">Groups</p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> New group
          </Button>
        </div>

        {groups.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Group holdings into themes — “Quantum”, “AI” — and see what share of the portfolio each bet is.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map(({ group: g, members, total, missing, color }) => {
              const pct = portfolioTotal > 0 ? (total / portfolioTotal) * 100 : 0;
              const isOpen = expanded === g.id;
              return (
                <div key={g.id} className="group/grp">
                  <button
                    className="w-full text-left"
                    onClick={() => setExpanded(isOpen ? null : g.id)}
                  >
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="flex items-center gap-2 min-w-0">
                        <ChevronDown className={cn("h-3 w-3 text-muted-foreground/50 transition-transform", !isOpen && "-rotate-90")} />
                        <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="font-semibold truncate">{g.name}</span>
                        <span className="text-[10px] text-muted-foreground">{members.length}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="font-mono tabular-nums text-xs">
                          {format(total)} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
                        </span>
                        <span
                          className="flex items-center gap-0.5 opacity-0 group-hover/grp:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="ghost" size="icon-xs" onClick={() => { setEditing(g); setDialogOpen(true); }}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon-xs" onClick={() => setGroups((prev) => prev.filter((x) => x.id !== g.id))}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </button>
                  {isOpen && (
                    <div className="mt-2 ml-5 space-y-1">
                      {members.map((h) => {
                        const share = total > 0 ? (value(h) / total) * 100 : 0;
                        return (
                          <div key={h.id} className="flex items-center justify-between text-xs">
                            <span className="font-mono">{h.ticker || h.name}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {format(value(h))} · {share.toFixed(0)}% of group
                            </span>
                          </div>
                        );
                      })}
                      {missing.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/60">not held: {missing.join(", ")}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {ungrouped.length > 0 && (
              <div className="flex items-center justify-between border-t border-border/40 pt-2 text-xs text-muted-foreground">
                <span>Ungrouped · {ungrouped.length}</span>
                <span className="font-mono tabular-nums">
                  {format(ungroupedTotal)} ({portfolioTotal > 0 ? ((ungroupedTotal / portfolioTotal) * 100).toFixed(1) : 0}%)
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <GroupDialog
        group={editing}
        holdings={holdings}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={save}
        format={format}
        convert={convert}
      />
    </BlurFade>
  );
}
