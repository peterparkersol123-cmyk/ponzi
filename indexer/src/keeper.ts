import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatEther,
  http,
  keccak256,
  toEventSelector,
  webSocket,
  type Log,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { jackpotWritesAbi, portalEvents, portalReadsAbi, transferEvent } from "./abi.js";
import { startEthUsdPoller } from "./ethUsd.js";
import { BalanceTracker } from "./lotteryBalances.js";
import { minQualifyingBuyUsd } from "./qualify.js";

const TRANSFER_SELECTOR = toEventSelector(transferEvent);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
// Only checks whether *this* keeper should call settle() itself — settle()
// is permissionless, so this is a convenience trigger, not what determines
// game correctness. 1s of extra reads (2/cycle) on top of the indexer's own
// polling was enough to trip Alchemy's free-tier rate limit and 429 both
// services. 3s is still plenty responsive for a 60s round timer.
const SETTLE_POLL_MS = Number(process.env.SETTLE_POLL_MS ?? 3_000);
// recordBuy racing another wallet's permissionless settle() is a gas-priority
// contest as much as a detection-speed one — a cheap tx can sit queued behind
// others during congestion. Bump priority fee well above the network's
// current suggestion so recordBuy is never the one waiting in line.
const GAS_PRIORITY_MULTIPLIER = Number(process.env.GAS_PRIORITY_MULTIPLIER ?? 3);
// Only used as a fallback when WS_RPC_URL isn't set. With WS configured
// (as it should be), buy detection is push-based and this barely matters.
const HTTP_POLLING_MS = 4_000;
// Same cadence as the settle loop — cheap reads, no reason to check more often
// than the lottery's own LOTTERY_INTERVAL requires.
const LOTTERY_POLL_MS = Number(process.env.LOTTERY_POLL_MS ?? 3_000);
// Where the balance tracker's Transfer backfill starts — should match the
// indexer's START_BLOCK (the token's launch block) so lottery eligibility
// reflects true holdings, not just recent activity.
const START_BLOCK = BigInt(process.env.START_BLOCK ?? "0");
// Alchemy's free tier caps eth_getLogs at a 10-block range; see the indexer's
// identical BACKFILL_CHUNK for the same reasoning.
const LOTTERY_BACKFILL_CHUNK = BigInt(process.env.LOTTERY_BACKFILL_CHUNK ?? "10");

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
const balances = new BalanceTracker(publicClient, streamClient, TOKEN, START_BLOCK, LOTTERY_BACKFILL_CHUNK);

// Serialize writes so nonces never collide (recordBuy vs settle vs lottery steps).
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

/**
 * The recorded buyer is resolved from the token's own Transfer trail in the
 * buy's transaction, NOT Portal's reported `buyer` field — aggregators/
 * routers (GMGN, etc.) often call Portal themselves and forward the tokens
 * on to the real trader within the same tx, so the router would otherwise
 * get credited (and then fail the on-chain `must hold the token` check,
 * since it no longer does). The LAST Transfer of the token in that tx is
 * the address that's actually, verifiably holding it afterward.
 *
 * Fetches the transaction receipt directly rather than relying on the
 * Transfer log showing up in the same watchEvent batch as TokenBought — a
 * WS subscription typically pushes each log as its own notification, so by
 * the time TokenBought arrives, its Transfer(s) are often in a different
 * batch (or haven't arrived yet). A tx's receipt always has all of that
 * tx's logs, regardless of how the provider happened to batch the pushes.
 *
 * The WS provider (Alchemy) can notify about a tx before the separate HTTP
 * node behind RPC_URL has indexed its receipt yet — retries with backoff
 * ride out that lag instead of throwing straight into an unhandled
 * rejection that crashes the whole keeper process.
 */
async function resolveBuyer(buyTx: `0x${string}`): Promise<`0x${string}` | null> {
  let receipt;
  for (let attempt = 0; ; attempt++) {
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: buyTx });
      break;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  const transfers = receipt.logs.filter(
    (l) => l.address.toLowerCase() === TOKEN && l.topics[0] === TRANSFER_SELECTOR,
  );
  if (transfers.length === 0) return null;
  const last = transfers.reduce((a, b) => (b.logIndex > a.logIndex ? b : a));
  const { args } = decodeEventLog({ abi: [transferEvent], data: last.data, topics: last.topics });
  return (args as { to: `0x${string}` }).to;
}

/// Only the last QUALIFYING buy in a batch matters (earlier resets are
/// overwritten anyway), so collapse to that one per poll to save gas. A buy
/// "qualifies" if its ETH value converts to at least minQualifyingBuyUsd()
/// of the pot's current USD value (see qualify.ts) — smaller buys still
/// trade fine and still pay tax into the pot, they just don't reset the
/// countdown or make the buyer eligible. If the ETH/USD feed is temporarily
/// unavailable, or the on-chain pot read fails, we fail OPEN (record the
/// last buy unchecked) rather than let a price-feed hiccup halt the game.
async function handleBuys(logs: Log[]) {
  type Named = Log & { eventName?: string; args: Record<string, unknown> };
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
  if (lastBuyTx == null) return;
  const realBuyer = await resolveBuyer(lastBuyTx);
  if (realBuyer == null) {
    console.error(`no Transfer found for buy tx ${lastBuyTx}, skipping recordBuy`);
    return;
  }
  enqueue(() => recordBuy(realBuyer));
}

