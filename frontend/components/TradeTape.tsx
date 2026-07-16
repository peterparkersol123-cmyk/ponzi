"use client";

import { TerminalPanel } from "./TerminalPanel";
import { explorerUrl } from "@/lib/config";
import { fmtAge, fmtEth, fmtTokens, shortAddr } from "@/lib/format";
import type { ChainState, Trade } from "@/lib/useIndexer";

export function TradeTape({ trades, now, state }: { trades: Trade[]; now: number; state?: ChainState | null }) {
  return (
    <TerminalPanel title="hotpot / trades / tail -f" bodyClassName="overflow-x-auto p-3.5">
      {trades.length === 0 && <div className="py-6 text-center text-xs text-cream/40">no trades yet</div>}
      {trades.length > 0 && (
        <table className="w-full whitespace-nowrap text-left font-mono text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-cream/40">
              <th className="py-1 pr-4 font-normal lowercase">age</th>
              <th className="py-1 pr-4 font-normal lowercase">side</th>
              <th className="py-1 pr-4 text-right font-normal lowercase">eth</th>
              <th className="py-1 pr-4 text-right font-normal lowercase">tok</th>
              <th className="py-1 font-normal lowercase">cook</th>
              <th className="hidden py-1 pl-4 text-right font-normal lowercase sm:table-cell">mc</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const buy = t.kind === "buy";
              return (
                <tr key={`${t.block_number}-${t.log_index}`} className="border-t border-cream/10">
                  <td className="py-1 pr-4 text-cream/40">{fmtAge(t.timestamp, now)}</td>
                  <td className="py-1 pr-4">
                    <span
                      className={`inline-block rounded-full border px-1.5 text-[10px] font-bold ${
                        buy ? "border-hotpot text-hotpot" : "border-berry text-berry"
                      }`}
                    >
                      {buy ? "buy" : "sell"}
                    </span>
                    {buy && t.qualified === true && (
                      <span title="qualified as last buyer" className="ml-1 text-hotpot">
                        ✓
                      </span>
                    )}
                    {buy && t.qualified === false && (
                      <span
                        title="too small to qualify — still went to the pot"
                        className="ml-1.5 text-[10px] font-semibold text-cream/30"
                      >
                        ✗{state?.minBuyUsd != null && ` needed ≈$${state.minBuyUsd.toLocaleString("en-US")}`}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-4 text-right font-bold text-cream">{fmtEth(t.eth_amount)}</td>
                  <td className="py-1 pr-4 text-right text-cream/60">{fmtTokens(t.token_amount)}</td>
                  <td className="py-1">
                    <a
                      href={explorerUrl ? `${explorerUrl}/tx/${t.tx_hash}` : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cream/80 hover:text-hotpot hover:underline"
                    >
                      {shortAddr(t.trader)}
                    </a>
                  </td>
                  <td className="hidden py-1 pl-4 text-right text-cream/30 sm:table-cell">
                    {fmtEth(t.market_cap, 2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TerminalPanel>
  );
}
