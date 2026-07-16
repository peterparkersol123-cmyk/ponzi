"use client";

import { useEffect, useRef, useState } from "react";
import type { IndexerData, LotteryPayout, Payout, Trade } from "./useIndexer";

export interface ActivityEvent {
  id: string;
  kind: "buy" | "sell" | "payout" | "lotteryPayout";
  trade?: Trade;
  payout?: Payout;
  lotteryPayout?: LotteryPayout;
}

const tradeKey = (t: Trade) => `${t.block_number}-${t.log_index}`;

/** Derives a flat, newest-first feed of "things that just happened" from the
 *  indexer's push streams — shared by the toast stack, sound engine, node-
 *  network activity bursts, and the winner spotlight, so they all agree on
 *  what counts as "new" instead of each re-deriving their own cursor.
 *
 *  The first snapshot after connecting is used purely to set a baseline
 *  (however much or little backfill it contains) — it never itself produces
 *  events, so a reconnect doesn't replay history. Everything after that
 *  baseline pass is compared against it and emitted, including the very
 *  next item even if the snapshot was empty. */
export function useActivityEvents(data: IndexerData): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const seenTrade = useRef<string | null>(null);
  const seenPayout = useRef<number | null>(null);
  const seenLottery = useRef<number | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    if (!data.state) return;

    if (!primed.current) {
      primed.current = true;
      seenTrade.current = data.trades.length > 0 ? tradeKey(data.trades[0]) : "";
      seenPayout.current = data.payouts.length > 0 ? data.payouts[0].round_id : -1;
      seenLottery.current = data.lotteryPayouts.length > 0 ? data.lotteryPayouts[0].lottery_round_id : -1;
      return;
    }

    const fresh: ActivityEvent[] = [];

    if (data.trades.length > 0) {
      const newest = tradeKey(data.trades[0]);
      if (newest !== seenTrade.current) {
        for (const t of data.trades) {
          if (tradeKey(t) === seenTrade.current) break;
          fresh.push({ id: `trade-${tradeKey(t)}`, kind: t.kind, trade: t });
        }
        seenTrade.current = newest;
      }
    }

    if (data.payouts.length > 0) {
      const newest = data.payouts[0].round_id;
      if (newest !== seenPayout.current) {
        for (const p of data.payouts) {
          if (p.round_id === seenPayout.current) break;
          fresh.push({ id: `payout-${p.round_id}`, kind: "payout", payout: p });
        }
        seenPayout.current = newest;
      }
    }

    if (data.lotteryPayouts.length > 0) {
      const newest = data.lotteryPayouts[0].lottery_round_id;
      if (newest !== seenLottery.current) {
        for (const p of data.lotteryPayouts) {
          if (p.lottery_round_id === seenLottery.current) break;
          fresh.push({ id: `lottery-${p.lottery_round_id}`, kind: "lotteryPayout", lotteryPayout: p });
        }
        seenLottery.current = newest;
      }
    }

    if (fresh.length > 0) {
      setEvents((prev) => [...fresh.reverse(), ...prev].slice(0, 30));
    }
  }, [data.state, data.trades, data.payouts, data.lotteryPayouts]);

  return events;
}
