"use client";

import { useEffect, useMemo, useState } from "react";
import { shortAddr } from "@/lib/format";
import type { LeaderboardEntry, Trade } from "@/lib/useIndexer";

/** Rotates through recently-active wallets to make the lottery feel alive
 *  between draws. Deliberately doesn't claim odds or rank anyone — real per-
 *  wallet balances (and therefore real odds) only exist in the keeper's
 *  off-chain BalanceTracker, not on the frontend, so showing a fabricated
 *  ranking here would just be wrong. This is "who's around", not "who's
 *  winning". */
export function DrawEntrantsTicker({ trades, leaderboard }: { trades: Trade[]; leaderboard: LeaderboardEntry[] }) {
  const addrs = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const t of trades) {
      if (t.kind !== "buy" || seen.has(t.trader)) continue;
      seen.add(t.trader);
      list.push(t.trader);
      if (list.length >= 8) break;
    }
    if (list.length === 0) {
      for (const l of leaderboard) {
        list.push(l.trader);
        if (list.length >= 8) break;
      }
    }
    return list;
  }, [trades, leaderboard]);

  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
    if (addrs.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % addrs.length), 2400);
    return () => clearInterval(id);
  }, [addrs]);

  if (addrs.length === 0) return null;

  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cream/15 px-3 py-2 font-mono text-[11px] text-cream/50">
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-hotpot" />
      <span key={addrs[idx]} className="fade-in truncate">
        {shortAddr(addrs[idx])} traded recently — eligible for the next draw
      </span>
    </div>
  );
}
