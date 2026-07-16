import type { Log, PublicClient } from "viem";
import { transferEvent } from "./abi.js";

const ZERO = "0x0000000000000000000000000000000000000000";

type TransferLog = Log & { args: { from?: `0x${string}`; to?: `0x${string}`; value?: bigint } };

/**
 * Self-contained token-balance tracker for the lottery's weighted winner
 * selection. Deliberately independent from the indexer's own balances table
 * (which lives in a different process/service) — this keeps the keeper able
 * to run standalone, at the cost of duplicating one backfill pass over the
 * token's Transfer history. That backfill is a one-time startup cost (same
 * chunking/rate-limit precautions as the indexer's own backfill); ongoing
 * updates are event-driven, not polled, so steady-state RPC load is low.
 */
export class BalanceTracker {
  private balances = new Map<string, bigint>();
  private ready = false;

  constructor(
    /** Used for backfill (getBlockNumber/getLogs) — HTTP client by convention. */
    private readClient: PublicClient,
    /** Used for the live watchEvent subscription — WS client when available. */
    private watchClient: PublicClient,
    private token: `0x${string}`,
    private startBlock: bigint,
    private backfillChunk: bigint,
  ) {}

  async start(): Promise<void> {
    await this.backfill();
    this.watchClient.watchEvent({
      address: this.token,
      events: [transferEvent],
      onLogs: (logs) => this.apply(logs as TransferLog[]),
      onError: (err) => console.error("balance tracker stream error:", err),
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  private async backfill(): Promise<void> {
    const head = await this.readClient.getBlockNumber();
    let from = this.startBlock;
    console.log(`Balance tracker: backfilling Transfer history from block ${from} to ${head}...`);
    while (from <= head) {
      const to = from + this.backfillChunk - 1n > head ? head : from + this.backfillChunk - 1n;
      const logs = await this.readClient.getLogs({
        address: this.token,
        event: transferEvent,
        fromBlock: from,
        toBlock: to,
      });
      this.apply(logs as TransferLog[]);
      from = to + 1n;
    }
    this.ready = true;
    console.log(`Balance tracker: ready, tracking ${this.balances.size} addresses`);
  }

  private apply(logs: TransferLog[]): void {
    for (const log of logs) {
      const { from, to, value } = log.args;
      if (from == null || to == null || value == null || value === 0n) continue;
      if (from !== ZERO) {
        const f = from.toLowerCase();
        this.balances.set(f, (this.balances.get(f) ?? 0n) - value);
      }
      if (to !== ZERO) {
        const t = to.toLowerCase();
        this.balances.set(t, (this.balances.get(t) ?? 0n) + value);
      }
    }
  }

  /**
   * Deterministic, publicly reproducible weighted pick: sort eligible holders
   * (balance > 0, not in `excluded`) by address, then walk cumulative
   * balances to find who owns the randomness-derived ticket. Anyone can
   * redo this exact computation from the on-chain-emitted randomness plus
   * the token's public Transfer history — that's what makes an off-chain
   * winner selection auditable even though it isn't on-chain-enforced.
   */
  pickWinner(randomness: `0x${string}`, excluded: Set<string>): `0x${string}` | null {
    const entries = [...this.balances.entries()]
      .filter(([addr, bal]) => bal > 0n && !excluded.has(addr))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) return null;

    const total = entries.reduce((sum, [, bal]) => sum + bal, 0n);
    let ticket = BigInt(randomness) % total;
    for (const [addr, bal] of entries) {
      if (ticket < bal) return addr as `0x${string}`;
      ticket -= bal;
    }
    // Unreachable if `total` was computed correctly, but keep TypeScript (and
    // any future bug in the loop above) honest rather than returning undefined.
    return entries[entries.length - 1][0] as `0x${string}`;
  }
}
