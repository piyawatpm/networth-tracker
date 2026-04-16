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
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [3_000, 10_000, 30_000, 60_000];

export function useFinnhubWs(symbols: string[]) {
  const [livePrices, setLivePrices] = useState<FinnhubPrices>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const gaveUpRef = useRef(false);
  const symbolsKey = symbols.sort().join(",");

  const connect = useCallback(() => {
    if (symbols.length === 0) return;
    if (gaveUpRef.current) return;

    const apiKey = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!apiKey) return;

    const url = `wss://ws.finnhub.io?token=${apiKey}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      attemptsRef.current = 0;
      for (const sym of symbols) {
        ws.send(JSON.stringify({ type: "subscribe", symbol: sym }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "trade" || !msg.data) return;

        const updates: FinnhubPrices = {};
        for (const trade of msg.data) {
          const sym = trade.s as string;
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
      attemptsRef.current += 1;
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        gaveUpRef.current = true;
        console.info(
          "[finnhub-ws] giving up after repeated connection failures — REST polling will cover pricing (likely WS not enabled on this Finnhub tier)",
        );
        return;
      }
      const delay = BACKOFF_MS[Math.min(attemptsRef.current - 1, BACKOFF_MS.length - 1)];
      reconnectTimer.current = setTimeout(() => connect(), delay);
    };

    ws.onerror = () => {
      // Close triggers onclose which handles backoff; avoid double-logging.
      try { ws.close(); } catch { /* noop */ }
    };
  }, [symbolsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Reset the "gave up" flag when the symbol set changes so the user gets
    // a fresh chance after editing holdings.
    gaveUpRef.current = false;
    attemptsRef.current = 0;
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
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
