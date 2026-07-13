// Vercel (and most hosts) can hand back "" for a variable that's declared but
// left blank, not undefined — `??` doesn't catch that, so treat blank the
// same as unset. Lets the site deploy with placeholders pre-launch and pick
// up real values later purely from env, no code change needed.
function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

/** The Flap-launched token (ends in 7777). Placeholder until the token launches. */
export const TOKEN_ADDRESS = env(
  "NEXT_PUBLIC_TOKEN_ADDRESS",
  "0x0000000000000000000000000000000000000000",
) as `0x${string}`;

/** The FlapJackpot game contract (holds the pot; read-only from the dashboard). */
export const JACKPOT_ADDRESS = env(
  "NEXT_PUBLIC_JACKPOT_ADDRESS",
  "0x0000000000000000000000000000000000000000",
) as `0x${string}`;

export const INDEXER_WS = env("NEXT_PUBLIC_INDEXER_WS", "ws://localhost:8787");

// Which chain the token is on: local | mainnet (Robinhood, id 4663).
const CHAIN = env("NEXT_PUBLIC_CHAIN", "local");

const EXPLORERS: Record<string, string> = {
  mainnet: "https://robinhoodchain.blockscout.com",
  local: "",
};
export const explorerUrl = EXPLORERS[CHAIN] ?? "";

/** Where players actually buy the token. Every buy resets the clock. */
export const FLAP_TOKEN_URL = env("NEXT_PUBLIC_FLAP_TOKEN_URL", `https://flap.sh/token/${TOKEN_ADDRESS}`);
