"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Settings2, Check, X, Search } from "lucide-react";

// Common name → ticker mappings for auto-suggest
const KNOWN_MAPPINGS: Record<string, string> = {
  "Bitcoin": "BTC",
  "Ethereum": "ETH",
  "Solana": "SOL",
  "BNB": "BNB",
  "XRP": "XRP",
  "Cardano": "ADA",
  "Dogecoin": "DOGE",
  "Polkadot": "DOT",
  "Avalanche": "AVAX",
  "Chainlink": "LINK",
  "Uniswap": "UNI",
  "Cosmos": "ATOM",
  "Arbitrum": "ARB",
  "Optimism": "OP",
  "Aptos": "APT",
  "Sui": "SUI",
  "Sei": "SEI",
  "Polygon": "MATIC",
  "Litecoin": "LTC",
  "Tron": "TRX",
  "Shiba Inu": "SHIB",
  "Pepe": "PEPE",
  "Render": "RNDR",
  "Injective": "INJ",
  "Celestia": "TIA",
  "Ondo": "ONDO",
  "OKB": "OKB",
  "World Liberty Financial USD": "WLFI",
  "syrupUSDC": "syrupUSDC",
};

interface TickerMappingDialogProps {
  /** Current token names from CSV */
  tokens: string[];
  /** Saved mappings: csvName → binanceTicker */
  mappings: Record<string, string>;
  onSave: (mappings: Record<string, string>) => void;
  trigger: React.ReactNode;
}

export function TickerMappingDialog({
  tokens,
  mappings,
  onSave,
  trigger,
}: TickerMappingDialogProps) {
  const [open, setOpen] = useState(false);
  const [localMappings, setLocalMappings] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  // Only re-initialize when dialog opens, not on every tokens/mappings reference change
  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = { ...mappings };
    for (const token of tokens) {
      if (!init[token]) {
        init[token] = KNOWN_MAPPINGS[token] ?? token;
      }
    }
    setLocalMappings(init);
    setSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSave() {
    onSave(localMappings);
    setOpen(false);
  }

  function autoFillAll() {
    const updated = { ...localMappings };
    for (const token of tokens) {
      if (KNOWN_MAPPINGS[token]) {
        updated[token] = KNOWN_MAPPINGS[token];
      }
    }
    setLocalMappings(updated);
  }

  const filteredTokens = useMemo(() => {
    if (!search.trim()) return tokens;
    const q = search.toLowerCase();
    return tokens.filter(
      (t) =>
        t.toLowerCase().includes(q) ||
        (localMappings[t] ?? "").toLowerCase().includes(q),
    );
  }, [tokens, search, localMappings]);

  const mappedCount = tokens.filter((t) => localMappings[t] && localMappings[t] !== t).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.JSX.Element} />
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ticker Mapping</DialogTitle>
          <DialogDescription>
            Map CSV token names to Binance ticker symbols for live price fetching.
            {mappedCount > 0 && ` (${mappedCount}/${tokens.length} mapped)`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search + Auto-fill */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tokens..."
                className="pl-8 h-8 text-xs"
              />
            </div>
            <Button variant="outline" size="sm" onClick={autoFillAll} className="text-xs shrink-0">
              Auto-fill known
            </Button>
          </div>

          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-1 text-[10px] text-muted-foreground uppercase tracking-wider">
            <span>CSV Name</span>
            <span></span>
            <span>Binance Ticker</span>
          </div>

          {/* Mapping rows */}
          <div className="space-y-1.5">
            {filteredTokens.map((token) => {
              const currentTicker = localMappings[token] ?? "";
              const isModified = currentTicker !== token && currentTicker !== "";
              return (
                <div
                  key={token}
                  className={cn(
                    "grid grid-cols-[1fr_auto_1fr] gap-2 items-center rounded-lg px-2 py-1.5 transition-colors",
                    isModified ? "bg-income/5" : "bg-secondary/30",
                  )}
                >
                  <span className="text-xs font-medium truncate" title={token}>
                    {token}
                  </span>
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <Input
                    value={currentTicker}
                    onChange={(e) =>
                      setLocalMappings((prev) => ({
                        ...prev,
                        [token]: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. BTC"
                    className="h-7 text-xs font-mono uppercase"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save Mappings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
