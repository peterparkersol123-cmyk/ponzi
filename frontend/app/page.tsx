"use client";

import { useRef, useState } from "react";
import { useIndexer, useNow } from "@/lib/useIndexer";
import { useActivityEvents } from "@/lib/useActivityEvents";
import { useSoundEnabled } from "@/lib/sound";
import { TOKEN_ADDRESS, FLAP_TOKEN_URL } from "@/lib/config";
import { ActivityToasts } from "@/components/ActivityToasts";
import { CommunitySection } from "@/components/sections/CommunitySection";
import { SystemSection } from "@/components/sections/SystemSection";
import { DrawEntrantsTicker } from "@/components/DrawEntrantsTicker";
import { Leaderboard } from "@/components/Leaderboard";
import { Logo } from "@/components/Logo";
import { LotteryPanel } from "@/components/LotteryPanel";
import { NavRail, type Section } from "@/components/NavRail";
import { NodeNetwork } from "@/components/NodeNetwork";
import { PotDrops } from "@/components/PotDrops";
import { PotPanel } from "@/components/PotPanel";
import { SoundEngine } from "@/components/SoundEngine";
import { SoundToggle } from "@/components/SoundToggle";
import { StatusReadout } from "@/components/StatusReadout";
import { TradeTape } from "@/components/TradeTape";
import { WinnerSpotlight } from "@/components/WinnerSpotlight";
import { fmtCountdown } from "@/lib/format";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function Home() {
  const data = useIndexer();
  const now = useNow(data.clockOffset);
  const potRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<Section>("games");
  const events = useActivityEvents(data);
  const [soundEnabled, toggleSound] = useSoundEnabled();

  const state = data.state;
  const roundLive = !!state && state.lastBuyer !== ZERO;
  const remaining = state ? state.deadline - now : 0;
  const hotpotExpired = roundLive && remaining <= 0;
  const hotpotUrgent = roundLive && !hotpotExpired && remaining <= 10;

  const lotteryUrgent = state?.lotteryPhase === "revealed";
  const revealDue = state ? state.lotteryCommitTime + state.lotteryIntervalSeconds : 0;

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-8 lg:px-12">
      <NodeNetwork activityTick={events.length} urgent={hotpotUrgent || lotteryUrgent} />
      <PotDrops trades={data.trades} targetRef={potRef} />
      <ActivityToasts events={events} state={state} />
      <SoundEngine events={events} enabled={soundEnabled} />
      <WinnerSpotlight events={events} />

      <div className="relative z-10 mx-auto flex max-w-[1500px] flex-col-reverse gap-10 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-8">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl border-[3px] border-ink shadow-[3px_3px_0_0_var(--ink)]">
              <Logo className="h-full w-full" />
            </div>
            <h1 className="font-display text-2xl font-extrabold uppercase leading-none tracking-tight text-cream">
              Infinite Cash Point
            </h1>
            <span className="rounded-full border-2 border-cream/15 px-2 py-0.5 font-mono text-[10px] font-bold text-cream/50">
              $ICP
            </span>
            <span
              className={`ml-2 inline-flex items-center gap-1.5 rounded-full border-2 border-cream/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                data.connected ? "text-cream/60" : "text-cream/30"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${data.connected ? "bg-berry" : "bg-cream/30"}`} />
              {data.connected ? "live" : "reconnecting…"}
            </span>
            <SoundToggle enabled={soundEnabled} onToggle={toggleSound} />
          </div>

          {section === "games" && (
            <div className="space-y-8">
              <div className="relative grid grid-cols-1 gap-10 lg:grid-cols-2">
                <div className="space-y-5">
                  <StatusReadout
                    label="pot"
                    time={roundLive ? fmtCountdown(Math.max(0, remaining)) : "--:--"}
                    banner={
                      !roundLive
                        ? { text: "cold pot — drop the first log", tone: "idle" }
                        : hotpotExpired
                          ? { text: "settling…", tone: "urgent" }
                          : hotpotUrgent
                            ? { text: "round ending — buy now to win", tone: "urgent" }
                            : { text: "buy resets the clock", tone: "idle" }
                    }
                  />
                  <div ref={potRef} />
                  <PotPanel state={state} now={now} payouts={data.payouts} />
                </div>

                <div className="pointer-events-none absolute left-1/2 top-0 hidden h-full -translate-x-1/2 flex-col items-center gap-2 lg:flex">
                  <span className="h-full w-px bg-gradient-to-b from-transparent via-cream/15 to-transparent" />
                  <span
                    className={`absolute top-24 grid h-9 w-9 place-items-center rounded-full border-2 font-display text-[11px] font-extrabold uppercase text-ink shadow-[0_0_20px_-2px_rgba(207,242,63,0.8)] ${
                      lotteryUrgent || hotpotUrgent || hotpotExpired ? "border-tangerine bg-tangerine" : "border-hotpot bg-hotpot"
                    }`}
                  >
                    vs
                  </span>
                </div>

                <div className="space-y-5">
                  <StatusReadout
                    label="lottery"
                    time={
                      state?.lotteryPhase === "committed"
                        ? fmtCountdown(Math.max(0, revealDue - now))
                        : "--:--"
                    }
                    banner={
                      state?.lotteryPhase === "revealed"
                        ? { text: "draw due — finalizing winner", tone: "urgent" }
                        : state?.lotteryPhase === "committed"
                          ? { text: "draw locked in — revealing soon", tone: "idle" }
                          : { text: "preparing next draw", tone: "idle" }
                    }
                  />
                  <LotteryPanel
                    state={state}
                    now={now}
                    latestWinner={data.lotteryPayouts[0] ?? null}
                    payouts={data.lotteryPayouts}
                  />
                  <DrawEntrantsTicker trades={data.trades} leaderboard={data.leaderboard} />
                </div>
              </div>

              <Leaderboard entries={data.leaderboard} roundId={state?.roundId} />
              <TradeTape trades={data.trades} now={now} state={state} />
            </div>
          )}

          {section === "twitter" && <CommunitySection />}
          {section === "system" && <SystemSection />}
        </div>

        <div className="shrink-0 lg:sticky lg:top-8">
          <NavRail active={section} onSelect={setSection} buyUrl={FLAP_TOKEN_URL} tokenAddress={TOKEN_ADDRESS} />
        </div>
      </div>

      <footer className="relative z-10 mx-auto mt-12 max-w-[1500px] pb-2 text-center font-mono text-[11px] font-semibold text-cream/40">
        no admin keys · settlement is permissionless · you can lose everything you put in
      </footer>
    </main>
  );
}
