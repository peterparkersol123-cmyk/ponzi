"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { RollingAmount } from "./RollingAmount";
import { WinnersDropdown } from "./WinnersDropdown";
import { fmtCountdown, fmtEth } from "@/lib/format";
import type { ChainState, LotteryPayout } from "@/lib/useIndexer";

/// Three-node progress tracker for the commit -> reveal -> declare cycle.
/// Mirrors the "reactor core" feel of the last-buyer timer ring, but as a
/// linear pipeline since the lottery isn't a countdown to a single moment —
/// it's a sequence of on-chain steps the keeper works through automatically.
function Stage({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`h-4 w-4 rounded-full border-2 transition-colors duration-500 ${
          done
            ? "border-hotpot bg-hotpot shadow-[0_0_10px_-1px_rgba(207,242,63,0.8)]"
            : active
              ? "animate-pulse border-tangerine bg-tangerine shadow-[0_0_10px_-1px_rgba(255,157,61,0.8)]"
              : "border-cream/25 bg-transparent"
        }`}
      />
      <span
        className={`font-mono text-[10px] font-bold uppercase tracking-wide ${
          done || active ? "text-cream" : "text-cream/35"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function Connector({ filled }: { filled: boolean }) {
  return <div className={`mb-4 h-0.5 flex-1 transition-colors duration-500 ${filled ? "bg-hotpot" : "bg-cream/15"}`} />;
}

function DrawStatus({ state, now, latestWinner }: { state: ChainState | null; now: number; latestWinner: LotteryPayout | null }) {
  const phase = state?.lotteryPhase ?? "idle";
  // Reveal->declare happens automatically and fast, so there's no distinct
  // on-chain "declared" phase to poll for — flash this stage instead when a
  // fresh win lands, so the full cycle is still visible before it resets.
  const justDeclared = phase === "idle" && latestWinner != null && now - latestWinner.timestamp < 12;

  const committedDone = phase === "committed" || phase === "revealed" || justDeclared;
  const revealedDone = phase === "revealed" || justDeclared;
  const declaredDone = justDeclared;

  const revealDue = state ? state.lotteryCommitTime + state.lotteryIntervalSeconds : 0;
  const secondsToReveal = phase === "committed" ? Math.max(0, revealDue - now) : 0;

  let caption = "preparing next draw…";
  if (phase === "committed") caption = `revealing in ${fmtCountdown(secondsToReveal)}`;
  else if (phase === "revealed") caption = "finalizing winner…";
  else if (justDeclared) caption = "winner declared! 🎉";

  return (
    <div className="space-y-2">
      <div className="flex items-start">
        <Stage label="committed" active={phase === "committed"} done={committedDone} />
        <Connector filled={revealedDone} />
        <Stage label="revealed" active={phase === "revealed"} done={revealedDone} />
        <Connector filled={declaredDone} />
        <Stage label="declared" active={justDeclared} done={declaredDone} />
      </div>
      <div className="text-center font-mono text-[11px] font-semibold text-cream/60">{caption}</div>
    </div>
  );
}

/// Interactive: type a token amount, see an estimated win chance for the next
/// draw update live. Approximate — the true denominator excludes the DEX
/// pool/Portal/dead addresses (see keeper.ts), but circulating supply is the
/// only figure the frontend has, so real odds are usually a little better
/// than this shows.
function OddsCalculator({ state }: { state: ChainState | null }) {
  const [amount, setAmount] = useState("10000");

  const supply = state ? Number(formatEther(BigInt(state.circulatingSupply))) : 0;
  const held = Math.max(0, Number(amount) || 0);
  const chance = supply > 0 ? Math.min(100, (held / supply) * 100) : 0;

  return (
    <div className="space-y-2 rounded-xl border-2 border-dashed border-cream/15 p-3">
      <label className="block font-mono text-[10px] font-bold uppercase tracking-wide text-cream/45">
        if you hold this many tokens
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg border-2 border-cream/20 bg-ink px-2.5 py-1.5 font-mono text-sm font-bold text-cream outline-none focus:border-hotpot"
          placeholder="token amount"
        />
      </div>
      <div className="pt-1 text-center">
        <div className="neon-text font-display text-3xl font-extrabold text-hotpot">
          {chance === 0 ? "0" : chance < 0.01 ? "<0.01" : chance.toFixed(2)}%
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-cream/40">≈ chance to win the next draw</div>
      </div>
    </div>
  );
}

export function LotteryPanel({
  state,
  now,
  latestWinner,
  payouts,
}: {
  state: ChainState | null;
  now: number;
  latestWinner: LotteryPayout | null;
  payouts: LotteryPayout[];
}) {
  const urgent = state?.lotteryPhase === "revealed";
  const sectionClass = urgent
    ? "border-tangerine shadow-[0_0_60px_-16px_rgba(255,157,61,0.7)]"
    : "border-hotpot shadow-[0_0_60px_-16px_rgba(207,242,63,0.55)]";
  const headerClass = urgent ? "bg-tangerine" : "bg-hotpot";

  return (
    <section
      className={`overflow-hidden rounded-2xl border-[2.5px] bg-ink/65 text-cream backdrop-blur-sm transition-colors duration-500 ${sectionClass} ${urgent ? "animate-pulse" : ""}`}
    >
      <div className={`flex items-center gap-1.5 border-b-[2.5px] border-ink px-3 py-2 transition-colors duration-500 ${headerClass}`}>
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="ml-1.5 truncate font-mono text-[11px] font-semibold tracking-tight text-ink/65">
          hotpot / lottery / draw {state?.lotteryRoundId ?? "—"}
        </span>
      </div>

      <div className="space-y-5 px-5 pb-7 pt-6 text-center">
        <div className="pot-bob mx-auto grid h-16 w-16 place-items-center rounded-full border-[3px] border-hotpot bg-ink text-3xl shadow-[0_0_24px_-4px_rgba(207,242,63,0.7)]">
          🎟️
        </div>

        <div>
          <div className="font-display text-xs font-bold uppercase tracking-[0.25em] text-cream/45">
            The lottery pool
          </div>
          <div
            className={`neon-text mt-1 font-display text-5xl font-extrabold leading-none tracking-tight ${
              state ? "text-berry" : "text-cream/25"
            }`}
          >
            {state ? <RollingAmount wei={state.lotteryPool} ethUsd={state.ethUsd} /> : "—"}
          </div>
          {state && (
            <div className="mt-0.5 font-mono text-xs font-semibold text-cream/40">
              {fmtEth(state.lotteryPool)} ETH
            </div>
          )}
          <div className="mt-2 inline-flex flex-col items-center gap-0.5">
            <span className="rounded-full border-2 border-tangerine bg-tangerine/10 px-3 py-1 font-display text-xs font-extrabold tabular-nums text-tangerine">
              🎲 odds scale with how much you hold
            </span>
            <span className="text-[10px] font-semibold text-cream/40">
              a draw runs every {state ? fmtCountdown(state.lotteryIntervalSeconds) : "—"}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-cream/10 bg-cream/[0.03] px-4 py-4">
          <DrawStatus state={state} now={now} latestWinner={latestWinner} />
        </div>

        <OddsCalculator state={state} />

        <WinnersDropdown
          rows={payouts.map((p) => ({
            id: p.lottery_round_id,
            winner: p.winner,
            amount: p.amount,
            timestamp: p.timestamp,
            txHash: p.tx_hash,
          }))}
          now={now}
          roundLabel="draw"
          emptyText="no draws yet"
        />
      </div>
    </section>
  );
}
