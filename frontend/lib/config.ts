/** The Flap-launched token (ends in 7777). */
export const TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_TOKEN_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/** The FlapJackpot game contract (holds the pot; read-only from the dashboard). */
export const JACKPOT_ADDRESS = (process.env.NEXT_PUBLIC_JACKPOT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const INDEXER_WS = process.env.NEXT_PUBLIC_INDEXER_WS ?? "ws://localhost:8787";

// Which chain the token is on: local | mainnet (Robinhood, id 4663).
const CHAIN = process.env.NEXT_PUBLIC_CHAIN ?? "local";

const EXPLORERS: Record<string, string> = {
  mainnet: "https://robinhoodchain.blockscout.com",
  local: "",
};
export const explorerUrl = EXPLORERS[CHAIN] ?? "";

/** Where players actually buy the token. Every buy resets the clock. */
export const FLAP_TOKEN_URL =
  process.env.NEXT_PUBLIC_FLAP_TOKEN_URL ?? `https://flap.sh/token/${TOKEN_ADDRESS}`;
