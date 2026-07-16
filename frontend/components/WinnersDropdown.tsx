"use client";

import { useState } from "react";
import { explorerUrl } from "@/lib/config";
import { fmtAge, fmtEth, shortAddr } from "@/lib/format";

export interface WinnerRow {
  id: number;
  winner: string;
  amount: string;
  timestamp: number;
  txHash: string;
}

/** Collapsible winners table embedded directly in a game's hero panel —
 *  folds the separate history panel into the game itself instead of making
 *  it a second thing to scroll to. Height animates via a grid-rows trick so
 *  it doesn't need JS to measure content height. */
export function WinnersDropdown({
  rows,
  now,
  roundLabel,
  emptyText,
}: {
  rows: WinnerRow[];
  now: number;
  roundLabel: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t-2 border-dashed border-cream/15 pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`group flex w-full items-center justify-between rounded-full border-[2.5px] py-1.5 pl-1.5 pr-4 font-display text-xs font-extrabold uppercase tracking-widest transition-all duration-300 ${
          open
            ? "border-hotpot bg-hotpot/10 text-hotpot shadow-[0_0_20px_-6px_rgba(207,242,63,0.8)]"
            : "border-cream/20 bg-cream/[0.03] text-cream/70 hover:border-hotpot/70 hover:text-hotpot hover:shadow-[0_0_16px_-8px_rgba(207,242,63,0.7)]"
        }`}
      >
        <span className="flex items-center gap-2.5">
          <span
            className={`grid h-7 w-7 place-items-center rounded-full border-2 text-sm transition-colors duration-300 ${
              open ? "border-hotpot bg-hotpot text-ink" : "border-cream/25 bg-ink text-cream/70 group-hover:border-hotpot"
            }`}
          >
            🏆
          </span>
          winners
          {rows.length > 0 && (
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                open ? "border-hotpot/50" : "border-cream/25"
              }`}
            >
              {rows.length}
            </span>
          )}
        </span>
        <span
          className={`grid h-6 w-6 place-items-center rounded-full border-2 text-[10px] transition-all duration-300 ${
            open ? "rotate-180 border-hotpot text-hotpot" : "border-cream/25 text-cream/50 group-hover:border-hotpot/70"
          }`}
        >
          ▾
        </span>
      </button>

      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className="mt-3 rounded-2xl border-2 border-cream/10 bg-cream/[0.03] p-3 text-left">
            {rows.length === 0 && <div className="py-4 text-center text-xs text-cream/40">{emptyText}</div>}
            {rows.length > 0 && (
              <table className="w-full text-left font-mono text-[12.5px] tabular-nums">
                <thead>
                  <tr className="text-cream/40">
                    <th className="py-1 pr-4 font-normal lowercase">{roundLabel}</th>
                    <th className="py-1 pr-4 font-normal lowercase">winner</th>
                    <th className="py-1 pr-4 text-right font-normal lowercase">won</th>
                    <th className="py-1 text-right font-normal lowercase">age</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className="border-t border-cream/10">
                      <td className="py-1.5 pr-4 text-cream/40">#{r.id}</td>
                      <td className="py-1.5 pr-4">
                        <a
                          href={explorerUrl ? `${explorerUrl}/tx/${r.txHash}?tab=internal` : undefined}
                          target="_blank"
                          rel="noreferrer"
                          title="opens the settlement tx's Internal Txns tab — that's where the winner's ETH actually shows up"
                          className="text-cream/80 hover:text-hotpot hover:underline"
                        >
                          {shortAddr(r.winner)}
                        </a>
                      </td>
                      <td className="py-1.5 pr-4 text-right font-bold text-hotpot">+{fmtEth(r.amount)}</td>
                      <td className="py-1.5 text-right text-cream/40">
                        {fmtAge(r.timestamp, now)}
                        {i === 0 && <span className="ml-1.5 text-tangerine">●</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {rows.length > 0 && (
              <p className="mt-3 border-t border-dashed border-cream/10 pt-2 font-mono text-[10px] leading-relaxed text-cream/35">
                tap a winner to jump straight to their payout — it moves as an internal call from settle(), so we
                link directly to the <span className="text-cream/50">&quot;Internal Txns&quot;</span> tab
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
