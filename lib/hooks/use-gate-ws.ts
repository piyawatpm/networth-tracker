"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { LivePrices } from "./use-binance-ws";

interface GateTickerResult {
  currency_pair: string; // e.g. "OKB_USDT"
  last: string;
  change_percentage: string;
  base_volume: string;
  high_24h: string;
  low_24h: string;
}

/**
 * Gate.io WebSocket hook — streams real-time spot ticker data.
 * Used for coins Binance doesn't list (OKB, HYPE, GT, …).
 *
 * @param pairs Array of Gate.io currency pairs, e.g. ["OKB_USDT", "HYPE_USDT"]
 * @returns { livePrices, connected } — livePrices keyed by pair ("OKB_USDT")
 */
export function useGateWs(pairs: string[]) {
  const [livePrices, setLivePrices] = useState<LivePrices>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairsKey = [...pairs].sort().join(",");

  const connect = useCallback(() => {
    if (pairs.length === 0) return;

    const ws = new WebSocket("wss://api.gateio.ws/ws/v4/");
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          channel: "spot.tickers",
          event: "subscribe",
          payload: pairs,
        }),
      );
      // Gate.io closes idle connections — app-level ping keeps it alive
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              time: Math.floor(Date.now() / 1000),
              channel: "spot.ping",
            }),
          );
        }
      }, 20_000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.channel !== "spot.tickers" || msg.event !== "update") return;
        const d = msg.result as GateTickerResult | undefined;
        if (!d?.currency_pair) return;

        const price = parseFloat(d.last);
        const change = parseFloat(d.change_percentage);
        if (isNaN(price)) return;
        // Gate has no open_24h field — derive it from the 24h change
        const open = change > -100 ? price / (1 + change / 100) : 0;

        setLivePrices((prev) => ({
          ...prev,
          [d.currency_pair]: {
            price,
            open24h: open,
            high24h: parseFloat(d.high_24h),
            low24h: parseFloat(d.low_24h),
            change24h: isNaN(change) ? 0 : change,
            volume24h: parseFloat(d.base_volume),
            updatedAt: Date.now(),
          },
        }));
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingTimer.current) clearInterval(pingTimer.current);
      // Auto-reconnect after 3s
      reconnectTimer.current = setTimeout(() => connect(), 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [pairsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
      setConnected(false);
    };
  }, [connect]);

  return { livePrices, connected };
}
