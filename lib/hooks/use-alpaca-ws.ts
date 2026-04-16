"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Alpaca Market Data WebSocket (free IEX feed).
 * Covers pre-market (4:00am ET), regular (9:30am–4:00pm ET) and post-market
 * (4:00pm–8:00pm ET). Overnight is not available on the free tier.
 *
 * Env:
 *   NEXT_PUBLIC_ALPACA_KEY_ID      — Alpaca API key ID (use paper-trading keys)
 *   NEXT_PUBLIC_ALPACA_SECRET_KEY  — Alpaca API secret (use paper-trading keys)
 *
 * Using PAPER-TRADING keys is important: they can only access market data
 * and paper orders, so exposing them in the browser carries no financial risk.
 */

export interface AlpacaTrade {
  price: number;
  volume: number;
  updatedAt: number;
}

export type AlpacaPrices = Record<string, AlpacaTrade>;

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [3_000, 10_000, 30_000, 60_000];

export function useAlpacaWs(symbols: string[]) {
  const [livePrices, setLivePrices] = useState<AlpacaPrices>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const gaveUpRef = useRef(false);
  const symbolsKey = symbols.sort().join(",");

  const connect = useCallback(() => {
    if (symbols.length === 0) return;
    if (gaveUpRef.current) return;

    const keyId = process.env.NEXT_PUBLIC_ALPACA_KEY_ID;
    const secret = process.env.NEXT_PUBLIC_ALPACA_SECRET_KEY;
    if (!keyId || !secret) return;

    const ws = new WebSocket("wss://stream.data.alpaca.markets/v2/iex");
    wsRef.current = ws;

    ws.onopen = () => {
      // Alpaca protocol: first message must be auth
      ws.send(JSON.stringify({ action: "auth", key: keyId, secret }));
    };

    ws.onmessage = (event) => {
      try {
        const msgs = JSON.parse(event.data);
        if (!Array.isArray(msgs)) return;

        for (const msg of msgs) {
          if (msg.T === "success" && msg.msg === "authenticated") {
            ws.send(JSON.stringify({ action: "subscribe", trades: symbols }));
            setConnected(true);
            attemptsRef.current = 0;
          } else if (msg.T === "t") {
            // Trade message: { T:"t", S:"AAPL", p:178.50, s:100, t:"2024-..." }
            const sym = msg.S as string;
            const price = msg.p as number;
            const size = msg.s as number;
            const time = new Date(msg.t).getTime();
            setLivePrices((prev) => {
              const prevTrade = prev[sym];
              if (prevTrade && prevTrade.updatedAt >= time) return prev;
              return { ...prev, [sym]: { price, volume: size, updatedAt: time } };
            });
          } else if (msg.T === "error") {
            console.warn("[alpaca-ws] error", msg);
            gaveUpRef.current = true;
            try { ws.close(); } catch { /* noop */ }
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      attemptsRef.current += 1;
      if (attemptsRef.current >= MAX_ATTEMPTS || gaveUpRef.current) {
        gaveUpRef.current = true;
        console.info(
          "[alpaca-ws] giving up after repeated connection failures — REST polling will cover pricing",
        );
        return;
      }
      const delay = BACKOFF_MS[Math.min(attemptsRef.current - 1, BACKOFF_MS.length - 1)];
      reconnectTimer.current = setTimeout(() => connect(), delay);
    };

    ws.onerror = () => {
      try { ws.close(); } catch { /* noop */ }
    };
  }, [symbolsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    gaveUpRef.current = false;
    attemptsRef.current = 0;
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ action: "unsubscribe", trades: symbols }));
        } catch { /* closing */ }
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      setConnected(false);
    };
  }, [connect]);

  return { livePrices, connected };
}
