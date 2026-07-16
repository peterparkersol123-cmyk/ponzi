import {
  createPublicClient,
  decodeEventLog,
  formatEther,
  http,
  toEventSelector,
  webSocket,
  type AbiEvent,
  type Log,
  type PublicClient,
} from "viem";
import { WebSocketServer, WebSocket } from "ws";
import { jackpotEvents, jackpotReadsAbi, portalEvents, portalReadsAbi, transferEvent } from "./abi.js";
import { openDb, Store, type TradeRow, type PayoutRow, type LotteryPayoutRow } from "./db.js";
import { startEthUsdPoller } from "./ethUsd.js";
import { minQualifyingBuyUsd } from "./qualify.js";

// ---------------------------------------------------------------- config

const RPC_URL = required("RPC_URL");
const WS_RPC_URL = process.env.WS_RPC_URL; // optional but recommended for prod
const PORTAL = (process.env.PORTAL_ADDRESS ?? "0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09") as `0x${string}`;
const TOKEN = required("TOKEN_ADDRESS").toLowerCase() as `0x${string}`;
const JACKPOT = required("JACKPOT_ADDRESS").toLowerCase() as `0x${string}`;
const START_BLOCK = BigInt(process.env.START_BLOCK ?? "0");
const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? "./jackpot.db";
// Alchemy's free tier caps eth_getLogs at a 10-block range; a paid plan (or a
// provider without that cap) can raise this via BACKFILL_CHUNK.
const BACKFILL_CHUNK = BigInt(process.env.BACKFILL_CHUNK ?? "10");
// Now that WS_RPC_URL delivers buy events by push (not poll), this only
// governs the periodic pot/deadline refresh — 1s was hammering Alchemy's
// free-tier rate limit (5 reads/cycle + the keeper's own reads on the same
// key) hard enough to 429 constantly and stall the site. 3s keeps the
// display fresh without tripping the limit.
const STATE_POLL_MS = 3_000;
// Only used as a fallback when WS_RPC_URL isn't set (plain HTTP polling for
// event watching). With WS configured this is effectively unused.
const HTTP_POLLING_MS = 4_000;

