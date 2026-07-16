import { TerminalPanel } from "./TerminalPanel";

// Mirrors indexer/src/qualify.ts — keep in sync if that formula changes.
// minBuyUsd = 20 * (floor(winnableUsd / 100) + 1), where winnableUsd = pot / 2
// — settle() only ever pays out half the pot, so the threshold is banded
// against what a buy is actually competing for, not the full balance.
function minQualifyingBuyUsd(potUsd: number): number {
  const winnableUsd = Math.max(0, potUsd) / 2;
  return 20 * (Math.floor(winnableUsd / 100) + 1);
}

const EXAMPLE_PCTS = ["~20%+", "20–40%", "20–30%", "20–27%", "20–25%", "20–24%", "20–23%", "20–23%", "20–23%", "20–22%"];

const EXAMPLE_BANDS = Array.from({ length: 10 }, (_, i) => {
  const lo = i * 200;
  const hi = lo + 199;
  return { lo, hi, minBuy: minQualifyingBuyUsd(lo), pct: EXAMPLE_PCTS[i] };
});

export function MinBuyExample() {
  return (
    <TerminalPanel title="icp / qualify / example" bodyClassName="overflow-y-auto p-3.5">
      <div className="font-mono text-[11px] font-semibold text-cream/45">
        min buy to qualify = $20 × (⌊(pot ÷ 2) ÷ $100⌋ + 1)
      </div>
      <table className="mt-2 w-full text-left font-mono text-[11px] tabular-nums">
        <thead>
          <tr className="text-cream/40">
            <th className="py-1 pr-3 font-normal lowercase">total pot (usd)</th>
            <th className="py-1 pr-3 text-right font-normal lowercase">min buy</th>
            <th className="py-1 text-right font-normal lowercase">% of winnable half</th>
          </tr>
        </thead>
        <tbody>
          {EXAMPLE_BANDS.map((b) => (
            <tr key={b.lo} className="border-t border-cream/10">
              <td className="py-1 pr-3 text-cream/70">
                ${b.lo} – ${b.hi}
              </td>
              <td className="py-1 pr-3 text-right font-bold text-hotpot">${b.minBuy}</td>
              <td className="py-1 text-right text-cream/45">{b.pct}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-cream/55">
        the threshold is based on the winnable half of the pot — the half settle() actually pays out — not the
        full balance. buys under the threshold still trade and still pay tax into the pot — they just don&apos;t
        reset the countdown or make the buyer eligible to win.
      </p>
    </TerminalPanel>
  );
}
