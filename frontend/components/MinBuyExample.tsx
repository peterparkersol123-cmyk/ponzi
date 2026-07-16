import { TerminalPanel } from "./TerminalPanel";

// Mirrors indexer/src/qualify.ts — keep in sync if that formula changes.
// minBuyUsd = 20 * (floor(potUsd / 100) + 1): a qualifying buy must be worth
// at least 20% of the pot's current $100 band, floor $20.
function minQualifyingBuyUsd(potUsd: number): number {
  return 20 * (Math.floor(potUsd / 100) + 1);
}

const EXAMPLE_PCTS = ["~20%+", "20–40%", "20–30%", "20–27%", "20–25%", "20–24%", "20–23%", "20–23%", "20–23%", "20–22%"];

const EXAMPLE_BANDS = Array.from({ length: 10 }, (_, i) => {
  const lo = i * 100;
  const hi = lo + 99;
  return { lo, hi, minBuy: minQualifyingBuyUsd(lo), pct: EXAMPLE_PCTS[i] };
});

export function MinBuyExample() {
  return (
    <TerminalPanel title="hotpot / qualify / example" bodyClassName="overflow-y-auto p-3.5">
      <div className="font-mono text-[11px] font-semibold text-cream/45">
        min buy to qualify = $20 × (⌊pot ÷ $100⌋ + 1)
      </div>
      <table className="mt-2 w-full text-left font-mono text-[11px] tabular-nums">
        <thead>
          <tr className="text-cream/40">
            <th className="py-1 pr-3 font-normal lowercase">pot (usd)</th>
            <th className="py-1 pr-3 text-right font-normal lowercase">min buy</th>
            <th className="py-1 text-right font-normal lowercase">% of pot</th>
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
        buys under the threshold still trade and still pay tax into the pot — they just don&apos;t reset the
        countdown or make the buyer eligible to win.
      </p>
    </TerminalPanel>
  );
}