const ONE_BILLION = 1_000_000_000n; // Flap tokens: fixed 1B max supply
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name} (see .env.example)`);
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------- chain clients

const httpClient = createPublicClient({ transport: http(RPC_URL), pollingInterval: HTTP_POLLING_MS });
const streamClient: PublicClient = WS_RPC_URL
  ? createPublicClient({ transport: webSocket(WS_RPC_URL) })
  : httpClient;

const store = new Store(openDb(DB_PATH));
if (store.resetIfContractChanged(JACKPOT)) {
  console.log(`Jackpot contract changed — wiped stale history, starting fresh for ${JACKPOT}`);
}

// ---------------------------------------------------------------- event routing

// All watched events keyed by topic0 → decode with the right ABI item.
const eventBySelector = new Map<string, { name: string; abi: AbiEvent }>();
for (const [name, abi] of Object.entries(portalEvents)) {
  eventBySelector.set(toEventSelector(abi), { name: `portal:${name}`, abi });
}
for (const [name, abi] of Object.entries(jackpotEvents)) {
  eventBySelector.set(toEventSelector(abi), { name: `jackpot:${name}`, abi });
}
eventBySelector.set(toEventSelector(transferEvent), { name: "token:Transfer", abi: transferEvent });

const watchedAddresses = [PORTAL, TOKEN, JACKPOT] as `0x${string}`[];
const watchedEventAbis = [...Object.values(portalEvents), ...Object.values(jackpotEvents), transferEvent];

// ---------------------------------------------------------------- chain state

interface ChainState {
  prizePool: string;
  opsAccrued: string;
  deadline: number;
  lastBuyer: string;
  roundId: number;
  holders: number;
  circulatingSupply: string;
  price: string;
  marketCap: string; // FDV = price * 1e9, matching flap.sh convention
  reserve: string;
  progress: string; // 0..1e18 toward DEX migration
  dexed: boolean;
  ethUsd: number | null;
  /** USD a buy must be worth right now to reset the countdown / qualify as
   *  last buyer (see qualify.ts) — null until the ETH/USD feed is up. */
  minBuyUsd: number | null;

  // ---- lottery ----
  lotteryPool: string;
  lotteryRoundId: number;
  /** "idle" — no draw in progress, keeper will commit soon.
   *  "committed" — secret committed, waiting out LOTTERY_INTERVAL before reveal.
   *  "revealed" — randomness finalized on-chain, waiting for the keeper to
   *  declare a winner (weighted selection computed off-chain). */
  lotteryPhase: "idle" | "committed" | "revealed";
  lotteryCommitTime: number;
  lotteryRevealTime: number;
  lotteryIntervalSeconds: number;
}

let chainState: ChainState | null = null;

// Native token is ETH, so USD display (and the qualifying-buy threshold)
// needs an external price feed — shared with the keeper via ethUsd.ts.
const getEthUsd = startEthUsdPoller();

async function refreshChainState(): Promise<ChainState> {
  const j = { address: JACKPOT, abi: jackpotReadsAbi } as const;
  const [
    prizePool,
    opsAccrued,
    deadline,
    lastBuyer,
    roundId,
    tokenState,
    lotteryPool,
    lotteryRoundId,
    lotteryCommitment,
    lotteryCommitTime,
    lotteryRandomness,
    lotteryRevealTime,
    lotteryIntervalSeconds,
  ] = await Promise.all([
    httpClient.readContract({ ...j, functionName: "prizePool" }),
    httpClient.readContract({ ...j, functionName: "opsAccrued" }),
    httpClient.readContract({ ...j, functionName: "deadline" }),
    httpClient.readContract({ ...j, functionName: "lastBuyer" }),
    httpClient.readContract({ ...j, functionName: "roundId" }),
    httpClient.readContract({ address: PORTAL, abi: portalReadsAbi, functionName: "getTokenV8Safe", args: [TOKEN] }),
    httpClient.readContract({ ...j, functionName: "lotteryPool" }),
    httpClient.readContract({ ...j, functionName: "lotteryRoundId" }),
    httpClient.readContract({ ...j, functionName: "lotteryCommitment" }),
    httpClient.readContract({ ...j, functionName: "lotteryCommitTime" }),
    httpClient.readContract({ ...j, functionName: "lotteryRandomness" }),
    httpClient.readContract({ ...j, functionName: "lotteryRevealTime" }),
    httpClient.readContract({ ...j, functionName: "LOTTERY_INTERVAL" }),
  ]);
  const ethUsd = getEthUsd();
  const potUsd = ethUsd != null ? Number(formatEther(prizePool)) * ethUsd : null;
  const lotteryPhase: ChainState["lotteryPhase"] =
    lotteryRandomness !== ZERO_BYTES32 ? "revealed" : lotteryCommitment !== ZERO_BYTES32 ? "committed" : "idle";
  chainState = {
    prizePool: prizePool.toString(),
    opsAccrued: opsAccrued.toString(),
    deadline: Number(deadline),
    lastBuyer,
    roundId: Number(roundId),
    holders: store.holdersCount([PORTAL, TOKEN, JACKPOT, tokenState.pool]),
    circulatingSupply: tokenState.circulatingSupply.toString(),
    price: tokenState.price.toString(),
    marketCap: (tokenState.price * ONE_BILLION).toString(),
    reserve: tokenState.reserve.toString(),
    progress: tokenState.progress.toString(),
    dexed: tokenState.status === 4,
    ethUsd,
    minBuyUsd: potUsd != null ? minQualifyingBuyUsd(potUsd) : null,
    lotteryPool: lotteryPool.toString(),
    lotteryRoundId: Number(lotteryRoundId),
    lotteryPhase,
    lotteryCommitTime: Number(lotteryCommitTime),
    lotteryRevealTime: Number(lotteryRevealTime),
    lotteryIntervalSeconds: Number(lotteryIntervalSeconds),
  };
  return chainState;
}

// ---------------------------------------------------------------- websocket push

const wss = new WebSocketServer({ port: PORT });

function snapshot() {
  const now = Math.floor(Date.now() / 1000);
  return {
    type: "snapshot",
    state: chainState,
    trades: store.recentTrades(50),
    payouts: store.recentPayouts(20),
    lotteryPayouts: store.recentLotteryPayouts(20),
    leaderboard: chainState ? store.roundLeaderboard(chainState.roundId) : [],
    hourlyVolume: store.hourlyVolume(now),
    serverTime: now,
  };
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify(snapshot()));
});

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

/**
 * Visual-only estimate of whether a buy cleared the qualifying threshold
 * (see qualify.ts), using the pot/price snapshot from the last chain-state
 * refresh — not a re-derivation of the keeper's on-chain decision. Good
 * enough to badge trades in the UI; null (no badge) if the price feed isn't
 * up yet.
 */
function buyQualified(ethAmount: bigint): boolean | null {
  const ethUsd = getEthUsd();
  if (ethUsd == null || chainState == null) return null;
  const potUsd = Number(formatEther(BigInt(chainState.prizePool))) * ethUsd;
  const minUsd = minQualifyingBuyUsd(potUsd);
  return Number(formatEther(ethAmount)) * ethUsd >= minUsd;
}

// ---------------------------------------------------------------- log handling

// Round attribution: jackpot Payout(n) closes round n; trades after belong to n+1.
let currentRound = 1;

const blockTimestamps = new Map<bigint, number>();
async function blockTimestamp(blockNumber: bigint): Promise<number> {
  const cached = blockTimestamps.get(blockNumber);
  if (cached !== undefined) return cached;

  // The WS stream can notify about a block before the (possibly different,
  // slower-syncing) HTTP node behind RPC_URL has indexed it yet — a few
  // short retries rides out that lag instead of crashing the whole process
  // on an uncaught BlockNotFoundError.
  let block;
  for (let attempt = 0; ; attempt++) {
    try {
      block = await httpClient.getBlock({ blockNumber });
      break;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }

  const ts = Number(block.timestamp);
  blockTimestamps.set(blockNumber, ts);
  if (blockTimestamps.size > 1000) {
    blockTimestamps.delete(blockTimestamps.keys().next().value!);
  }
  return ts;
}

interface Decoded {
  name: string;
  args: Record<string, unknown>;
  log: Log<bigint, number, false>;
}

function decode(log: Log<bigint, number, false>): Decoded | null {
  const entry = eventBySelector.get(log.topics[0] ?? "");
  if (!entry) return null;
  // Portal emits for every Flap token; only ours matters. Transfer must be from
  // the token contract itself.
  const source = (log.address as string).toLowerCase();
  if (entry.name.startsWith("portal:") && source !== PORTAL.toLowerCase()) return null;
  if (entry.name.startsWith("jackpot:") && source !== JACKPOT) return null;
  if (entry.name === "token:Transfer" && source !== TOKEN) return null;
  try {
    const { args } = decodeEventLog({ abi: [entry.abi], data: log.data, topics: log.topics });
    return { name: entry.name, args: args as Record<string, unknown>, log };
  } catch {
    return null;
  }
}

/**
 * Resolve who actually ends up holding (or gave up) the token in a trade's
 * transaction, from the token's own Transfer trail rather than trusting
 * Portal's reported buyer/seller directly. Aggregators/routers (GMGN, etc.)
 * often call Portal themselves and forward tokens on to the real trader
 * within the same transaction — the LAST Transfer of the token in that tx is
 * the one that's actually verifiable on-chain as "who holds it now."
 *
 * Checks the current decoded batch first (cheap, and always sufficient for
 * backfill, which pulls a whole block range's logs together). Live batches
 * over a WS subscription often deliver one log per push rather than
 * grouping a tx's logs together, so this falls back to fetching the
 * transaction receipt directly — which always has all of that tx's logs —
 * before giving up and using Portal's reported address.
 */
async function resolveRealTrader(
  decoded: Decoded[],
  txHash: `0x${string}`,
  isBuy: boolean,
  fallback: string,
): Promise<string> {
  const field = isBuy ? "to" : "from";
  const inBatch = decoded.filter((x) => x.name === "token:Transfer" && x.log.transactionHash === txHash);
  if (inBatch.length > 0) {
    const last = inBatch.reduce((a, b) => (b.log.logIndex > a.log.logIndex ? b : a));
    return ((last.args[field] as string) ?? fallback).toLowerCase();
  }

  try {
    const receipt = await httpClient.getTransactionReceipt({ hash: txHash });
    const transferSelector = toEventSelector(transferEvent);
    const transfers = receipt.logs.filter(
      (l) => l.address.toLowerCase() === TOKEN && l.topics[0] === transferSelector,
    );
    if (transfers.length === 0) return fallback.toLowerCase();
    const last = transfers.reduce((a, b) => (b.logIndex > a.logIndex ? b : a));
    const { args } = decodeEventLog({ abi: [transferEvent], data: last.data, topics: last.topics });
    return ((args as Record<string, unknown>)[field] as string)?.toLowerCase() ?? fallback.toLowerCase();
  } catch {
    return fallback.toLowerCase();
  }
}

/**
 * Process one batch of logs (already ordered by block/logIndex). The trader
 * credited for a buy/sell is resolved via resolveRealTrader, not taken
 * directly from Portal's buyer/seller field.
 */
async function handleLogs(rawLogs: Log<bigint, number, false>[], live: boolean) {
  const decoded = rawLogs.map(decode).filter((d): d is Decoded => d !== null);

  for (const d of decoded) {
    const ts = await blockTimestamp(d.log.blockNumber);

    switch (d.name) {
      case "portal:TokenBought":
      case "portal:TokenSold": {
        if ((d.args.token as string).toLowerCase() !== TOKEN) break;
        const isBuy = d.name === "portal:TokenBought";
        const price = d.args.postPrice as bigint;
        const reported = (isBuy ? d.args.buyer : d.args.seller) as string;
        const ethAmount = d.args.eth as bigint;
        const qualified = isBuy ? buyQualified(ethAmount) : null;
        const trade: TradeRow = {
          block_number: Number(d.log.blockNumber),
          log_index: d.log.logIndex,
          tx_hash: d.log.transactionHash,
          timestamp: ts,
          round_id: currentRound,
          trader: await resolveRealTrader(decoded, d.log.transactionHash, isBuy, reported),
          kind: isBuy ? "buy" : "sell",
          eth_amount: ethAmount.toString(),
          token_amount: (d.args.amount as bigint).toString(),
          price: price.toString(),
          market_cap: (price * ONE_BILLION).toString(),
          qualified,
        };
        store.insertTrade(trade);
        if (live) broadcast({ type: "trade", trade });
        break;
      }

      case "jackpot:Payout": {
        const roundId = Number(d.args.roundId as bigint);
        const payout: PayoutRow = {
          round_id: roundId,
          winner: (d.args.winner as string).toLowerCase(),
          amount: (d.args.amount as bigint).toString(),
          block_number: Number(d.log.blockNumber),
          tx_hash: d.log.transactionHash,
          timestamp: ts,
        };
        store.insertPayout(payout);
        currentRound = roundId + 1;
        if (live) broadcast({ type: "payout", payout });
        break;
      }

      case "jackpot:LotteryDrawn": {
        const lotteryPayout: LotteryPayoutRow = {
          lottery_round_id: Number(d.args.lotteryRoundId as bigint),
          winner: (d.args.winner as string).toLowerCase(),
          amount: (d.args.amount as bigint).toString(),
          randomness: d.args.randomness as string,
          block_number: Number(d.log.blockNumber),
          tx_hash: d.log.transactionHash,
          timestamp: ts,
        };
        store.insertLotteryPayout(lotteryPayout);
        if (live) broadcast({ type: "lotteryPayout", payout: lotteryPayout });
        break;
      }

      case "token:Transfer": {
        store.applyTransfer(
          (d.args.from as string).toLowerCase(),
          (d.args.to as string).toLowerCase(),
          (d.args.value as bigint).toString()
        );
        break;
      }

      // jackpot BuyRecorded / PotFunded / LotteryCommitted / LotteryRevealed /
      // *Cancelled / queued / claimed surface through the periodic state
      // refresh (lastBuyer, deadline, pot, lottery phase are read from chain).
    }
  }
}

async function afterLiveBatch() {
  try {
    const state = await refreshChainState();
    broadcast({
      type: "state",
      state,
      leaderboard: store.roundLeaderboard(state.roundId),
      hourlyVolume: store.hourlyVolume(Math.floor(Date.now() / 1000)),
    });
  } catch (err) {
    console.error("state refresh failed:", err);
  }
}

// ---------------------------------------------------------------- backfill + watch

async function backfill(): Promise<void> {
  const lastProcessed = store.getMeta("last_block");
  let from = lastProcessed ? BigInt(lastProcessed) + 1n : START_BLOCK;
  const head = await httpClient.getBlockNumber();

  const payouts = store.recentPayouts(1);
  if (payouts.length > 0) currentRound = payouts[0].round_id + 1;

  console.log(`Backfilling logs from block ${from} to ${head}...`);
  while (from <= head) {
    const to = from + BACKFILL_CHUNK - 1n > head ? head : from + BACKFILL_CHUNK - 1n;
    const logs = await httpClient.getLogs({
      address: watchedAddresses,
      events: watchedEventAbis,
      fromBlock: from,
      toBlock: to,
    });
    await handleLogs(logs as Log<bigint, number, false>[], false);
    store.setMeta("last_block", to.toString());
    from = to + 1n;
  }
  console.log(`Backfill complete. Current round: ${currentRound}`);
}

function watch() {
  streamClient.watchEvent({
    address: watchedAddresses,
    events: watchedEventAbis,
    onLogs: async (logs) => {
      await handleLogs(logs as Log<bigint, number, false>[], true);
      const last = logs[logs.length - 1];
      if (last) store.setMeta("last_block", last.blockNumber.toString());
      await afterLiveBatch();
    },
    onError: (err) => console.error("event stream error:", err),
  });
  console.log(`Watching portal=${PORTAL} token=${TOKEN} jackpot=${JACKPOT} via ${WS_RPC_URL ? "websocket" : "http polling"}`);
}

// ---------------------------------------------------------------- main

async function main() {
  // A transient RPC failure here (rate limit, node hiccup) must not crash
  // the whole process — that's what turned one rate-limit response into a
  // crash-restart-crash loop, since a fresh process immediately retries the
  // same call into the same still-active rate limit window. The periodic
  // poll below will pick chainState up as soon as the RPC recovers.
  try {
    await refreshChainState();
  } catch (err) {
    console.error("initial state fetch failed, will retry on next poll:", err);
  }

  // Live tracking + periodic broadcasts start immediately — they must NOT
  // wait on backfill. On a fast chain a large backlog can take minutes to
  // process, and the old code awaited backfill() before calling watch() or
  // registering the state-poll interval, which left the UI frozen (zero
  // broadcasts of any kind) for the entire catch-up. trades/payouts are
  // deduped by primary key (INSERT OR IGNORE), so any overlap between
  // backfill's tail and watch()'s start is harmless.
  watch();
  setInterval(async () => {
    try {
      const state = await refreshChainState();
      broadcast({ type: "state", state });
    } catch (err) {
      console.error("state poll failed:", err);
    }
  }, STATE_POLL_MS);

  // Historical backfill fills in past trades/leaderboard in the background.
  backfill()
    .then(() => refreshChainState()) // holders now reflect backfilled transfers
    .catch((err) => console.error("backfill failed:", err));

  console.log(`Indexer websocket listening on ws://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
