"use client";

import { useEffect, useRef } from "react";
import { fmtEth } from "@/lib/format";
import type { Trade } from "@/lib/useIndexer";

/// Spawns "+amount" coins that fly in from the viewport edges and land in the
/// pot every time a new buy arrives on the tape. The pot bumps + glows on land.
export function PotDrops({
  trades,
  targetRef,
}: {
  trades: Trade[];
  targetRef: React.RefObject<HTMLElement | null>;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const seenKey = useRef<string | null>(null);

  useEffect(() => {
    if (trades.length === 0) return;
    const key = (t: Trade) => `${t.block_number}-${t.log_index}`;
    const newest = key(trades[0]);

    // First snapshot: prime the cursor, don't rain coins for backfilled history.
    if (seenKey.current === null) {
      seenKey.current = newest;
      return;
    }
    if (newest === seenKey.current) return;

    // Fire a coin for each new buy since we last looked (newest first).
    for (const t of trades) {
      if (key(t) === seenKey.current) break;
      if (t.kind === "buy") spawnCoin(t.eth_amount);
    }
    seenKey.current = newest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades]);

  function spawnCoin(ethAmount: string) {
    const layer = layerRef.current;
    const target = targetRef.current;
    if (!layer || !target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rect = target.getBoundingClientRect();
    const tx = rect.left + rect.width / 2;
    const ty = rect.top + rect.height * 0.42;

    // Random start point just outside a viewport edge.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const m = 40;
    let sx: number, sy: number;
    switch (Math.floor(Math.random() * 4)) {
      case 0: sx = Math.random() * w; sy = -m; break; // top
      case 1: sx = w + m; sy = Math.random() * h; break; // right
      case 2: sx = Math.random() * w; sy = h + m; break; // bottom
      default: sx = -m; sy = Math.random() * h; break; // left
    }

    const el = document.createElement("div");
    el.className = "pot-coin";
    el.textContent = `+${fmtEth(ethAmount)}`;
    el.style.left = `${tx}px`;
    el.style.top = `${ty}px`;
    layer.appendChild(el);

    const dx = sx - tx;
    const dy = sy - ty;
    // Slight arc via a perpendicular nudge at the midpoint.
    const plen = Math.hypot(dx, dy) || 1;
    const arc = 46 * (Math.random() < 0.5 ? 1 : -1);
    const mx = dx / 2 + (-dy / plen) * arc;
    const my = dy / 2 + (dx / plen) * arc;

    const anim = el.animate(
      [
        { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(0.7)`, opacity: 0 },
        { transform: `translate(-50%,-50%) translate(${mx}px,${my}px) scale(1.1)`, opacity: 1, offset: 0.18 },
        { transform: `translate(-50%,-50%) translate(${dx * 0.14}px,${dy * 0.14}px) scale(1)`, opacity: 1, offset: 0.75 },
        { transform: `translate(-50%,-50%) translate(0,0) scale(0.2)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 300, easing: "cubic-bezier(.5,.05,.4,1)" },
    );
    anim.onfinish = () => {
      el.remove();
      target.classList.add("pot-hit");
      setTimeout(() => target.classList.remove("pot-hit"), 340);
    };
  }

  return <div ref={layerRef} className="pot-drop-layer" aria-hidden="true" />;
}
