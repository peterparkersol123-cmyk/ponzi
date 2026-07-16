"use client";

import { useEffect, useRef } from "react";
import { playBlip, playChime } from "@/lib/sound";
import type { ActivityEvent } from "@/lib/useActivityEvents";

/** No visual output — plays a cue for each newly-arrived event while sound
 *  is enabled. Keeps its own "already played" set so toggling sound on
 *  mid-session doesn't dump a backlog of missed blips all at once. */
export function SoundEngine({ events, enabled }: { events: ActivityEvent[]; enabled: boolean }) {
  const played = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const e of events) {
      if (played.current.has(e.id)) continue;
      played.current.add(e.id);
      if (!enabled) continue;
      if (e.kind === "payout" || e.kind === "lotteryPayout") playChime();
      else if (e.kind === "buy" && e.trade?.qualified) playBlip();
    }
  }, [events, enabled]);

  return null;
}
