"use client";

import { fmtCountdown, fmtEth, fmtUsdCompact } from "@/lib/format";
import type { ChainState } from "@/lib/useIndexer";

const ZERO = "0x0000000000000000000000000000000000000000";
const ROUND_SECONDS = 60;

/// Plain text pot readout — no card, no glow. The USD value is the headline
/// number (biggest text on the page after the timer); ETH is the footnote.
export function PotAmount({ state }: { state: ChainState | null }) {
  const usd = state?.ethUsd != null ? fmtUsdCompact(state.prizePool, state.ethUsd) : null;

  return (
    <div>
      <div className="font-display text-4xl font-extrabold uppercase leading-none text-ink">Pot</div>
      <div className="mt-3 font-display text-6xl font-extrabold leading-none tracking-tight text-ink">
        {usd ?? (state ? `${fmtEth(state.prizePool)} eth` : "—")}
      </div>
      {usd && (
        <div className="mt-2 font-display text-lg font-bold text-ink/60">{fmtEth(state!.prizePool)} eth</div>
      )}
    </div>
  );
}

/// Flat countdown box — no ring, no glow.
export function PotTimer({ state, now }: { state: ChainState | null; now: number }) {
  const remaining = state ? state.deadline - now : 0;
  const roundLive = !!state && state.lastBuyer !== ZERO;
  const expired = roundLive && remaining <= 0;

  return (
    <div>
      <div className="font-display text-4xl font-extrabold uppercase leading-none text-ink">Timer:</div>
      <div className="mt-2 grid aspect-square w-full max-w-[440px] place-items-center bg-ink font-display text-7xl font-extrabold tabular-nums text-cream">
        {roundLive ? (expired ? fmtCountdown(0) : fmtCountdown(remaining)) : fmtCountdown(ROUND_SECONDS)}
      </div>
    </div>
  );
}
