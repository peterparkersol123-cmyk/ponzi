/** Minimum USD buy size required to qualify as "last buyer", given the
 *  current USD value of the prize pool. Steps every $100 the pot grows —
 *  a buy must be at least 20% of the pot's current $100 band to count.
 *  Always at least $20, even before any pot exists, so a symbolic buy can
 *  never claim an empty pot.
 *
 *    pot $0-99    -> $20
 *    pot $100-199 -> $40
 *    pot $900-999 -> $200
 *    ...
 *
 *  Buys below this still trade normally (still pay tax into the pot) — they
 *  just don't reset the countdown or make the buyer eligible to win. */
export function minQualifyingBuyUsd(potUsd: number): number {
  const band = Math.floor(Math.max(0, potUsd) / 100);
  return 20 * (band + 1);
}
