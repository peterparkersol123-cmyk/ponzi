import {
  createPublicClient,
  decodeEventLog,
  http,
  toEventSelector,
  webSocket,
  type AbiEvent,
  type Log,
  type PublicClient,
} from "viem";
import { WebSocketServer, WebSocket } from "ws";
import { jackpotEvents, jackpotReadsAbi, portalEvents, portalReadsAbi, transferEvent } from "./abi.js";
import { openDb, Store, type TradeRow, type PayoutRow } from "./db.js";

// ---------------------------------------------------------------- config

const RPC_URL = required("RPC_URL");
const WS_RPC_URL = process.env.WS_RPC_URL; // optional but recommended for prod
const PORTAL = (process.env.PORTAL_ADDRESS ?? "0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09") as `0x${string}`;
const TOKEN = required("TOKEN_ADDRESS").toLowerCase() as `0x${string}`;
const JACKPOT = required("JACKPOT_ADDRESS").toLowerCase() as `0x${string}`;
const START_BLOCK = BigInt(process.env.START_BLOCK ?? "0");
const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? "./jackpot.db";
const BACKFILL_CHUNK = 5_000n;
const STATE_POLL_MS = 3_000;

const ONE_BILLION = 1_000_000_000n; // Flap tokens: fixed 1B max supply

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name} (see .env.example)`);
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------- chain clients

const httpClient = createPublicClient({ transport: http(RPC_URL) });
const streamClient: PublicClient = WS_RPC_URL
  ? createPublicClient({ transport: webSocket(WS_RPC_URL) })
  : httpClient;

const store = new Store(openDb(DB_PATH));

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
}

let chainState: ChainState | null = null;

// ---------------------------------------------------------------- ETH/USD price
// Native token is ETH, so USD display needs an external price feed. Refreshed
// on its own slow interval (price doesn't need per-second freshness) — a
// failed fetch just keeps the last known good value instead of breaking state.

let ethUsdPrice: number | null = null;
const ETH_PRICE_POLL_MS = 60_000;

async function refreshEthUsdPrice(): Promise<void> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const json = (await res.json()) as { ethereum?: { usd?: number } };
    if (typeof json.ethereum?.usd === "number") ethUsdPrice = json.ethereum.usd;
  } catch (err) {
    console.error("eth/usd price fetch failed:", err);
  }
}

async function refreshChainState(): Promise<ChainState> {
  const j = { address: JACKPOT, abi: jackpotReadsAbi } as const;
  const [prizePool, opsAccrued, deadline, lastBuyer, roundId, tokenState] = await Promise.all([
    httpClient.readContract({ ...j, functionName: "prizePool" }),
    httpClient.readContract({ ...j, functionName: "opsAccrued" }),
    httpClient.readContract({ ...j, functionName: "deadline" }),
    httpClient.readContract({ ...j, functionName: "lastBuyer" }),
    httpClient.readContract({ ...j, functionName: "roundId" }),
    httpClient.readContract({ address: PORTAL, abi: portalReadsAbi, functionName: "getTokenV8Safe", args: [TOKEN] }),
  ]);
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
    ethUsd: ethUsdPrice,
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

// ---------------------------------------------------------------- log handling

// Round attribution: jackpot Payout(n) closes round n; trades after belong to n+1.
let currentRound = 1;

const blockTimestamps = new Map<bigint, number>();
async function blockTimestamp(blockNumber: bigint): Promise<number> {
  const cached = blockTimestamps.get(blockNumber);
  if (cached !== undefined) return cached;
  const block = await httpClient.getBlock({ blockNumber });
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
 * Falls back to Portal's reported address if no Transfer is found.
 */
function resolveRealTrader(decoded: Decoded[], txHash: string, isBuy: boolean, fallback: string): string {
  const transfers = decoded.filter((x) => x.name === "token:Transfer" && x.log.transactionHash === txHash);
  if (transfers.length === 0) return fallback.toLowerCase();
  const last = transfers.reduce((a, b) => (b.log.logIndex > a.log.logIndex ? b : a));
  const field = isBuy ? "to" : "from";
  return ((last.args[field] as string) ?? fallback).toLowerCase();
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
        const trade: TradeRow = {
          block_number: Number(d.log.blockNumber),
          log_index: d.log.logIndex,
          tx_hash: d.log.transactionHash,
          timestamp: ts,
          round_id: currentRound,
          trader: resolveRealTrader(decoded, d.log.transactionHash, isBuy, reported),
          kind: isBuy ? "buy" : "sell",
          eth_amount: (d.args.eth as bigint).toString(),
          token_amount: (d.args.amount as bigint).toString(),
          price: price.toString(),
          market_cap: (price * ONE_BILLION).toString(),
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

      case "token:Transfer": {
        store.applyTransfer(
          (d.args.from as string).toLowerCase(),
          (d.args.to as string).toLowerCase(),
          (d.args.value as bigint).toString()
        );
        break;
      }

      // jackpot BuyRecorded / PotFunded / queued / claimed surface through the
      // periodic state refresh (lastBuyer, deadline, pot are read from chain).
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
  await refreshEthUsdPrice();
  await refreshChainState();

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
  setInterval(refreshEthUsdPrice, ETH_PRICE_POLL_MS);

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
