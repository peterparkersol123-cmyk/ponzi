"use client";

import { Logo } from "./Logo";
import { RollingAmount } from "./RollingAmount";
import { WinnersDropdown } from "./WinnersDropdown";
import { fmtCountdown, fmtEth, shortAddr } from "@/lib/format";
import type { ChainState, Payout } from "@/lib/useIndexer";

const ZERO = "0x0000000000000000000000000000000000000000";
const ROUND_SECONDS = 180; // matches FlapJackpot.ROUND_EXTENSION (3 min)

/// Circular burn-down ring: full circle right after a buy, drains to empty
/// at the deadline. Radius/stroke tuned to frame the big mm:ss digits.
function TimerRing({
  fraction,
  tone,
}: {
  fraction: number;
  tone: "hotpot" | "tangerine" | "berry";
}) {
  const r = 84;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, fraction)));
  const color =
    tone === "berry" ? "var(--berry)" : tone === "tangerine" ? "var(--tangerine)" : "var(--hotpot)";

  return (
    <svg viewBox="0 0 192 192" className="pointer-events-none absolute inset-0 h-full w-full -rotate-90">
      <circle cx="96" cy="96" r={r} fill="none" stroke="var(--cream)" strokeOpacity="0.12" strokeWidth="10" />
      <circle
        cx="96"
        cy="96"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        className={tone === "tangerine" ? "animate-pulse" : ""}
        style={{
          transition: "stroke-dashoffset 1s linear, stroke 0.3s",
          filter: `drop-shadow(0 0 8px ${color})`,
        }}
      />
    </svg>
  );
}

/// The hero of the page — a glowing terminal HUD, not a collapsible Panel.
/// Same window chrome as the data readouts, but scaled up and lit up: this
/// is the one place the page should feel like a reactor core.
export function PotPanel({ state, now, payouts }: { state: ChainState | null; now: number; payouts: Payout[] }) {
  const remaining = state ? state.deadline - now : 0;
  const roundLive = !!state && state.lastBuyer !== ZERO;
  const expired = roundLive && remaining <= 0;
  const hot = roundLive && !expired && remaining <= 10;
  const tone = expired ? "berry" : hot ? "tangerine" : "hotpot";
  const fraction = roundLive ? remaining / ROUND_SECONDS : 1;
  const urgent = hot || expired;

  const halfWei = state ? (BigInt(state.prizePool) / 2n).toString() : "0";

  const sectionClass =
    tone === "berry"
      ? "border-berry shadow-[0_0_60px_-16px_rgba(255,92,138,0.65)]"
      : tone === "tangerine"
        ? "border-tangerine shadow-[0_0_60px_-16px_rgba(255,157,61,0.7)]"
        : "border-hotpot shadow-[0_0_60px_-16px_rgba(207,242,63,0.55)]";
  const headerClass = tone === "berry" ? "bg-berry" : tone === "tangerine" ? "bg-tangerine" : "bg-hotpot";

  return (
    <section
      className={`overflow-hidden rounded-2xl border-[2.5px] bg-ink/65 text-cream backdrop-blur-sm transition-colors duration-500 ${sectionClass} ${urgent ? "animate-pulse" : ""}`}
    >
      <div className={`flex items-center gap-1.5 border-b-[2.5px] border-ink px-3 py-2 transition-colors duration-500 ${headerClass}`}>
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="ml-1.5 truncate font-mono text-[11px] font-semibold tracking-tight text-ink/65">
          icp / last-buyer / round {state?.roundId ?? "—"}
        </span>
      </div>

      <div className="space-y-5 px-5 pb-7 pt-6 text-center">
        <div className="pot-bob mx-auto h-16 w-16 overflow-hidden rounded-full border-[3px] border-hotpot shadow-[0_0_24px_-4px_rgba(207,242,63,0.7)]">
          <Logo className="h-full w-full" />
        </div>

        <div>
          <div className="font-display text-xs font-bold uppercase tracking-[0.25em] text-cream/45">
            Up for grabs right now
          </div>
          <div
            className={`neon-text mt-1 font-display text-5xl font-extrabold leading-none tracking-tight ${
              state ? "text-berry" : "text-cream/25"
            }`}
          >
            {state ? <RollingAmount wei={halfWei} ethUsd={state.ethUsd} /> : "—"}
          </div>
          {state && (
            <div className="mt-0.5 font-mono text-xs font-semibold text-cream/40">{fmtEth(halfWei)} ETH</div>
          )}
          {state && (
            <div className="mt-1.5 flex flex-col items-center gap-1">
              <span className="font-mono text-[10px] leading-relaxed text-cream/45">
                🌱 win this now, or it seeds the next round — settle() always splits the vault right down the
                middle
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-cream/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-cream/35">
                vault total <RollingAmount wei={state.prizePool} ethUsd={state.ethUsd} />
              </span>
            </div>
          )}
          {state?.minBuyUsd != null && (
            <div className="mt-2 inline-flex flex-col items-center gap-0.5">
              <span className="rounded-full border-2 border-tangerine bg-tangerine/10 px-3 py-1 font-display text-xs font-extrabold tabular-nums text-tangerine">
                🔥 min buy to qualify: ${state.minBuyUsd.toLocaleString("en-US")}
              </span>
              <span className="text-[10px] font-semibold text-cream/40">
                rises as the pot grows
              </span>
            </div>
          )}
        </div>

        <div className="relative mx-auto grid h-48 w-48 place-items-center">
          <TimerRing fraction={fraction} tone={tone} />
          <div
            className={`neon-text font-display text-6xl font-extrabold leading-none tracking-tight tabular-nums ${
              expired ? "text-berry" : hot ? "animate-pulse text-tangerine" : "text-hotpot"
            }`}
          >
            {roundLive ? fmtCountdown(remaining) : "--:--"}
          </div>
        </div>
        <div className="-mt-3 font-display text-sm font-semibold text-cream/55">
          {roundLive
            ? expired
              ? "fire's out — ladling up! 🍜"
              : "keep it boiling — last to stoke wins 🔥"
            : "cold pot — drop the first log…"}
        </div>

        <div className="flex items-center justify-center gap-2 border-t-2 border-dashed border-cream/15 pt-4 text-sm">
          <span className="text-cream/45">last to stoke</span>
          <span className="rounded-full border-2 border-hotpot bg-ink px-2.5 py-0.5 font-mono font-bold tabular-nums text-hotpot">
            {roundLive ? shortAddr(state!.lastBuyer) : "—"}
          </span>
        </div>

        <WinnersDropdown
          rows={payouts.map((p) => ({ id: p.round_id, winner: p.winner, amount: p.amount, timestamp: p.timestamp, txHash: p.tx_hash }))}
          now={now}
          roundLabel="round"
          emptyText="no payouts yet"
        />
      </div>
    </section>
  );
}
