"use client";

import { fmtEth, fmtEthCompact, fmtUsdCompact, fmtUsdPrice } from "@/lib/format";
import type { ChainState } from "@/lib/useIndexer";

/** USD when the price feed is up, ETH-compact fallback when it's not. */
function fmtMoney(wei: string, ethUsd: number | null | undefined): string {
  return ethUsd != null ? fmtUsdCompact(wei, ethUsd) : `${fmtEthCompact(wei)} ETH`;
}

/** Same fallback rule as fmtMoney, but for a per-token unit price rather
 *  than a total — keeps sub-cent precision instead of rounding to zero. */
function fmtPrice(wei: string, ethUsd: number | null | undefined): string {
  return ethUsd != null ? fmtUsdPrice(wei, ethUsd) : `${fmtEth(wei, 10)} ETH`;
}

export function StatsBar({ state, hourlyVolume }: { state: ChainState | null; hourlyVolume: string }) {
  const stats: [string, string, string][] = [
    ["💰", "market cap", state ? fmtMoney(state.marketCap, state.ethUsd) : "—"],
    ["🏷️", "price", state ? fmtPrice(state.price, state.ethUsd) : "—"],
    ["🧑‍🤝‍🧑", "holders", state ? String(state.holders) : "—"],
    ["📈", "1h volume", fmtMoney(hourlyVolume, state?.ethUsd)],
  ];
  const curvePct = state ? Math.max(0, Math.min(100, Number(state.progress) / 1e16)) : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {stats.map(([icon, label, value]) => (
        <div
          key={label}
          className="card flex items-center gap-2.5 rounded-2xl px-3 py-2.5 shadow-[3px_3px_0_0_var(--ink)]"
        >
          <span aria-hidden className="text-lg leading-none">{icon}</span>
          <div className="min-w-0">
            <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink/45">
              {label}
            </div>
            <div className="mt-0.5 truncate text-sm font-extrabold tabular-nums text-ink">{value}</div>
          </div>
        </div>
      ))}

      {/* bonding-curve XP bar — fills toward DEX migration */}
      <div className="card flex items-center gap-2.5 rounded-2xl px-3 py-2.5 shadow-[3px_3px_0_0_var(--ink)]">
        <span aria-hidden className="text-lg leading-none">🌡️</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink/45">
            bonding curve
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full border-2 border-ink bg-cream">
              <div
                className="h-full rounded-full bg-tangerine transition-[width] duration-700 ease-out"
                style={{ width: `${state?.dexed ? 100 : curvePct}%` }}
              />
            </div>
            <div className="shrink-0 text-xs font-extrabold tabular-nums text-ink">
              {state ? (state.dexed ? "🎉" : `${curvePct.toFixed(1)}%`) : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
