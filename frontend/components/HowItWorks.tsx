"use client";

import { useState } from "react";
import { TerminalPanel } from "./TerminalPanel";

// Technical description of the permissionless vault mechanics — every claim
// here maps directly to a line in FlapJackpot.sol. `headline` is the
// skimmable plain-language version; `detail` is the full technical claim,
// shown behind a toggle for anyone who wants to verify it against the code.
const STEPS = [
  {
    headline: "every trade pays a 3% fee straight into this contract — no owner, no way to change that",
    detail:
      "every trade — buy or sell, on flap.sh or through any aggregator/router — pays a 3% tax in ETH straight to this contract; the token has no owner, no pause, no upgrade path",
  },
  {
    headline: "that fee splits 3 ways: 37.5% last-buyer pool, 37.5% lottery pool, 25% ops",
    detail:
      "incoming ETH splits three ways on-chain: 37.5% to the last-buyer prize pool, 37.5% to the holder lottery pool, 25% to an immutable ops address, fixed at deploy — every split is publicly verifiable via the PotFunded event",
  },
  {
    headline: "last buyer: be the last to buy before the 3-minute clock hits zero, win half the pot — the other half seeds the next round",
    detail:
      "an off-chain keeper watches real buys and calls recordBuy() — the named address is checked against the token's own balance on-chain, so the keeper can't name a non-holder, and the call moves zero funds. A qualifying buy resets a 3-minute deadline; when it lapses, settle() is permissionless and pays out HALF the prize pool to the last recorded buyer — the other half seeds the next round so it never opens empty",
  },
  {
    headline: "holder lottery: just hold tokens — a winner is drawn automatically every 10 minutes",
    detail:
      "every 10 minutes the keeper runs a commit → reveal → declare cycle — commits a hashed secret before any outcome is knowable, reveals it later (verified on-chain, mixed with that transaction's own blockhash so it can't be predicted in advance), then declares a winner weighted by token balance. The winner mapping is computed off-chain but publicly reproducible from the on-chain randomness and the token's transfer history",
  },
  {
    headline: "winnings are paid out automatically — no claiming, no action needed on your end",
    detail:
      "if a payout push fails (e.g. a contract wallet that reverts), the amount queues in pendingPayouts for pull-withdrawal instead of blocking settlement — no single winner can stall either game",
  },
  {
    headline: "no admin key, anywhere — money can only go to a winner or the fixed ops address",
    detail:
      "there's no admin key anywhere: ops funds only ever reach the fixed ops address, round/draw funds only ever reach that round's or draw's winner",
  },
];

export function HowItWorks() {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <TerminalPanel title="icp / vault / read-only">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold text-cream/40">the short version:</span>
        <button
          type="button"
          onClick={() => setShowDetail((s) => !s)}
          className={`rounded-full border-2 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors ${
            showDetail ? "border-hotpot bg-hotpot/10 text-hotpot" : "border-cream/20 text-cream/50 hover:border-hotpot/60 hover:text-hotpot"
          }`}
        >
          {showDetail ? "hide technical detail" : "show technical detail"}
        </button>
      </div>

      <ol className="space-y-3.5 font-mono text-[13px] leading-relaxed text-cream/80">
        {STEPS.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-berry text-[10px] font-bold text-berry">
              {i + 1}
            </span>
            <div className="min-w-0">
              <span>{step.headline}</span>
              <div
                className="grid transition-[grid-template-rows] duration-300 ease-out"
                style={{ gridTemplateRows: showDetail ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <p className="mt-1.5 text-[12px] leading-relaxed text-cream/45">{step.detail}</p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <a
        href="https://docs.flap.sh/flap/developers/token-launcher-developers/launch-token-through-portal"
        target="_blank"
        rel="noreferrer"
        className="mt-4 block border-t border-cream/10 pt-3 font-mono text-[11px] font-semibold text-hotpot hover:underline"
      >
        verify the tax-beneficiary mechanism on docs.flap.sh ↗
      </a>
    </TerminalPanel>
  );
}
