import { DatabaseSync } from "node:sqlite";

// Wei values are stored as TEXT: sqlite integers are 64-bit but JS numbers lose
// precision past 2^53, so amounts round-trip as decimal strings and are summed
// with BigInt in the queries below.
export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      round_id INTEGER NOT NULL,
      trader TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('buy','sell')),
      eth_amount TEXT NOT NULL,
      token_amount TEXT NOT NULL,
      price TEXT NOT NULL,
      market_cap TEXT NOT NULL,
      PRIMARY KEY (block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_trades_time ON trades (timestamp);
    CREATE INDEX IF NOT EXISTS idx_trades_round ON trades (round_id, kind);

    CREATE TABLE IF NOT EXISTS balances (
      address TEXT PRIMARY KEY,
      balance TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payouts (
      round_id INTEGER PRIMARY KEY,
      winner TEXT NOT NULL,
      amount TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export interface TradeRow {
  block_number: number;
  log_index: number;
  tx_hash: string;
  timestamp: number;
  round_id: number;
  trader: string;
  kind: "buy" | "sell";
  eth_amount: string;
  token_amount: string;
  price: string;
  market_cap: string;
}

export interface PayoutRow {
  round_id: number;
  winner: string;
  amount: string;
  block_number: number;
  tx_hash: string;
  timestamp: number;
}

export class Store {
  constructor(private db: DatabaseSync) {}

  insertTrade(t: TradeRow) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO trades
         (block_number, log_index, tx_hash, timestamp, round_id, trader, kind, eth_amount, token_amount, price, market_cap)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        t.block_number,
        t.log_index,
        t.tx_hash,
        t.timestamp,
        t.round_id,
        t.trader,
        t.kind,
        t.eth_amount,
        t.token_amount,
        t.price,
        t.market_cap
      );
  }

  insertPayout(p: PayoutRow) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO payouts (round_id, winner, amount, block_number, tx_hash, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(p.round_id, p.winner, p.amount, p.block_number, p.tx_hash, p.timestamp);
  }

  recentTrades(limit = 50): TradeRow[] {
    return this.db
      .prepare(`SELECT * FROM trades ORDER BY block_number DESC, log_index DESC LIMIT ?`)
      .all(limit) as unknown as TradeRow[];
  }

  recentPayouts(limit = 20): PayoutRow[] {
    return this.db.prepare(`SELECT * FROM payouts ORDER BY round_id DESC LIMIT ?`).all(limit) as unknown as PayoutRow[];
  }

  /** Per-wallet buy aggregation for one round (the live leaderboard). */
  roundLeaderboard(roundId: number, limit = 20) {
    // Sum wei per trader with BigInt (SQL SUM would go through floats).
    const rows = this.db
      .prepare(`SELECT trader, eth_amount FROM trades WHERE round_id = ? AND kind = 'buy'`)
      .all(roundId) as unknown as { trader: string; eth_amount: string }[];
    const agg = new Map<string, { buys: number; ethIn: bigint }>();
    for (const r of rows) {
      const cur = agg.get(r.trader) ?? { buys: 0, ethIn: 0n };
      cur.buys += 1;
      cur.ethIn += BigInt(r.eth_amount);
      agg.set(r.trader, cur);
    }
    return [...agg.entries()]
      .map(([trader, v]) => ({ trader, buys: v.buys, ethIn: v.ethIn.toString() }))
      .sort((a, b) => (BigInt(b.ethIn) > BigInt(a.ethIn) ? 1 : -1))
      .slice(0, limit);
  }

  /** Total ETH traded (buys + sells) in the trailing hour, as a wei string. */
  hourlyVolume(nowSec: number): string {
    const rows = this.db
      .prepare(`SELECT eth_amount FROM trades WHERE timestamp > ?`)
      .all(nowSec - 3600) as unknown as { eth_amount: string }[];
    return rows.reduce((acc, r) => acc + BigInt(r.eth_amount), 0n).toString();
  }

  /** Apply a token Transfer to the balances table (mint = from zero address). */
  applyTransfer(from: string, to: string, value: string) {
    const zero = "0x0000000000000000000000000000000000000000";
    const get = this.db.prepare(`SELECT balance FROM balances WHERE address = ?`);
    const put = this.db.prepare(
      `INSERT INTO balances (address, balance) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET balance = excluded.balance`
    );
    const v = BigInt(value);
    if (v === 0n) return;
    if (from !== zero) {
      const cur = BigInt(((get.get(from) as { balance: string } | undefined) ?? { balance: "0" }).balance);
      put.run(from, (cur - v).toString());
    }
    if (to !== zero) {
      const cur = BigInt(((get.get(to) as { balance: string } | undefined) ?? { balance: "0" }).balance);
      put.run(to, (cur + v).toString());
    }
  }

  /** Addresses with a non-zero balance (excluding the given system addresses). */
  holdersCount(exclude: string[]): number {
    const rows = this.db.prepare(`SELECT address, balance FROM balances`).all() as unknown as {
      address: string;
      balance: string;
    }[];
    const ex = new Set(exclude.map((a) => a.toLowerCase()));
    return rows.filter((r) => !ex.has(r.address.toLowerCase()) && BigInt(r.balance) > 0n).length;
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }
}
