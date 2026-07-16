"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtEth, shortAddr } from "@/lib/format";
import { ShareCard } from "./ShareCard";
import type { ActivityEvent } from "@/lib/useActivityEvents";

const AUTO_DISMISS_MS = 9000;

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.4,
        duration: 1.6 + Math.random() * 1.2,
        color: ["var(--hotpot)", "var(--berry)", "var(--tangerine)"][i % 3],
        rotate: Math.random() * 360,
      })),
    [],
  );
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            background: p.color,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/** Full-screen celebratory overlay that appears when a new hotpot or lottery
 *  payout lands — the payout-history rows already record it permanently,
 *  this is just the "something big just happened" moment. */
export function WinnerSpotlight({ events }: { events: ActivityEvent[] }) {
  const [active, setActive] = useState<ActivityEvent | null>(null);
  const shown = useRef<Set<string>>(new Set());

  useEffect(() => {
    const win = events.find((e) => (e.kind === "payout" || e.kind === "lotteryPayout") && !shown.current.has(e.id));
    if (!win) return;
    shown.current.add(win.id);
    setActive(win);
    const t = setTimeout(() => setActive((cur) => (cur?.id === win.id ? null : cur)), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  if (!active) return null;

  const isLottery = active.kind === "lotteryPayout";
  const winner = isLottery ? active.lotteryPayout!.winner : active.payout!.winner;
  const amount = isLottery ? active.lotteryPayout!.amount : active.payout!.amount;
  const roundId = isLottery ? active.lotteryPayout!.lottery_round_id : active.payout!.round_id;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/70 px-4 backdrop-blur-sm"
      onClick={() => setActive(null)}
    >
      <Confetti />
      <div
        onClick={(e) => e.stopPropagation()}
        className="fade-in relative w-full max-w-sm rounded-3xl border-[3px] border-hotpot bg-ink p-6 text-center shadow-[0_0_80px_-10px_rgba(207,242,63,0.6)]"
      >
        <button
          type="button"
          onClick={() => setActive(null)}
          aria-label="close"
          className="absolute right-3 top-3 text-cream/40 hover:text-cream"
        >
          ✕
        </button>
        <div className="text-4xl">{isLottery ? "🎟️" : "🍜"}</div>
        <div className="mt-2 font-display text-xl font-extrabold uppercase text-hotpot">
          {isLottery ? "lottery winner!" : "pot won!"}
        </div>
        <div className="mt-3 font-mono text-sm text-cream/70">{shortAddr(winner)}</div>
        <div className="neon-text mt-1 font-display text-4xl font-extrabold text-berry">
          +{fmtEth(amount)} ETH
        </div>
        <div className="mt-1 font-mono text-[11px] text-cream/40">
          {isLottery ? "draw" : "round"} #{roundId}
        </div>
        <ShareCard kind={active.kind as "payout" | "lotteryPayout"} winner={winner} amount={amount} roundId={roundId} />
      </div>
    </div>
  );
}
