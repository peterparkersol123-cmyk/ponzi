// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20Minimal} from "./interfaces/IFlapPortal.sol";

/// @title FlapJackpot — dual-pot "last buyer" + holder lottery game for a Flap-launched token
///
/// The token lives on Flap's Portal (bonding curve, later DEX). This contract adds
/// two games on top, both driven entirely by real trading of the token — buyers
/// never touch this contract and never connect to any dapp.
///
/// POT FUNDING — the token is launched as a Flap Tax Token V3 with this contract as
/// the sole tax beneficiary. Every trade anywhere (flap.sh, bots, DEX) pays the
/// token's tax, which Flap's TaxProcessor pushes here as native ETH. Incoming ETH
/// splits three ways: LAST_BUYER_SHARE_BPS to `prizePool`, LOTTERY_SHARE_BPS to
/// `lotteryPool`, the remainder to `opsAccrued`.
///
/// GAME 1 — LAST BUYER (`prizePool`): Flap's Portal never calls this contract, so a
/// trusted off-chain `keeper` watches the Portal's TokenBought events and calls
/// {recordBuy} with the latest buyer. That sets `lastBuyer` and pushes `deadline` to
/// now + ROUND_EXTENSION. When the deadline passes, {settle} (permissionless) pays
/// HALF of `prizePool` to the last buyer — the other half stays as the next round's
/// starting seed, so a round never opens at zero.
///
/// GAME 2 — HOLDER LOTTERY (`lotteryPool`): every LOTTERY_INTERVAL, the keeper runs a
/// three-step commit/reveal/declare cycle. {commitLottery} locks in a hash of a
/// secret before the outcome is knowable to anyone. {revealLottery} later reveals
/// that secret (verified on-chain against the commitment) and finalizes randomness
/// by mixing it with the reveal transaction's own prior blockhash — unknowable to
/// the keeper before submitting, so it can't cherry-pick a favorable secret ahead
/// of time. {declareLotteryWinner} then names the winner for that now-fixed,
/// public randomness and pays out. Winner selection itself (weighting entries by
/// token balance) happens off-chain — this contract does not control the token
/// contract and cannot enumerate holders on-chain — but because the randomness is
/// already public and fixed by the time a winner is declared, that mapping is
/// independently reproducible and auditable by anyone against the indexer's
/// balance history, even though it isn't cryptographically enforced here. The
/// contract does enforce that the named winner currently holds the token, exactly
/// like {recordBuy}.
///
/// TRUST MODEL — the keeper is a REFEREE, not a treasurer: recordBuy and the three
/// lottery steps are its only privileged calls, and none of them can move funds
/// anywhere except a named winner who must actually hold the token. There is no
/// owner. Funds can only ever flow to a round/draw winner, the immutable ops
/// address, and (via pull) a winner whose push payout failed.
contract FlapJackpot is ReentrancyGuard {
    // ---------------------------------------------------------------- constants

    uint256 public constant ROUND_EXTENSION = 180; // seconds added per recorded buy (3 min)
    uint256 public constant LOTTERY_INTERVAL = 600; // min seconds between lottery draws (10 min)
    /// @dev If the keeper commits and then goes dark, anyone can clear the stuck
    ///      commitment this long after it became revealable, so the lottery can
    ///      resume with a fresh commit. No funds are at risk while stuck — the
    ///      pool just keeps accruing.
    uint256 public constant COMMITMENT_TIMEOUT = 3600; // 1 hour past due

    uint256 public constant LAST_BUYER_SHARE_BPS = 3750; // half of the old 75% pot share
    uint256 public constant LOTTERY_SHARE_BPS = 3750; // the other half
    uint256 public constant BPS_DENOMINATOR = 10_000; // remainder (2500 bps) -> ops

    /// Gas forwarded to a winner during payout; failures queue for pull.
    uint256 public constant PAYOUT_GAS = 100_000;

    // ---------------------------------------------------------------- immutables

    IERC20Minimal public immutable token;
    /// @notice Off-chain referee allowed to record buys and run the lottery. Cannot
    ///         move any funds itself.
    address public immutable keeper;
    /// @notice Sole destination of the ops share. Set once at deploy.
    address public immutable opsAddress;

    // ---------------------------------------------------------------- state — last buyer

    uint256 public prizePool;
    uint256 public opsAccrued;
    /// @notice Payouts whose push transfer failed, claimable via withdrawPayout().
    mapping(address => uint256) public pendingPayouts;
    /// @notice Sum of all queued payouts (part of the solvency accounting).
    uint256 public totalPendingPayouts;

    /// @notice Timestamp after which the round is settleable. 0 = round not started.
    uint256 public deadline;
    /// @notice Winner-elect of the current round; zero until the round's first buy.
    address public lastBuyer;
    uint256 public roundId;

    // ---------------------------------------------------------------- state — lottery

    uint256 public lotteryPool;
    uint256 public lotteryRoundId = 1;
    /// @notice Hash of the keeper's committed secret. Zero when no draw is pending.
    bytes32 public lotteryCommitment;
    /// @notice When the current commitment was made; reveal is only valid after
    ///         LOTTERY_INTERVAL has passed since this timestamp.
    uint256 public lotteryCommitTime;
    /// @notice Finalized randomness from the most recent reveal, awaiting a winner
    ///         declaration. Zero when there's nothing pending. Split from reveal
    ///         into its own step because the randomness mixes in the reveal
    ///         transaction's own blockhash — unknowable until that transaction is
    ///         mined, so the winner can only be computed (off-chain, from this
    ///         now-fixed-and-public value) *after* reveal completes, not within it.
    bytes32 public lotteryRandomness;
    /// @notice When lotteryRandomness was finalized; used only by the stale-draw
    ///         recovery valve below.
    uint256 public lotteryRevealTime;

    // ---------------------------------------------------------------- events

    event BuyRecorded(address indexed buyer, uint256 newDeadline, uint256 indexed roundId);
    event Payout(uint256 indexed roundId, address indexed winner, uint256 amount);
    event PotFunded(uint256 amount, uint256 toPrizePool, uint256 toLottery, uint256 toOps);
    event PayoutQueued(address indexed winner, uint256 amount);
    event PayoutClaimed(address indexed winner, uint256 amount);
    event OpsWithdrawn(uint256 amount);
    event LotteryCommitted(bytes32 commitment, uint256 commitTime);
    event LotteryCommitmentCancelled(bytes32 commitment);
    event LotteryRevealed(bytes32 randomness);
    event LotteryRandomnessCancelled(bytes32 randomness);
    event LotteryDrawn(uint256 indexed lotteryRoundId, address indexed winner, uint256 amount, bytes32 randomness);

    // ---------------------------------------------------------------- errors

    error ZeroAmount();
    error NotKeeper();
    error NotAHolder();
    error NothingToSettle();
    error TransferFailed();
    error CommitmentPending();
    error NoCommitmentPending();
    error RandomnessPending();
    error NoRandomnessPending();
    error NotYetDue();
    error BadReveal();

    constructor(address token_, address keeper_, address opsAddress_) {
        require(token_ != address(0) && keeper_ != address(0) && opsAddress_ != address(0), "bad params");
        token = IERC20Minimal(token_);
        keeper = keeper_;
        opsAddress = opsAddress_;
        roundId = 1;
    }

    // ---------------------------------------------------------------- pot funding

    /// @dev Tax revenue pushed by Flap's TaxProcessor (or anyone topping up the pot)
    ///      lands here and splits three ways: last-buyer pool, lottery pool, ops.
    receive() external payable {
        if (msg.value == 0) return;
        uint256 toPrizePool = (msg.value * LAST_BUYER_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toLottery = (msg.value * LOTTERY_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toOps = msg.value - toPrizePool - toLottery; // remainder absorbs rounding dust
        prizePool += toPrizePool;
        lotteryPool += toLottery;
        opsAccrued += toOps;
        emit PotFunded(msg.value, toPrizePool, toLottery, toOps);
    }

    // ---------------------------------------------------------------- game 1: the clock

    /// @notice Keeper-only: record the latest real buyer of the token and reset the
    ///         countdown. This is the only privileged call, and it moves no funds.
    /// @param buyer The address that just bought the token on Flap. Must hold a
    ///        non-zero balance, so a rogue keeper cannot name a non-participant.
    function recordBuy(address buyer) external nonReentrant {
        if (msg.sender != keeper) revert NotKeeper();
        if (buyer == address(0)) revert ZeroAmount();
        if (token.balanceOf(buyer) == 0) revert NotAHolder();

        // A buy recorded after the deadline must not hijack the expired round's pot:
        // settle the previous winner first, then start the fresh round with this buy.
        _settleIfExpired();

        lastBuyer = buyer;
        deadline = block.timestamp + ROUND_EXTENSION;
        emit BuyRecorded(buyer, deadline, roundId);
    }

    /// @notice Permissionless settlement of an expired round.
    function settle() external nonReentrant {
        if (!_settleIfExpired()) revert NothingToSettle();
    }

    /// @dev Pays out HALF of the current prizePool — the other half stays as the
    ///      next round's seed, so a fresh round never opens at zero. Effects
    ///      strictly before the external payout call; failing payouts are queued
    ///      so no winner can block recording or settlement.
    function _settleIfExpired() internal returns (bool settled) {
        if (lastBuyer == address(0) || block.timestamp <= deadline) return false;

        address winner = lastBuyer;
        uint256 amount = prizePool / 2;
        uint256 endedRound = roundId;

        prizePool -= amount;
        lastBuyer = address(0);
        deadline = 0;
        roundId = endedRound + 1;

        emit Payout(endedRound, winner, amount);
        _payout(winner, amount);
        return true;
    }

    // ---------------------------------------------------------------- game 2: the lottery

    /// @notice Keeper-only: lock in a hash of a secret ahead of the draw, before the
    ///         outcome is knowable to anyone (including the keeper — the secret is
    ///         just a random value chosen before commitment; its resulting
    ///         randomness isn't finalized until reveal, and the winner it maps to
    ///         isn't declared until the separate step after that).
    function commitLottery(bytes32 commitment) external {
        if (msg.sender != keeper) revert NotKeeper();
        if (lotteryCommitment != bytes32(0)) revert CommitmentPending();
        if (lotteryRandomness != bytes32(0)) revert RandomnessPending();
        if (commitment == bytes32(0)) revert ZeroAmount();
        lotteryCommitment = commitment;
        lotteryCommitTime = block.timestamp;
        emit LotteryCommitted(commitment, block.timestamp);
    }

    /// @notice Keeper-only: reveal the committed secret. Verified against the
    ///         earlier commitment on-chain. Finalizes randomness by mixing the
    ///         secret with this transaction's own prior blockhash — unknowable to
    ///         the keeper before submitting, so it can't be cherry-picked by
    ///         trying secrets off-chain ahead of time. This step does NOT declare
    ///         a winner or pay out; {declareLotteryWinner} does that once the
    ///         randomness above is public and fixed.
    function revealLottery(bytes32 secret) external {
        if (msg.sender != keeper) revert NotKeeper();
        if (lotteryCommitment == bytes32(0)) revert NoCommitmentPending();
        if (keccak256(abi.encodePacked(secret)) != lotteryCommitment) revert BadReveal();
        if (block.timestamp < lotteryCommitTime + LOTTERY_INTERVAL) revert NotYetDue();

        bytes32 randomness = keccak256(abi.encodePacked(secret, blockhash(block.number - 1)));
        lotteryCommitment = bytes32(0);
        lotteryCommitTime = 0;
        lotteryRandomness = randomness;
        lotteryRevealTime = block.timestamp;
        emit LotteryRevealed(randomness);
    }

    /// @notice Keeper-only: name the winner for the most recently finalized
    ///         randomness and pay out the full lottery pool to them. The mapping
    ///         from randomness to winner (weighted by token balance) is computed
    ///         off-chain — this contract doesn't control the token contract and
    ///         can't enumerate holders — but by this point the randomness is
    ///         already public and fixed, so that mapping is independently
    ///         reproducible and auditable by anyone against the indexer's balance
    ///         history. On-chain, this only enforces that the named winner
    ///         actually holds the token right now, same as {recordBuy}.
    function declareLotteryWinner(address winner) external nonReentrant {
        if (msg.sender != keeper) revert NotKeeper();
        if (lotteryRandomness == bytes32(0)) revert NoRandomnessPending();
        if (winner == address(0) || token.balanceOf(winner) == 0) revert NotAHolder();

        bytes32 randomness = lotteryRandomness;
        uint256 amount = lotteryPool;
        uint256 drawnRound = lotteryRoundId;

        lotteryPool = 0;
        lotteryRandomness = bytes32(0);
        lotteryRevealTime = 0;
        lotteryRoundId = drawnRound + 1;

        emit LotteryDrawn(drawnRound, winner, amount, randomness);
        _payout(winner, amount);
    }

    /// @notice Permissionless recovery: if the keeper commits and never reveals
    ///         (goes offline, loses the secret, etc.), anyone can clear the stuck
    ///         commitment once it's well past due, freeing the keeper to commit
    ///         again. No funds move here — lotteryPool is untouched.
    function cancelStaleLotteryCommitment() external {
        if (lotteryCommitment == bytes32(0)) revert NoCommitmentPending();
        if (block.timestamp < lotteryCommitTime + LOTTERY_INTERVAL + COMMITMENT_TIMEOUT) revert NotYetDue();
        bytes32 stale = lotteryCommitment;
        lotteryCommitment = bytes32(0);
        lotteryCommitTime = 0;
        emit LotteryCommitmentCancelled(stale);
    }

    /// @notice Permissionless recovery: if the keeper reveals but never declares a
    ///         winner (crashes mid-cycle, etc.), anyone can clear the stuck
    ///         randomness once it's well past due, freeing the keeper to commit a
    ///         fresh cycle. No funds move here — lotteryPool is untouched.
    function cancelStaleLotteryRandomness() external {
        if (lotteryRandomness == bytes32(0)) revert NoRandomnessPending();
        if (block.timestamp < lotteryRevealTime + COMMITMENT_TIMEOUT) revert NotYetDue();
        bytes32 stale = lotteryRandomness;
        lotteryRandomness = bytes32(0);
        lotteryRevealTime = 0;
        emit LotteryRandomnessCancelled(stale);
    }

    // ---------------------------------------------------------------- shared payout helpers

    /// @dev Push-with-fallback-to-pull, shared by both games' payouts.
    function _payout(address winner, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = winner.call{value: amount, gas: PAYOUT_GAS}("");
        if (!ok) {
            pendingPayouts[winner] += amount;
            totalPendingPayouts += amount;
            emit PayoutQueued(winner, amount);
        }
    }

    /// @notice Claim a payout that could not be pushed at settlement/draw time.
    function withdrawPayout() external nonReentrant {
        uint256 amount = pendingPayouts[msg.sender];
        if (amount == 0) revert ZeroAmount();
        pendingPayouts[msg.sender] = 0;
        totalPendingPayouts -= amount;
        emit PayoutClaimed(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Push accrued ops fees to the immutable ops address. Callable by anyone.
    function withdrawOps() external nonReentrant {
        uint256 amount = opsAccrued;
        if (amount == 0) revert ZeroAmount();
        opsAccrued = 0;
        emit OpsWithdrawn(amount);
        (bool ok,) = opsAddress.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------- views

    /// @notice Seconds until the current last-buyer round can be settled (0 if
    ///         expired/unstarted).
    function timeRemaining() external view returns (uint256) {
        if (deadline <= block.timestamp) return 0;
        return deadline - block.timestamp;
    }

    /// @notice Seconds until a pending lottery commitment becomes revealable (0 if
    ///         already due, or no commitment pending).
    function lotteryTimeRemaining() external view returns (uint256) {
        if (lotteryCommitment == bytes32(0)) return 0;
        uint256 due = lotteryCommitTime + LOTTERY_INTERVAL;
        if (due <= block.timestamp) return 0;
        return due - block.timestamp;
    }
}
