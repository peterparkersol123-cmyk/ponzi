"use client";

import { useEffect, useRef, useState } from "react";
import { INDEXER_WS } from "./config";

export interface ChainState {
  prizePool: string;
  opsAccrued: string;
  deadline: number;
  lastBuyer: string;
  roundId: number;
  holders: number;
  circulatingSupply: string;
  price: string;
  marketCap: string;
  reserve: string;
  /** 0..1e18 progress toward DEX migration on Flap */
  progress: string;
  dexed: boolean;
  /** null until the indexer's first successful price-feed fetch */
  ethUsd: number | null;
}

export interface Trade {
  block_number: number;
  log_index: number;
  tx_hash: string;
  timestamp: number;
  round_id: number;
  trader: string;
  kind: "buy" | "sell";
  eth_amount: string;
  token_amount: string;
  price: string;
  market_cap: string;
}

export interface Payout {
  round_id: number;
  winner: string;
  amount: string;
  block_number: number;
  tx_hash: string;
  timestamp: number;
}

export interface LeaderboardEntry {
  trader: string;
  buys: number;
  ethIn: string;
}

export interface IndexerData {
  connected: boolean;
  state: ChainState | null;
  trades: Trade[];
  payouts: Payout[];
  leaderboard: LeaderboardEntry[];
  hourlyVolume: string;
  /** serverTime - clientTime, seconds; add to Date.now()/1000 for chain-ish time */
  clockOffset: number;
}

const initial: IndexerData = {
  connected: false,
  state: null,
  trades: [],
  payouts: [],
  leaderboard: [],
  hourlyVolume: "0",
  clockOffset: 0,
};

/** Live connection to the indexer's push websocket, with auto-reconnect. */
export function useIndexer(): IndexerData {
  const [data, setData] = useState<IndexerData>(initial);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;

    function connect() {
      ws = new WebSocket(INDEXER_WS);

      ws.onopen = () => setData((d) => ({ ...d, connected: true }));

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        setData((d) => {
          switch (msg.type) {
            case "snapshot":
              return {
                connected: true,
                state: msg.state,
                trades: msg.trades,
                payouts: msg.payouts,
                leaderboard: msg.leaderboard,
                hourlyVolume: msg.hourlyVolume,
                clockOffset: msg.serverTime - Date.now() / 1000,
              };
            case "trade":
              return { ...d, trades: [msg.trade, ...d.trades].slice(0, 50) };
            case "payout":
              return { ...d, payouts: [msg.payout, ...d.payouts].slice(0, 20) };
            case "state":
              return {
                ...d,
                state: msg.state,
                leaderboard: msg.leaderboard ?? d.leaderboard,
                hourlyVolume: msg.hourlyVolume ?? d.hourlyVolume,
              };
            default:
              return d;
          }
        });
      };

      ws.onclose = () => {
        setData((d) => ({ ...d, connected: false }));
        if (!closed) retryRef.current = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      closed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      ws?.close();
    };
  }, []);

  return data;
}

/** Ticks every 250ms; returns unix seconds adjusted by the indexer clock offset. */
export function useNow(clockOffset: number): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000 + clockOffset)), 250);
    return () => clearInterval(id);
  }, [clockOffset]);
  return now;
}
