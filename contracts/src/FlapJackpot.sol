// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20Minimal} from "./interfaces/IFlapPortal.sol";

/// @title FlapJackpot — "last buyer wins" jackpot companion for a Flap-launched token
///
/// The token lives on Flap's Portal (bonding curve, later DEX). This contract adds
/// the jackpot game on top, driven entirely by real trading of the token — buyers
/// never touch this contract and never connect to any dapp.
///
/// POT FUNDING — the token is launched as a Flap Tax Token V3 with this contract as
/// the sole tax beneficiary. Every trade anywhere (flap.sh, bots, DEX) pays the
/// token's tax, which Flap's TaxProcessor pushes here as native ETH. Incoming ETH is
/// split POOL_SHARE_BPS into `prizePool`, the rest into `opsAccrued`.
///
/// THE CLOCK — Flap's Portal never calls this contract, so a trusted off-chain
/// `keeper` watches the Portal's TokenBought events and calls {recordBuy} with the
/// latest buyer. That sets `lastBuyer` and pushes `deadline` to now + ROUND_EXTENSION.
/// The keeper is a REFEREE, not a treasurer: its only power is naming the current
/// last buyer. It can never move the pot, the ops funds, or change the split — every
/// recordBuy is publicly auditable against the matching on-chain buy, and the named
/// buyer must actually hold the token.
///
/// SETTLEMENT — when the deadline passes, {settle} (permissionless) pays the pool to
/// the last buyer and the next round opens on the next recorded buy. The keeper
/// settles automatically, but anyone — including the winner — can trigger it.
///
/// There is no owner. Funds can only ever flow to the round winner, the immutable
/// ops address, and (via pull) a winner whose push payout failed.
contract FlapJackpot is ReentrancyGuard {
    // ---------------------------------------------------------------- constants

    uint256 public constant ROUND_EXTENSION = 60; // seconds added per recorded buy
    uint256 public constant POOL_SHARE_BPS = 7500; // share of incoming tax to the pot
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// Gas forwarded to the winner during settlement; failures queue for pull.
    uint256 public constant PAYOUT_GAS = 100_000;

    // ---------------------------------------------------------------- immutables

    IERC20Minimal public immutable token;
    /// @notice Off-chain referee allowed to record buys. Cannot move any funds.
    address public immutable keeper;
    /// @notice Sole destination of the ops share. Set once at deploy.
    address public immutable opsAddress;

    // ---------------------------------------------------------------- state

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

    // ---------------------------------------------------------------- events

    event BuyRecorded(address indexed buyer, uint256 newDeadline, uint256 indexed roundId);
    event Payout(uint256 indexed roundId, address indexed winner, uint256 amount);
    event PotFunded(uint256 amount, uint256 toPool, uint256 toOps);
    event PayoutQueued(address indexed winner, uint256 amount);
    event PayoutClaimed(address indexed winner, uint256 amount);
    event OpsWithdrawn(uint256 amount);

    // ---------------------------------------------------------------- errors

    error ZeroAmount();
    error NotKeeper();
    error NotAHolder();
    error NothingToSettle();
    error TransferFailed();

    constructor(address token_, address keeper_, address opsAddress_) {
        require(token_ != address(0) && keeper_ != address(0) && opsAddress_ != address(0), "bad params");
        token = IERC20Minimal(token_);
        keeper = keeper_;
        opsAddress = opsAddress_;
        roundId = 1;
    }

    // ---------------------------------------------------------------- pot funding

    /// @dev Tax revenue pushed by Flap's TaxProcessor (or anyone topping up the pot)
    ///      lands here and is split pot/ops.
    receive() external payable {
        if (msg.value == 0) return;
        uint256 toPool = (msg.value * POOL_SHARE_BPS) / BPS_DENOMINATOR;
        prizePool += toPool;
        opsAccrued += msg.value - toPool;
        emit PotFunded(msg.value, toPool, msg.value - toPool);
    }

    // ---------------------------------------------------------------- the clock

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

    // ---------------------------------------------------------------- settlement

    /// @notice Permissionless settlement of an expired round.
    function settle() external nonReentrant {
        if (!_settleIfExpired()) revert NothingToSettle();
    }

    /// @dev Effects strictly before the external payout call; failing payouts are
    ///      queued so no winner can block recording or settlement.
    function _settleIfExpired() internal returns (bool settled) {
        if (lastBuyer == address(0) || block.timestamp <= deadline) return false;

        address winner = lastBuyer;
        uint256 amount = prizePool;
        uint256 endedRound = roundId;

        prizePool = 0;
        lastBuyer = address(0);
        deadline = 0;
        roundId = endedRound + 1;

        emit Payout(endedRound, winner, amount);

        if (amount > 0) {
            (bool ok,) = winner.call{value: amount, gas: PAYOUT_GAS}("");
            if (!ok) {
                pendingPayouts[winner] += amount;
                totalPendingPayouts += amount;
                emit PayoutQueued(winner, amount);
            }
        }
        return true;
    }

    /// @notice Claim a payout that could not be pushed at settlement time.
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

    /// @notice Seconds until the current round can be settled (0 if expired/unstarted).
    function timeRemaining() external view returns (uint256) {
        if (deadline <= block.timestamp) return 0;
        return deadline - block.timestamp;
    }
}
