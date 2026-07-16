/** Minimum USD buy size required to qualify as "last buyer", given the
 *  current USD value of the *total* prize pool. settle() only ever pays out
 *  HALF of that pool — the other half seeds the next round — so the
 *  threshold is banded against the winnable half, not the full balance,
 *  otherwise it overstates what a buy is actually competing for.
 *
 *  Steps every $100 the winnable half grows — a buy must be at least 20% of
 *  that $100 band to count. Always at least $20, even before any pot exists,
 *  so a symbolic buy can never claim an empty pot.
 *
 *    total pot $0-199   (winnable $0-99)    -> $20
 *    total pot $200-399 (winnable $100-199) -> $40
 *    total pot $1800-1999 (winnable $900-999) -> $200
 *    ...
 *
 *  Buys below this still trade normally (still pay tax into the pot) — they
 *  just don't reset the countdown or make the buyer eligible to win. */
export function minQualifyingBuyUsd(potUsd: number): number {
  const winnableUsd = Math.max(0, potUsd) / 2;
  const band = Math.floor(winnableUsd / 100);
  return 20 * (band + 1);
}
