"use client";

import { FlatPanel } from "./FlatPanel";
import { explorerUrl } from "@/lib/config";
import { fmtAge, fmtEth, shortAddr } from "@/lib/format";
import type { Payout } from "@/lib/useIndexer";

export function PayoutHistory({ payouts, now }: { payouts: Payout[]; now: number }) {
  return (
    <FlatPanel title="Last winners:">
      {payouts.length === 0 && <div className="py-6 text-center text-sm font-semibold text-cream/60">no payouts yet</div>}
      {payouts.length > 0 && (
        <table className="w-full text-left font-mono text-sm tabular-nums">
          <thead>
            <tr className="text-cream/60">
              <th className="py-1.5 pr-4 font-bold uppercase">round</th>
              <th className="py-1.5 pr-4 font-bold uppercase">winner</th>
              <th className="py-1.5 pr-4 text-right font-bold uppercase">won</th>
              <th className="py-1.5 text-right font-bold uppercase">age</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p, i) => (
              <tr key={p.round_id} className="border-t border-cream/15">
                <td className="py-2 pr-4 font-bold text-cream">#{p.round_id}</td>
                <td className="py-2 pr-4">
                  <a
                    href={explorerUrl ? `${explorerUrl}/tx/${p.tx_hash}` : undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-cream hover:text-hotpot hover:underline"
                  >
                    {shortAddr(p.winner)}
                  </a>
                </td>
                <td className="py-2 pr-4 text-right font-extrabold text-hotpot">+{fmtEth(p.amount)}</td>
                <td className="py-2 text-right font-bold text-cream/60">
                  {fmtAge(p.timestamp, now)}
                  {i === 0 && <span className="ml-1.5 text-hotpot">●</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FlatPanel>
  );
}
