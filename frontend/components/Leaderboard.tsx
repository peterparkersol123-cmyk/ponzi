"use client";

import { TerminalPanel } from "./TerminalPanel";
import { fmtEth, shortAddr } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/useIndexer";

const MEDAL = ["🥇", "🥈", "🥉"];

export function Leaderboard({ entries, roundId }: { entries: LeaderboardEntry[]; roundId?: number }) {
  const maxIn = Math.max(1, ...entries.map((e) => Number(e.ethIn)));

  return (
    <TerminalPanel title={`icp / cooks / round ${roundId ?? "—"}`}>
      {entries.length === 0 && (
        <div className="py-6 text-center text-xs text-cream/40">nobody at the pot yet</div>
      )}
      {entries.length > 0 && (
        <table className="w-full text-left font-mono text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-cream/40">
              <th className="w-6 py-1 pr-2 font-normal lowercase">#</th>
              <th className="py-1 pr-4 font-normal lowercase">cook</th>
              <th className="py-1 pr-4 text-right font-normal lowercase">logs</th>
              <th className="py-1 text-right font-normal lowercase">added</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const pct = Math.max(6, (Number(e.ethIn) / maxIn) * 100);
              return (
                <tr key={e.trader} className="relative border-t border-cream/10">
                  <td className="relative py-1.5 pr-2 text-cream/40">
                    {i < 3 ? MEDAL[i] : i + 1}
                  </td>
                  <td className="relative py-1.5 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-cream">{shortAddr(e.trader)}</span>
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-cream/10">
                        <span
                          className="block h-full rounded-full bg-hotpot/70"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    </div>
                  </td>
                  <td className="relative py-1.5 pr-4 text-right text-tangerine">🔥{e.buys}</td>
                  <td className="relative py-1.5 text-right font-bold text-cream">{fmtEth(e.ethIn)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TerminalPanel>
  );
}
