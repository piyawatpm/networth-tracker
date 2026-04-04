"use client";

import { useState, useEffect } from "react";
import { useCloudStorage } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FundHoldingEntry {
  symbol: string;
  name: string;
  weight: number; // 0-100
}

export interface FundAllocationData {
  holdings: FundHoldingEntry[];
  sectorWeightings: { sector: string; weight: number }[];
  fetchedAt: number;
  source: "auto" | "manual";
}

export type FundAllocations = Record<string, FundAllocationData>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FundBreakdownProps {
  holdingId: string;
  holdingName: string;
  ticker: string;
  country: string;
  holdingType: string;
  /** Weight of this holding in the total portfolio (0-100) */
  portfolioWeight: number;
}

export function FundBreakdown({
  holdingId,
  holdingName,
  ticker,
  country,
  holdingType,
  portfolioWeight,
}: FundBreakdownProps) {
  const [allocations, setAllocations] = useCloudStorage<FundAllocations>(
    "fund_allocations",
    {},
  );
  const [expanded, setExpanded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("");

  const data = allocations[holdingId];
  const holdings = data?.holdings ?? [];
  const sectors = data?.sectorWeightings ?? [];
  const canFetch = ticker.length > 0 && (holdingType === "etf" || holdingType === "fund");

  async function handleFetch() {
    if (!ticker) return;
    setFetching(true);
    try {
      const res = await fetch("/api/fund-holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, country }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();

      if (result.holdings?.length > 0 || result.sectorWeightings?.length > 0) {
        setAllocations((prev) => ({
          ...prev,
          [holdingId]: {
            holdings: result.holdings ?? [],
            sectorWeightings: result.sectorWeightings ?? [],
            fetchedAt: Date.now(),
            source: "auto",
          },
        }));
      }
    } catch {
      // silent fail — user can try again or add manually
    } finally {
      setFetching(false);
    }
  }

  function handleAddManual() {
    const weight = parseFloat(newWeight);
    if (!newName.trim() || isNaN(weight) || weight <= 0) return;

    const entry: FundHoldingEntry = {
      symbol: newSymbol.trim().toUpperCase(),
      name: newName.trim(),
      weight,
    };

    setAllocations((prev) => {
      const existing = prev[holdingId] ?? {
        holdings: [],
        sectorWeightings: [],
        fetchedAt: Date.now(),
        source: "manual",
      };
      return {
        ...prev,
        [holdingId]: {
          ...existing,
          holdings: [...existing.holdings, entry],
          source: "manual",
          fetchedAt: Date.now(),
        },
      };
    });

    setNewSymbol("");
    setNewName("");
    setNewWeight("");
    setShowAddForm(false);
  }

  function handleRemoveHolding(index: number) {
    setAllocations((prev) => {
      const existing = prev[holdingId];
      if (!existing) return prev;
      return {
        ...prev,
        [holdingId]: {
          ...existing,
          holdings: existing.holdings.filter((_, i) => i !== index),
        },
      };
    });
  }

  function handleClearAll() {
    setAllocations((prev) => {
      const next = { ...prev };
      delete next[holdingId];
      return next;
    });
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className="h-3 w-3" />
        {holdings.length > 0
          ? `${holdings.length} underlying holdings`
          : "View fund breakdown"}
      </button>
    );
  }

  return (
    <div className="border-t border-border/50 pt-3 mt-3 space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronUp className="h-3 w-3" />
          Fund Breakdown
        </button>
        <div className="flex items-center gap-1.5">
          {canFetch && (
            <Button
              variant="ghost"
              size="xs"
              onClick={handleFetch}
              disabled={fetching}
              className="text-[10px] gap-1"
            >
              {fetching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {holdings.length > 0 ? "Refresh" : "Fetch"}
            </Button>
          )}
          {holdings.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={handleClearAll}
              className="text-[10px] text-muted-foreground"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Holdings list */}
      {holdings.length > 0 ? (
        <div className="space-y-1">
          {holdings
            .sort((a, b) => b.weight - a.weight)
            .map((h, i) => (
              <div
                key={`${h.symbol}-${i}`}
                className="flex items-center justify-between text-[11px] group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-muted-foreground w-10 shrink-0 tabular-nums text-right">
                    {h.weight.toFixed(1)}%
                  </span>
                  <div className="h-1 rounded-full bg-muted w-12 shrink-0">
                    <div
                      className="h-full rounded-full bg-accent/60"
                      style={{ width: `${Math.min(100, h.weight * 2)}%` }}
                    />
                  </div>
                  {h.symbol && (
                    <span className="font-mono text-muted-foreground shrink-0">
                      {h.symbol}
                    </span>
                  )}
                  <span className="truncate">{h.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {(h.weight * portfolioWeight / 100).toFixed(2)}% of portfolio
                  </span>
                  <button
                    onClick={() => handleRemoveHolding(i)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground/60 text-center py-2">
          {canFetch
            ? 'Click "Fetch" to load holdings from Yahoo Finance, or add manually.'
            : "Add underlying holdings manually."}
        </p>
      )}

      {/* Sector weightings */}
      {sectors.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Sectors
          </p>
          <div className="flex flex-wrap gap-1">
            {sectors
              .sort((a, b) => b.weight - a.weight)
              .map((s) => (
                <span
                  key={s.sector}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]"
                >
                  {s.sector}
                  <span className="text-muted-foreground tabular-nums">
                    {s.weight.toFixed(1)}%
                  </span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Manual add form */}
      {showAddForm ? (
        <div className="rounded-lg border border-border/50 p-2.5 space-y-2">
          <div className="grid grid-cols-[1fr_2fr_auto] gap-2">
            <Input
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="Symbol"
              className="text-xs h-7"
            />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (e.g. BHP Group)"
              className="text-xs h-7"
            />
            <Input
              type="number"
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
              placeholder="Weight %"
              className="text-xs h-7 w-20 tabular-nums"
              min="0"
              max="100"
              step="0.1"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="xs" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              onClick={handleAddManual}
              disabled={!newName.trim() || !newWeight}
            >
              Add
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setShowAddForm(true)}
          className="text-[10px] w-full"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add Holding Manually
        </Button>
      )}

      {/* Source info */}
      {data && (
        <p className="text-[9px] text-muted-foreground/40">
          {data.source === "auto" ? "Fetched from Yahoo Finance" : "Manual entry"} ·{" "}
          {new Date(data.fetchedAt).toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short",
          })}
        </p>
      )}
    </div>
  );
}
