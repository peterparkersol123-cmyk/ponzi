"use client";

import { TerminalPanel } from "./TerminalPanel";
import { explorerUrl } from "@/lib/config";
import { fmtAge, fmtEth, shortAddr } from "@/lib/format";
import type { LotteryPayout } from "@/lib/useIndexer";

export function LotteryWinners({ payouts, now }: { payouts: LotteryPayout[]; now: number }) {
  return (
    <TerminalPanel title="lottery / winners / history">
      {payouts.length === 0 && <div className="py-6 text-center text-xs text-cream/40">no draws yet</div>}
      {payouts.length > 0 && (
        <table className="w-full text-left font-mono text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-cream/40">
              <th className="py-1 pr-4 font-normal lowercase">draw</th>
              <th className="py-1 pr-4 font-normal lowercase">winner</th>
              <th className="py-1 pr-4 text-right font-normal lowercase">won</th>
              <th className="py-1 text-right font-normal lowercase">age</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p, i) => (
              <tr key={p.lottery_round_id} className="border-t border-cream/10">
                <td className="py-1.5 pr-4 text-cream/40">#{p.lottery_round_id}</td>
                <td className="py-1.5 pr-4">
                  <a
                    href={explorerUrl ? `${explorerUrl}/tx/${p.tx_hash}` : undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cream/80 hover:text-hotpot hover:underline"
                  >
                    {shortAddr(p.winner)}
                  </a>
                </td>
                <td className="py-1.5 pr-4 text-right font-bold text-hotpot">+{fmtEth(p.amount)}</td>
                <td className="py-1.5 text-right text-cream/40">
                  {fmtAge(p.timestamp, now)}
                  {i === 0 && <span className="ml-1.5 text-tangerine">●</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TerminalPanel>
  );
}
