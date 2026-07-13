import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  webSocket,
  type Log,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { jackpotWritesAbi, portalEvents, transferEvent } from "./abi.js";

/// The keeper is the game's referee. It watches Flap's Portal for buys of the
/// token and records the latest buyer on-chain (resetting the 60s countdown),
/// then settles rounds when the timer expires. It holds a funded key but has NO
/// power over funds — recordBuy/settle move ETH only to the winner and ops.
///
/// Run alongside (or instead of) the read-only indexer:
///   KEEPER_PRIVATE_KEY=0x... RPC_URL=... TOKEN_ADDRESS=... JACKPOT_ADDRESS=... \
///     npm run keeper

const RPC_URL = required("RPC_URL");
const WS_RPC_URL = process.env.WS_RPC_URL;
const PORTAL = (process.env.PORTAL_ADDRESS ?? "0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09") as `0x${string}`;
const TOKEN = required("TOKEN_ADDRESS").toLowerCase() as `0x${string}`;
const JACKPOT = required("JACKPOT_ADDRESS") as `0x${string}`;
const KEEPER_KEY = required("KEEPER_PRIVATE_KEY") as `0x${string}`;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 4663);
const SETTLE_POLL_MS = Number(process.env.SETTLE_POLL_MS ?? 3_000);

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

const chain = defineChain({
  id: CHAIN_ID,
  name: `chain-${CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const account = privateKeyToAccount(KEEPER_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const streamClient: PublicClient = WS_RPC_URL
  ? createPublicClient({ chain, transport: webSocket(WS_RPC_URL) })
  : publicClient;
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

// Serialize writes so nonces never collide (recordBuy vs settle).
let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>) {
  queue = queue.then(fn).catch((err) => console.error("keeper tx failed:", err?.shortMessage ?? err));
}

async function recordBuy(buyer: `0x${string}`) {
  const hash = await wallet.writeContract({
    address: JACKPOT,
    abi: jackpotWritesAbi,
    functionName: "recordBuy",
    args: [buyer],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`recordBuy(${buyer}) — ${hash}`);
}

async function settle() {
  const hash = await wallet.writeContract({
    address: JACKPOT,
    abi: jackpotWritesAbi,
    functionName: "settle",
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`settle() — ${hash}`);
}

/// Only the last buy in a batch matters (earlier resets are overwritten), so
/// collapse to the final one per poll to save gas. The recorded buyer is
/// resolved from the token's own Transfer trail in that buy's transaction,
/// NOT Portal's reported `buyer` field — aggregators/routers (GMGN, etc.)
/// often call Portal themselves and forward the tokens on to the real trader
/// within the same tx, so the router would otherwise get credited (and then
/// fail the on-chain `must hold the token` check, since it no longer does).
/// The LAST Transfer of the token in that tx is the address that's actually,
/// verifiably holding it afterward.
function handleBuys(logs: Log[]) {
  type Named = Log & { eventName?: string; address: `0x${string}`; args: Record<string, unknown> };
  const named = logs as Named[];

  const buys = named.filter(
    (l) => l.eventName === "TokenBought" && (l.args.token as string)?.toLowerCase() === TOKEN,
  );
  if (buys.length === 0) return;
  const lastBuyTx = buys[buys.length - 1].transactionHash;

  const transfers = named.filter(
    (l) => l.eventName === "Transfer" && l.address.toLowerCase() === TOKEN && l.transactionHash === lastBuyTx,
  );
  if (transfers.length === 0) {
    console.error(`no Transfer found for buy tx ${lastBuyTx}, skipping recordBuy`);
    return;
  }
  const last = transfers.reduce((a, b) => ((b.logIndex ?? 0) > (a.logIndex ?? 0) ? b : a));
  const realBuyer = last.args.to as `0x${string}`;
  enqueue(() => recordBuy(realBuyer));
}

async function settleLoop() {
  try {
    const [deadline, lastBuyer] = await Promise.all([
      publicClient.readContract({ address: JACKPOT, abi: jackpotWritesAbi, functionName: "deadline" }),
      publicClient.readContract({ address: JACKPOT, abi: jackpotWritesAbi, functionName: "lastBuyer" }),
    ]);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (lastBuyer !== "0x0000000000000000000000000000000000000000" && deadline > 0n && now > deadline) {
      enqueue(settle);
    }
  } catch (err) {
    console.error("settle poll failed:", err);
  }
}

async function main() {
  console.log(`Keeper ${account.address} watching Portal ${PORTAL} + Transfers of ${TOKEN}`);

  // Watch both in one subscription so a buy's Transfer trail always lands in
  // the same batch as its TokenBought event.
  streamClient.watchEvent({
    address: [PORTAL, TOKEN],
    events: [portalEvents.TokenBought, transferEvent],
    onLogs: (logs) => handleBuys(logs as Log[]),
    onError: (err) => console.error("buy stream error:", err),
  });

  setInterval(settleLoop, SETTLE_POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
