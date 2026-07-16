"use client";

import { CopyAddress } from "./CopyAddress";

export type Section = "games" | "twitter" | "system";

const ITEMS: { id: Section; label: string }[] = [
  { id: "games", label: "games" },
  { id: "twitter", label: "twitter" },
  { id: "system", label: "system" },
];

export function NavRail({
  active,
  onSelect,
  buyUrl,
  tokenAddress,
}: {
  active: Section;
  onSelect: (s: Section) => void;
  buyUrl: string;
  tokenAddress: string;
}) {
  return (
    <nav className="flex w-full max-w-md flex-col gap-3">
      <a href={buyUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3">
        <span className="h-3 w-3 shrink-0 rounded-full bg-hotpot shadow-[0_0_10px_2px_rgba(207,242,63,0.6)]" />
        <span className="flex-1 rounded-full border-2 border-hotpot bg-hotpot px-5 py-3 text-center font-display text-sm font-extrabold uppercase tracking-widest text-ink shadow-[0_0_25px_-4px_rgba(207,242,63,0.9)] transition-transform hover:scale-[1.02]">
          buy on flap
        </span>
      </a>

      {ITEMS.map((item) => {
        const isActive = item.id === active;
        return (
          <button key={item.id} onClick={() => onSelect(item.id)} className="flex items-center gap-3 text-left">
            <span
              className={`h-3 w-3 shrink-0 rounded-full transition-colors ${
                isActive ? "bg-hotpot shadow-[0_0_10px_2px_rgba(207,242,63,0.6)]" : "bg-cream/20"
              }`}
            />
            <span
              className={`flex-1 rounded-full border-2 px-5 py-2.5 font-display text-sm font-extrabold uppercase tracking-widest transition-colors ${
                isActive
                  ? "border-hotpot bg-hotpot/10 text-hotpot"
                  : "border-cream/15 bg-transparent text-cream/50 hover:border-cream/30 hover:text-cream/80"
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}

      <div className="mt-4 self-start">
        <CopyAddress address={tokenAddress} />
      </div>
    </nav>
  );
}
