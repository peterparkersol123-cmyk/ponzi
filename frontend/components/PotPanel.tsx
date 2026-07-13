"use client";

import { Logo } from "./Logo";
import { fmtCountdown, fmtEth, shortAddr } from "@/lib/format";
import type { ChainState } from "@/lib/useIndexer";

const ZERO = "0x0000000000000000000000000000000000000000";
const ROUND_SECONDS = 60;

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
export function PotPanel({ state, now }: { state: ChainState | null; now: number }) {
  const remaining = state ? state.deadline - now : 0;
  const roundLive = !!state && state.lastBuyer !== ZERO;
  const expired = roundLive && remaining <= 0;
  const hot = roundLive && !expired && remaining <= 10;
  const tone = expired ? "berry" : hot ? "tangerine" : "hotpot";
  const fraction = roundLive ? remaining / ROUND_SECONDS : 1;

  return (
    <section className="overflow-hidden rounded-2xl border-[2.5px] border-hotpot bg-ink text-cream shadow-[0_0_60px_-16px_rgba(207,242,63,0.55)]">
      <div className="flex items-center gap-1.5 border-b-[2.5px] border-ink bg-hotpot px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="ml-1.5 truncate font-mono text-[11px] font-semibold tracking-tight text-ink/65">
          hotpot / pot / round {state?.roundId ?? "—"}
        </span>
      </div>

      <div className="space-y-5 px-5 pb-7 pt-6 text-center">
        <div className="pot-bob mx-auto grid h-16 w-16 place-items-center rounded-full border-[3px] border-hotpot bg-ink shadow-[0_0_24px_-4px_rgba(207,242,63,0.7)]">
          <Logo className="h-9 w-9 text-hotpot" />
        </div>

        <div>
          <div className="font-display text-xs font-bold uppercase tracking-[0.25em] text-cream/45">
            The pot
          </div>
          <div
            className={`neon-text mt-1 font-display text-5xl font-extrabold leading-none tracking-tight ${
              state ? "text-berry" : "text-cream/25"
            }`}
          >
            {state ? fmtEth(state.prizePool) : "—"}
            <span className="ml-1 align-top text-xl text-cream">ETH</span>
          </div>
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
      </div>
    </section>
  );
}
