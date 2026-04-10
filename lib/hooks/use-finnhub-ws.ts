"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface FinnhubTrade {
  price: number;
  volume: number;
  updatedAt: number;
}

export type FinnhubPrices = Record<string, FinnhubTrade>;

/**
 * Finnhub WebSocket hook — streams real-time US stock trade data.
 *
 * @param symbols Array of stock tickers, e.g. ["AAPL", "MSFT"]
 * @returns { livePrices, connected }
 */
export function useFinnhubWs(symbols: string[]) {
  const [livePrices, setLivePrices] = useState<FinnhubPrices>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolsKey = symbols.sort().join(",");

  const connect = useCallback(() => {
    if (symbols.length === 0) return;

    const apiKey = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!apiKey) return;

    const url = `wss://ws.finnhub.io?token=${apiKey}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Subscribe to each symbol
      for (const sym of symbols) {
        ws.send(JSON.stringify({ type: "subscribe", symbol: sym }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "trade" || !msg.data) return;

        // Batch updates — msg.data is an array of trades
        const updates: FinnhubPrices = {};
        for (const trade of msg.data) {
          const sym = trade.s as string;
          // Keep the latest trade per symbol in this batch
          if (!updates[sym] || trade.t > updates[sym].updatedAt) {
            updates[sym] = {
              price: trade.p,
              volume: trade.v,
              updatedAt: trade.t,
            };
          }
        }

        if (Object.keys(updates).length > 0) {
          setLivePrices((prev) => ({ ...prev, ...updates }));
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3s
      reconnectTimer.current = setTimeout(() => connect(), 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [symbolsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        // Unsubscribe before closing
        for (const sym of symbols) {
          try {
            wsRef.current.send(JSON.stringify({ type: "unsubscribe", symbol: sym }));
          } catch { /* closing */ }
        }
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      setConnected(false);
    };
  }, [connect]);

  return { livePrices, connected };
}
