"use client";

import { FlatPanel } from "./FlatPanel";
import { explorerUrl } from "@/lib/config";
import { fmtAge, fmtEth, fmtTokens, shortAddr } from "@/lib/format";
import type { Trade } from "@/lib/useIndexer";

const VISIBLE = 5;

export function TradeTape({ trades, now }: { trades: Trade[]; now: number }) {
  const shown = trades.slice(0, VISIBLE);
  return (
    <FlatPanel title="Last buyers:">
      {shown.length === 0 && <div className="py-6 text-center text-sm font-semibold text-cream/60">no trades yet</div>}
      {shown.length > 0 && (
        <table className="w-full whitespace-nowrap text-left font-mono text-sm tabular-nums">
          <thead>
            <tr className="text-cream/60">
              <th className="py-1.5 pr-4 font-bold uppercase">age</th>
              <th className="py-1.5 pr-4 font-bold uppercase">side</th>
              <th className="py-1.5 pr-4 text-right font-bold uppercase">eth</th>
              <th className="py-1.5 pr-4 text-right font-bold uppercase">tok</th>
              <th className="py-1.5 font-bold uppercase">cook</th>
              <th className="hidden py-1.5 pl-4 text-right font-bold uppercase sm:table-cell">mc</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const buy = t.kind === "buy";
              return (
                <tr key={`${t.block_number}-${t.log_index}`} className="border-t border-cream/15">
                  <td className="py-2 pr-4 font-bold text-cream/60">{fmtAge(t.timestamp, now)}</td>
                  <td className="py-2 pr-4">
                    <span className={`font-extrabold uppercase ${buy ? "text-hotpot" : "text-cream"}`}>
                      {buy ? "buy" : "sell"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right font-bold text-cream">{fmtEth(t.eth_amount)}</td>
                  <td className="py-2 pr-4 text-right font-bold text-cream/70">{fmtTokens(t.token_amount)}</td>
                  <td className="py-2">
                    <a
                      href={explorerUrl ? `${explorerUrl}/tx/${t.tx_hash}` : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold text-cream hover:text-hotpot hover:underline"
                    >
                      {shortAddr(t.trader)}
                    </a>
                  </td>
                  <td className="hidden py-2 pl-4 text-right font-bold text-cream/50 sm:table-cell">
                    {fmtEth(t.market_cap, 2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </FlatPanel>
  );
}
