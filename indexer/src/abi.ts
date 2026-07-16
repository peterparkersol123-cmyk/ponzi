import { parseAbi, parseAbiItem } from "viem";

// ---------------------------------------------------------------- Flap Portal
// Event shapes per https://docs.flap.sh/flap/developers (none of the params are
// indexed, so filtering by token happens client-side after decoding).

export const portalEvents = {
  TokenBought: parseAbiItem(
    "event TokenBought(uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)"
  ),
  TokenSold: parseAbiItem(
    "event TokenSold(uint256 ts, address token, address seller, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)"
  ),
  FlapTokenCirculatingSupplyChanged: parseAbiItem(
    "event FlapTokenCirculatingSupplyChanged(address token, uint256 newSupply)"
  ),
  LaunchedToDEX: parseAbiItem("event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth)"),
} as const;

// getTokenV8Safe returns enum fields as uint8 (forward-compatible) — confirmed
// live on the Robinhood deployment (Portal v5.14.15).
export const portalReadsAbi = parseAbi([
  "struct TokenStateV8Safe { uint8 status; uint256 reserve; uint256 circulatingSupply; uint256 price; uint8 tokenVersion; uint256 r; uint256 h; uint256 k; uint256 dexSupplyThresh; address quoteTokenAddress; bool nativeToQuoteSwapEnabled; bytes32 extensionID; uint256 buyTaxRate; uint256 sellTaxRate; address pool; uint256 progress; uint8 lpFeeProfile; uint8 dexId; }",
  "function getTokenV8Safe(address token) view returns (TokenStateV8Safe state)",
]);

// ---------------------------------------------------------------- FlapJackpot

export const jackpotEvents = {
  BuyRecorded: parseAbiItem("event BuyRecorded(address indexed buyer, uint256 newDeadline, uint256 indexed roundId)"),
  Payout: parseAbiItem("event Payout(uint256 indexed roundId, address indexed winner, uint256 amount)"),
  PotFunded: parseAbiItem(
    "event PotFunded(uint256 amount, uint256 toPrizePool, uint256 toLottery, uint256 toOps)"
  ),
  PayoutQueued: parseAbiItem("event PayoutQueued(address indexed winner, uint256 amount)"),
  PayoutClaimed: parseAbiItem("event PayoutClaimed(address indexed winner, uint256 amount)"),
  LotteryCommitted: parseAbiItem("event LotteryCommitted(bytes32 commitment, uint256 commitTime)"),
  LotteryCommitmentCancelled: parseAbiItem("event LotteryCommitmentCancelled(bytes32 commitment)"),
  LotteryRevealed: parseAbiItem("event LotteryRevealed(bytes32 randomness)"),
  LotteryRandomnessCancelled: parseAbiItem("event LotteryRandomnessCancelled(bytes32 randomness)"),
  LotteryDrawn: parseAbiItem(
    "event LotteryDrawn(uint256 indexed lotteryRoundId, address indexed winner, uint256 amount, bytes32 randomness)"
  ),
} as const;

export const jackpotReadsAbi = parseAbi([
  "function prizePool() view returns (uint256)",
  "function opsAccrued() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function lastBuyer() view returns (address)",
  "function roundId() view returns (uint256)",
  "function totalPendingPayouts() view returns (uint256)",
  "function lotteryPool() view returns (uint256)",
  "function lotteryRoundId() view returns (uint256)",
  "function lotteryCommitment() view returns (bytes32)",
  "function lotteryCommitTime() view returns (uint256)",
  "function lotteryRandomness() view returns (bytes32)",
  "function lotteryRevealTime() view returns (uint256)",
  "function LOTTERY_INTERVAL() view returns (uint256)",
  "function COMMITMENT_TIMEOUT() view returns (uint256)",
  "function lotteryTimeRemaining() view returns (uint256)",
]);

// Keeper (write) surface — used only by the keeper bot, which holds a funded key.
export const jackpotWritesAbi = parseAbi([
  "function recordBuy(address buyer)",
  "function settle()",
  "function deadline() view returns (uint256)",
  "function lastBuyer() view returns (address)",
  "function prizePool() view returns (uint256)",
  "function commitLottery(bytes32 commitment)",
  "function revealLottery(bytes32 secret)",
  "function declareLotteryWinner(address winner)",
  "function cancelStaleLotteryCommitment()",
  "function cancelStaleLotteryRandomness()",
  "function lotteryCommitment() view returns (bytes32)",
  "function lotteryCommitTime() view returns (uint256)",
  "function lotteryRandomness() view returns (bytes32)",
  "function lotteryRevealTime() view returns (uint256)",
  "function LOTTERY_INTERVAL() view returns (uint256)",
  "function COMMITMENT_TIMEOUT() view returns (uint256)",
]);

// ---------------------------------------------------------------- ERC20

export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);
