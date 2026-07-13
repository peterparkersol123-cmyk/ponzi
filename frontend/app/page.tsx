"use client";

import { useRef } from "react";
import { useIndexer, useNow } from "@/lib/useIndexer";
import { TOKEN_ADDRESS, explorerUrl } from "@/lib/config";
import { CopyAddress } from "@/components/CopyAddress";
import { HowItWorks } from "@/components/HowItWorks";
import { PayoutHistory } from "@/components/PayoutHistory";
import { PotAmount, PotTimer } from "@/components/PotPanel";
import { PotDrops } from "@/components/PotDrops";
import { TradeTape } from "@/components/TradeTape";

// Placeholder until the X/Twitter account for this version exists.
const X_URL = "#";

export default function Home() {
  const data = useIndexer();
  const now = useNow(data.clockOffset);
  const potRef = useRef<HTMLDivElement>(null);

  return (
    <main className="mx-auto max-w-[1200px] space-y-10 px-6 py-10">
      <PotDrops trades={data.trades} targetRef={potRef} />

      <header className="text-center">
        <h1 className="font-display text-6xl font-extrabold uppercase leading-none tracking-tight text-ink">
          LBW
        </h1>
        <div className="mt-1 font-display text-lg font-bold italic text-ink">last buyer wins</div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <CopyAddress address={TOKEN_ADDRESS} />
          <a
            href={explorerUrl ? `${explorerUrl}/address/${TOKEN_ADDRESS}` : undefined}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-ink/60 hover:underline"
          >
            on flap ↗
          </a>
        </div>
      </header>

      {/* pot | timer + last buyers | last winners + how it works */}
      <div className="grid gap-8 lg:grid-cols-[240px_1fr_320px]">
        <div className="flex flex-col gap-8">
          <div ref={potRef}>
            <PotAmount state={data.state} />
          </div>

          <a href={X_URL} target="_blank" rel="noreferrer" aria-label="Follow on X" className="text-ink">
            <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>

        <div className="flex flex-col gap-8">
          <PotTimer state={data.state} now={now} />
          <div className="h-[500px] lg:mt-12 lg:h-auto lg:flex-1">
            <TradeTape trades={data.trades} now={now} />
          </div>
        </div>

        <div className="flex flex-col gap-8">
          <HowItWorks />
          <PayoutHistory payouts={data.payouts} now={now} />
        </div>
      </div>

      <footer className="pt-1 text-center text-[11px] font-semibold text-ink/50">
        no admin keys · settlement is permissionless · you can lose everything you put in
      </footer>
    </main>
  );
}
