"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface LivePrice {
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  change24h: number; // percent
  volume24h: number;
  updatedAt: number;
}

export type LivePrices = Record<string, LivePrice>;

/**
 * Binance WebSocket hook — streams real-time mini ticker data.
 *
 * @param symbols Array of Binance symbols, e.g. ["BTCUSDT", "ETHUSDT"]
 * @returns { livePrices, connected }
 */
export function useBinanceWs(symbols: string[]) {
  const [livePrices, setLivePrices] = useState<LivePrices>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolsKey = symbols.sort().join(",");

  const connect = useCallback(() => {
    if (symbols.length === 0) return;

    // Build combined stream URL
    const streams = symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const d = msg.data;
        if (!d || !d.s) return;

        const symbol = d.s as string; // e.g. "BTCUSDT"
        const price = parseFloat(d.c);
        const open = parseFloat(d.o);
        const high = parseFloat(d.h);
        const low = parseFloat(d.l);
        const volume = parseFloat(d.v);
        const change = open > 0 ? ((price - open) / open) * 100 : 0;

        setLivePrices((prev) => ({
          ...prev,
          [symbol]: {
            price,
            open24h: open,
            high24h: high,
            low24h: low,
            change24h: change,
            volume24h: volume,
            updatedAt: Date.now(),
          },
        }));
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
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
      setConnected(false);
    };
  }, [connect]);

  return { livePrices, connected };
}
