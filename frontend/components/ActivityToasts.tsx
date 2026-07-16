"use client";

import { useEffect, useRef, useState } from "react";
import { fmtEth, fmtUsdCompact, shortAddr } from "@/lib/format";
import type { ActivityEvent } from "@/lib/useActivityEvents";
import type { ChainState } from "@/lib/useIndexer";

const VISIBLE_MS = 6000;

function toastText(e: ActivityEvent, state: ChainState | null): string | null {
  if (e.kind === "buy" && e.trade) {
    if (e.trade.qualified !== true) return null; // only surface qualifying buys — sells/small buys are noise
    const potNow = state ? (state.ethUsd != null ? fmtUsdCompact(state.prizePool, state.ethUsd) : `${fmtEth(state.prizePool)} ETH`) : null;
    return `🔥 ${shortAddr(e.trade.trader)} bought ${fmtEth(e.trade.eth_amount)} ETH — now last to stoke${potNow ? `, pot's ${potNow}` : ""}`;
  }
  if (e.kind === "payout" && e.payout) {
    return `🍜 ${shortAddr(e.payout.winner)} won +${fmtEth(e.payout.amount)} ETH from the pot!`;
  }
  if (e.kind === "lotteryPayout" && e.lotteryPayout) {
    return `🎟️ ${shortAddr(e.lotteryPayout.winner)} won +${fmtEth(e.lotteryPayout.amount)} ETH in the lottery!`;
  }
  return null;
}

/** Fixed top-of-screen toast stack — turns the push feed into something that
 *  visibly *happens* instead of just re-rendering numbers in place. */
export function ActivityToasts({ events, state }: { events: ActivityEvent[]; state: ChainState | null }) {
  const [visible, setVisible] = useState<ActivityEvent[]>([]);
  const shown = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fresh = events.filter((e) => !shown.current.has(e.id) && toastText(e, state) != null).slice(0, 4);
    if (fresh.length === 0) return;
    fresh.forEach((e) => shown.current.add(e.id));
    setVisible((v) => [...fresh, ...v].slice(0, 4));
    fresh.forEach((e) => {
      setTimeout(() => setVisible((v) => v.filter((x) => x.id !== e.id)), VISIBLE_MS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-40 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      {visible.map((e) => {
        const text = toastText(e, state);
        if (!text) return null;
        const isWin = e.kind === "payout" || e.kind === "lotteryPayout";
        return (
          <div
            key={e.id}
            className={`toast-enter pointer-events-auto rounded-xl border-2 px-4 py-2.5 text-center font-mono text-[12px] font-semibold shadow-[4px_4px_0_0_var(--ink)] backdrop-blur-sm ${
              isWin ? "border-hotpot bg-hotpot/95 text-ink" : "border-cream/20 bg-ink/90 text-cream"
            }`}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}
