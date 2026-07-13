import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  webSocket,
  type Log,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { jackpotWritesAbi, portalEvents, transferEvent } from "./abi.js";
import { startEthUsdPoller } from "./ethUsd.js";
import { minQualifyingBuyUsd } from "./qualify.js";

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
const SETTLE_POLL_MS = Number(process.env.SETTLE_POLL_MS ?? 1_000);
// recordBuy racing another wallet's permissionless settle() is a gas-priority
// contest as much as a detection-speed one — a cheap tx can sit queued behind
// others during congestion. Bump priority fee well above the network's
// current suggestion so recordBuy is never the one waiting in line.
const GAS_PRIORITY_MULTIPLIER = Number(process.env.GAS_PRIORITY_MULTIPLIER ?? 3);
// Without WS_RPC_URL, watchEvent falls back to HTTP polling at viem's default
// ~4s interval — that delay is what lets a late recordBuy lose the race
// against another wallet's permissionless settle() once the deadline passes.
// 1s is the fastest useful floor; a real websocket RPC (push, not poll) is
// still the actual fix.
const HTTP_POLLING_MS = 1_000;

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
const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: HTTP_POLLING_MS });
const streamClient: PublicClient = WS_RPC_URL
  ? createPublicClient({ chain, transport: webSocket(WS_RPC_URL) })
  : publicClient;
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
const getEthUsd = startEthUsdPoller();

// Serialize writes so nonces never collide (recordBuy vs settle).
let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>) {
  queue = queue.then(fn).catch((err) => console.error("keeper tx failed:", err?.shortMessage ?? err));
}

/**
 * Fee overrides that push this tx ahead of the network's default queue.
 * Tries EIP-1559 first (bumps priority fee, widens the fee cap to match);
 * falls back to a bumped legacy gasPrice for chains that don't support 1559.
 */
async function urgentFees(): Promise<Record<string, bigint>> {
  try {
    const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();
    const priority = maxPriorityFeePerGas * BigInt(GAS_PRIORITY_MULTIPLIER);
    const baseFee = maxFeePerGas - maxPriorityFeePerGas;
    return { maxPriorityFeePerGas: priority, maxFeePerGas: baseFee + priority };
  } catch {
    const gasPrice = await publicClient.getGasPrice();
    return { gasPrice: gasPrice * BigInt(GAS_PRIORITY_MULTIPLIER) };
  }
}

async function recordBuy(buyer: `0x${string}`) {
  const hash = await wallet.writeContract({
    address: JACKPOT,
    abi: jackpotWritesAbi,
    functionName: "recordBuy",
    args: [buyer],
    ...(await urgentFees()),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`recordBuy(${buyer}) — ${hash}`);
}

async function settle() {
  const hash = await wallet.writeContract({
    address: JACKPOT,
    abi: jackpotWritesAbi,
    functionName: "settle",
    ...(await urgentFees()),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`settle() — ${hash}`);
}

/// Only the last QUALIFYING buy in a batch matters (earlier resets are
/// overwritten anyway), so collapse to that one per poll to save gas. A buy
/// "qualifies" if its ETH value converts to at least minQualifyingBuyUsd()
/// of the pot's current USD value (see qualify.ts) — smaller buys still
/// trade fine and still pay tax into the pot, they just don't reset the
/// countdown or make the buyer eligible. If the ETH/USD feed is temporarily
/// unavailable, or the on-chain pot read fails, we fail OPEN (record the
/// last buy unchecked) rather than let a price-feed hiccup halt the game.
///
/// The recorded buyer is resolved from the token's own Transfer trail in
/// that buy's transaction, NOT Portal's reported `buyer` field —
/// aggregators/routers (GMGN, etc.) often call Portal themselves and forward
/// the tokens on to the real trader within the same tx, so the router would
/// otherwise get credited (and then fail the on-chain `must hold the token`
/// check, since it no longer does). The LAST Transfer of the token in that
/// tx is the address that's actually, verifiably holding it afterward.
async function handleBuys(logs: Log[]) {
  type Named = Log & { eventName?: string; address: `0x${string}`; args: Record<string, unknown> };
  const named = logs as Named[];

  const buys = named.filter(
    (l) => l.eventName === "TokenBought" && (l.args.token as string)?.toLowerCase() === TOKEN,
  );
  if (buys.length === 0) return;

  let qualifying = buys;
  const ethUsd = getEthUsd();

  if (ethUsd == null) {
    console.log("eth/usd price unavailable — recording last buy this batch unchecked");
  } else {
    try {
      const prizePool = await publicClient.readContract({
        address: JACKPOT,
        abi: jackpotWritesAbi,
        functionName: "prizePool",
      });
      const potUsd = Number(formatEther(prizePool)) * ethUsd;
      const minUsd = minQualifyingBuyUsd(potUsd);
      qualifying = buys.filter((b) => Number(formatEther(b.args.eth as bigint)) * ethUsd >= minUsd);
      if (qualifying.length === 0) {
        console.log(
          `no buy in this batch met the $${minUsd} qualifying threshold (pot ≈ $${potUsd.toFixed(2)}), skipping`,
        );
        return;
      }
    } catch (err) {
      console.error("qualifying-threshold check failed, recording last buy unchecked:", err);
      qualifying = buys;
    }
  }

  const lastBuyTx = qualifying[qualifying.length - 1].transactionHash;

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
    onLogs: async (logs) => handleBuys(logs as Log[]),
    onError: (err) => console.error("buy stream error:", err),
  });

  setInterval(settleLoop, SETTLE_POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