async function settleLoop() {
  try {
    const [deadline, lastBuyer] = await Promise.all([
      publicClient.readContract({ address: JACKPOT, abi: jackpotWritesAbi, functionName: "deadline" }),
      publicClient.readContract({ address: JACKPOT, abi: jackpotWritesAbi, functionName: "lastBuyer" }),
    ]);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (lastBuyer !== ZERO_ADDRESS && deadline > 0n && now > deadline) {
      enqueue(settle);
    }
  } catch (err) {
    console.error("settle poll failed:", err);
  }
}

// ---------------------------------------------------------------- lottery cycle

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

/**
 * The secret lives only in memory between commit and reveal. If the keeper
 * restarts mid-cycle (deploy, crash), it's lost and this draw stalls —
 * recoverable via the contract's permissionless cancelStaleLotteryCommitment()
 * after COMMITMENT_TIMEOUT, at which point a fresh cycle starts. No funds are
 * ever at risk from this, only the availability of that one draw.
 */
let pendingSecret: `0x${string}` | null = null;
// Guards against piling up duplicate lottery actions across poll ticks that
// fire before the previous action's on-chain effect is visible yet.
let lotteryActionInFlight = false;
let lotteryIntervalSeconds = 600n; // overwritten from the contract at startup

async function commitLotteryCycle() {
  const secret = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const commitment = keccak256(secret);
  pendingSecret = secret;
  const hash = await wallet.writeContract({
    address: JACKPOT,
    abi: jackpotWritesAbi,
    functionName: "commitLottery",
    args: [commitment],
    ...(await urgentFees()),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`commitLottery(${commitment}) — ${hash}`);
}

async function revealLotteryCycle() {
  if (pendingSecret == null) {
    console.error("no pending lottery secret in memory (keeper likely restarted mid-cycle) — " +
      "waiting for permissionless stale-commitment recovery instead of guessing");
    return;
  }
  const secret = pendingSecret;
  const hash = await wallet.writeContract({
    address: JACKPOT,
    abi: jackpotWritesAbi,
    functionName: "revealLottery",
    args: [secret],
    ...(await urgentFees()),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`revealLottery — ${hash}`);
  pendingSecret = null;
}

async function declareLotteryWinnerCycle() {
  if (!balances.isReady()) {
    console.log("balance tracker still backfilling — deferring lottery winner declaration");
    return;
  }
  const randomness = await publicClient.readContract({
    address: JACKPOT,
    abi: jackpotWritesAbi,
    functionName: "lotteryRandomness",
  });

  let pool: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  try {
    const state = await publicClient.readContract({
      address: PORTAL,
      abi: portalReadsAbi,
      functionName: "getTokenV8Safe",
      args: [TOKEN],
    });
    pool = state.pool;
  } catch (err) {
    console.error("could not read DEX pool address for lottery exclusion, proceeding without it:", err);
  }
  const excluded = new Set([PORTAL.toLowerCase(), JACKPOT.toLowerCase(), pool.toLowerCase()]);

  const winner = balances.pickWinner(randomness, excluded);
  if (winner == null) {
    console.error("no eligible lottery holders found this cycle — skipping declare");
    return;
  }

  const hash = await wallet.writeContract({
    address: JACKPOT,
    abi: jackpotWritesAbi,
    functionName: "declareLotteryWinner",
    args: [winner],
    ...(await urgentFees()),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`declareLotteryWinner(${winner}) randomness=${randomness} — ${hash}`);
}

async function lotteryLoop() {
  if (!balances.isReady() || lotteryActionInFlight) return;
  try {
    const [commitment, commitTime, randomness] = await Promise.all([
      publicClient.readContract({ address: JACKPOT, abi: jackpotWritesAbi, functionName: "lotteryCommitment" }),
      publicClient.readContract({ address: JACKPOT, abi: jackpotWritesAbi, functionName: "lotteryCommitTime" }),
      publicClient.readContract({ address: JACKPOT, abi: jackpotWritesAbi, functionName: "lotteryRandomness" }),
    ]);
    const now = BigInt(Math.floor(Date.now() / 1000));

    let action: (() => Promise<void>) | null = null;
    if (randomness !== ZERO_BYTES32) {
      action = declareLotteryWinnerCycle;
    } else if (commitment !== ZERO_BYTES32) {
      if (now >= commitTime + lotteryIntervalSeconds) action = revealLotteryCycle;
    } else {
      action = commitLotteryCycle;
    }

    if (action) {
      lotteryActionInFlight = true;
      enqueue(async () => {
        try {
          await action!();
        } finally {
          lotteryActionInFlight = false;
        }
      });
    }
  } catch (err) {
    console.error("lottery poll failed:", err);
  }
}

async function main() {
  console.log(`Keeper ${account.address} watching Portal ${PORTAL} for buys of ${TOKEN}`);

  try {
    lotteryIntervalSeconds = await publicClient.readContract({
      address: JACKPOT,
      abi: jackpotWritesAbi,
      functionName: "LOTTERY_INTERVAL",
    });
  } catch (err) {
    console.error("could not read LOTTERY_INTERVAL from contract, using default 600s:", err);
  }

  streamClient.watchEvent({
    address: PORTAL,
    events: [portalEvents.TokenBought],
    onLogs: async (logs) => {
      try {
        await handleBuys(logs as Log[]);
      } catch (err) {
        console.error("handleBuys failed:", err);
      }
    },
    onError: (err) => console.error("buy stream error:", err),
  });

  setInterval(settleLoop, SETTLE_POLL_MS);
  setInterval(lotteryLoop, LOTTERY_POLL_MS);

  // Balance tracking (needed for weighted lottery winner selection) runs in
  // the background — its backfill must not delay recordBuy/settle coming
  // online. The lottery loop already checks isReady() before acting.
  balances.start().catch((err) => console.error("balance tracker failed to start:", err));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
