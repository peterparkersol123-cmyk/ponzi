"use client";

import { useRef } from "react";
import { useIndexer, useNow } from "@/lib/useIndexer";
import { TOKEN_ADDRESS, explorerUrl } from "@/lib/config";
import { CopyAddress } from "@/components/CopyAddress";
import { HowItWorks } from "@/components/HowItWorks";
import { Leaderboard } from "@/components/Leaderboard";
import { Logo } from "@/components/Logo";
import { PayoutHistory } from "@/components/PayoutHistory";
import { PotDrops } from "@/components/PotDrops";
import { PotPanel } from "@/components/PotPanel";
import { StatsBar } from "@/components/StatsBar";
import { TradeTape } from "@/components/TradeTape";
import { XFeed } from "@/components/XFeed";

export default function Home() {
  const data = useIndexer();
  const now = useNow(data.clockOffset);
  const potRef = useRef<HTMLDivElement>(null);

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-6">
      <PotDrops trades={data.trades} targetRef={potRef} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl border-[3px] border-ink bg-hotpot shadow-[3px_3px_0_0_var(--ink)]">
            <Logo className="h-7 w-7 text-ink" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-cream">
              Hotpot
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <CopyAddress address={TOKEN_ADDRESS} />
              <a
                href={explorerUrl ? `${explorerUrl}/address/${TOKEN_ADDRESS}` : undefined}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-cream/50 hover:underline"
              >
                on flap ↗
              </a>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold shadow-[2px_2px_0_0_var(--ink)]">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${data.connected ? "bg-berry" : "bg-ink/30"}`}
          />
          <span className="text-ink">{data.connected ? "live" : "reconnecting…"}</span>
        </div>
      </header>

      {/* live feed sits to the left, running the full height of the dashboard */}
      <div className="grid items-stretch gap-5 lg:grid-cols-[320px_1fr]">
        <div className="h-[520px] lg:h-auto">
          <XFeed />
        </div>

        <div className="space-y-5">
          <StatsBar state={data.state} hourlyVolume={data.hourlyVolume} />

          {/* pot in the middle, flanked by the leaderboard and payouts */}
          <div className="grid items-start gap-5 lg:grid-cols-3">
            <div className="order-2 lg:order-1">
              <Leaderboard entries={data.leaderboard} roundId={data.state?.roundId} />
            </div>
            <div ref={potRef} className="order-1 lg:order-2">
              <PotPanel state={data.state} now={now} />
            </div>
            <div className="order-3 lg:order-3">
              <PayoutHistory payouts={data.payouts} now={now} />
            </div>
          </div>

          {/* the wide trade tape sits below, with the how-it-works alongside */}
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TradeTape trades={data.trades} now={now} />
            </div>
            <div>
              <HowItWorks />
            </div>
          </div>
        </div>
      </div>

      <footer className="pt-1 text-center text-[11px] font-semibold text-cream/40">
        no admin keys · settlement is permissionless · you can lose everything you put in
      </footer>
    </main>
  );
}
