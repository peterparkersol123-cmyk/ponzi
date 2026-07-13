// Vercel (and most hosts) can hand back "" for a variable that's declared but
// left blank, not undefined — `??` doesn't catch that, so treat blank the
// same as unset. Lets the site deploy with placeholders pre-launch and pick
// up real values later purely from env, no code change needed.
//
// IMPORTANT: Next.js inlines NEXT_PUBLIC_* vars via static text substitution
// at build time — it only recognizes the literal `process.env.NEXT_PUBLIC_X`
// expression, not a dynamic `process.env[name]` lookup. So the
// `process.env.NEXT_PUBLIC_X` access must stay written out at each call
// site; only the *result* gets passed through this helper, never the name.
function orFallback(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

/** The Flap-launched token (ends in 7777). Placeholder until the token launches. */
export const TOKEN_ADDRESS = orFallback(
  process.env.NEXT_PUBLIC_TOKEN_ADDRESS,
  "0x0000000000000000000000000000000000000000",
) as `0x${string}`;

/** The FlapJackpot game contract (holds the pot; read-only from the dashboard). */
export const JACKPOT_ADDRESS = orFallback(
  process.env.NEXT_PUBLIC_JACKPOT_ADDRESS,
  "0x0000000000000000000000000000000000000000",
) as `0x${string}`;

export const INDEXER_WS = orFallback(process.env.NEXT_PUBLIC_INDEXER_WS, "ws://localhost:8787");

// Which chain the token is on: local | mainnet (Robinhood, id 4663).
const CHAIN = orFallback(process.env.NEXT_PUBLIC_CHAIN, "local");

const EXPLORERS: Record<string, string> = {
  mainnet: "https://robinhoodchain.blockscout.com",
  local: "",
};
export const explorerUrl = EXPLORERS[CHAIN] ?? "";

/** Where players actually buy the token. Every buy resets the clock. */
export const FLAP_TOKEN_URL = orFallback(
  process.env.NEXT_PUBLIC_FLAP_TOKEN_URL,
  `https://flap.sh/token/${TOKEN_ADDRESS}`,
);
