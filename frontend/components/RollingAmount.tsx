"use client";

import { useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import { fmtEthFromNumber, fmtUsdFromNumber } from "@/lib/format";

/** Pot/lottery-pool amount that tweens toward a new value instead of
 *  snapping, so growth reads as something happening rather than a re-render.
 *  Interpolates on the plain ETH float (never round-trips through wei) to
 *  avoid float-precision games with BigInt. */
export function RollingAmount({ wei, ethUsd }: { wei: string; ethUsd: number | null }) {
  const target = Number(formatEther(BigInt(wei)));
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const prevWei = useRef(wei);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevWei.current === wei) return;
    prevWei.current = wei;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      displayRef.current = target;
      return;
    }

    const from = displayRef.current;
    const to = target;
    const start = performance.now();
    const DUR = 650;

    function tick(now: number) {
      const p = Math.min(1, (now - start) / DUR);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (to - from) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wei]);

  return <>{ethUsd != null ? fmtUsdFromNumber(display * ethUsd) : `${fmtEthFromNumber(display)} ETH`}</>;
}
