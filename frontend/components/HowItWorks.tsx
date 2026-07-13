import { TerminalPanel } from "./TerminalPanel";

// Technical description of the permissionless vault mechanics — every claim
// here maps directly to a line in FlapJackpot.sol.
const STEPS = [
  "every trade — buy or sell, on flap.sh or through any aggregator/router — pays a 3% tax in ETH straight to this contract; the token has no owner, no pause, no upgrade path",
  "incoming ETH splits automatically on-chain: 75% into the prize pool, 25% to an immutable ops address, fixed at deploy — every split is publicly verifiable via the PotFunded event",
  "Flap's Portal never calls this contract directly, so an off-chain keeper watches real buys and calls recordBuy() — the named address is checked against the token's own balance on-chain, so the keeper can't name a non-holder, and the call moves zero funds",
  "a buy only resets the countdown if it's worth at least the qualifying minimum for the pot's current size (see the qualify panel) — smaller buys still trade and still pay tax into the pot, they just don't make the buyer eligible to win",
  "each qualifying buy resets a 60-second deadline; when it lapses, settle() is permissionless — anyone, including the winner, can trigger it, and it pays the full pool to the last recorded buyer in one transaction",
  "if a payout push fails (e.g. a contract wallet that reverts), the amount queues in pendingPayouts for pull-withdrawal instead of blocking settlement — no single winner can stall the game",
  "there's no admin key anywhere: ops funds only ever reach the fixed ops address, round funds only ever reach that round's winner",
];

export function HowItWorks() {
  return (
    <TerminalPanel title="hotpot / vault / read-only">
      <ol className="space-y-3.5 font-mono text-[13px] leading-relaxed text-cream/80">
        {STEPS.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-berry text-[10px] font-bold text-berry">
              {i + 1}
            </span>
            <span>{step}</span>
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
