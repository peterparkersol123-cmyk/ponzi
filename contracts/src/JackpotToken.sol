// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

/// @title JackpotToken — linear bonding-curve token with a "last buyer wins" jackpot
///
/// Curve: price(S) = basePrice + slope * S   (S = total supply in whole tokens)
/// Buying integrates the curve upward, selling integrates it back down; the ETH
/// backing the curve is held in `reserve` and can never be withdrawn except by sells.
///
/// Jackpot: every buy takes a FEE_BPS fee off the ETH in. POOL_SHARE_BPS of that fee
/// accrues to `prizePool`, the rest to `opsAccrued`. Every buy sets the caller as
/// `lastBuyer` and pushes `deadline` to now + ROUND_EXTENSION. Once the deadline
/// passes, `settle()` (permissionless) pays the pool to the last buyer and opens the
/// next round. Sells pay the same fee but never touch the timer or lastBuyer.
///
/// There is no owner. No function can move `reserve`, `prizePool` or pending payouts
/// anywhere except to sellers, the round winner, and the immutable ops address.
contract JackpotToken is ERC20, ReentrancyGuard {
    // ---------------------------------------------------------------- constants

    uint256 public constant ROUND_EXTENSION = 60; // seconds added per buy
    uint256 public constant FEE_BPS = 200; // 2% fee on every trade
    uint256 public constant POOL_SHARE_BPS = 5000; // 50% of fee to pool, rest to ops
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// Gas forwarded to the winner during settlement. Generous for EOAs and simple
    /// receivers; bounded so a gas-griefing winner cannot make buys prohibitively
    /// expensive. If the call fails the payout is queued for pull-withdrawal.
    uint256 public constant PAYOUT_GAS = 100_000;

    // ---------------------------------------------------------------- immutables

    /// @notice Curve price at zero supply, in wei per whole (1e18) token.
    uint256 public immutable basePrice;
    /// @notice Curve price increase in wei per whole token of supply.
    uint256 public immutable slope;
    /// @notice Sole destination of the ops share of fees. Set once at deploy.
    address public immutable opsAddress;

    // ---------------------------------------------------------------- state

    /// @notice ETH backing the bonding curve. Only sells draw it down.
    uint256 public reserve;
    /// @notice Current round's accumulated jackpot.
    uint256 public prizePool;
    /// @notice Ops fee share awaiting withdrawal to `opsAddress`.
    uint256 public opsAccrued;
    /// @notice Timestamp after which the round is settleable. 0 = round not started.
    uint256 public deadline;
    /// @notice Winner-elect of the current round; zero until the round's first buy.
    address public lastBuyer;
    uint256 public roundId;
    /// @notice Number of addresses with a non-zero balance.
    uint256 public holders;
    /// @notice Payouts whose push transfer failed, claimable via withdrawPayout().
    mapping(address => uint256) public pendingPayouts;

    // ---------------------------------------------------------------- events

    event Buy(address indexed trader, uint256 ethIn, uint256 tokensOut, uint256 newPrice);
    event Sell(address indexed trader, uint256 tokensIn, uint256 ethOut, uint256 newPrice);
    event Payout(uint256 indexed roundId, address indexed winner, uint256 amount);
    event PayoutQueued(address indexed winner, uint256 amount);
    event PayoutClaimed(address indexed winner, uint256 amount);
    event OpsWithdrawn(uint256 amount);

    // ---------------------------------------------------------------- errors

    error ZeroAmount();
    error SlippageExceeded();
    error NothingToSettle();
    error TransferFailed();
    error InsufficientReserve();

    constructor(string memory name_, string memory symbol_, uint256 basePrice_, uint256 slope_, address opsAddress_)
        ERC20(name_, symbol_)
    {
        require(basePrice_ > 0 && slope_ > 0 && opsAddress_ != address(0), "bad params");
        basePrice = basePrice_;
        slope = slope_;
        opsAddress = opsAddress_;
        roundId = 1;
    }

    // ---------------------------------------------------------------- trading

    /// @notice Buy tokens with ETH along the curve. Resets the jackpot countdown.
    /// @param minTokensOut Slippage floor; the tx reverts if the curve moved too far.
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (msg.value == 0) revert ZeroAmount();

        // A buy landing after the deadline must not hijack the expired round's pot:
        // settle the previous winner first, then apply this buy to the fresh round.
        _settleIfExpired();

        uint256 fee = (msg.value * FEE_BPS) / BPS_DENOMINATOR;
        uint256 poolCut = (fee * POOL_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 ethForCurve = msg.value - fee;

        tokensOut = _tokensForEth(ethForCurve, totalSupply());
        if (tokensOut == 0) revert ZeroAmount();
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        reserve += ethForCurve;
        prizePool += poolCut;
        opsAccrued += fee - poolCut;
        lastBuyer = msg.sender;
        deadline = block.timestamp + ROUND_EXTENSION;

        _mint(msg.sender, tokensOut);
        emit Buy(msg.sender, msg.value, tokensOut, currentPrice());
    }

    /// @notice Sell tokens back to the curve for ETH. Does NOT touch the countdown.
    /// @param minEthOut Slippage floor on the net (post-fee) ETH returned.
    function sell(uint256 tokenAmount, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (tokenAmount == 0) revert ZeroAmount();

        _settleIfExpired();

        uint256 gross = _ethForTokens(tokenAmount, totalSupply());
        if (gross > reserve) revert InsufficientReserve();

        uint256 fee = (gross * FEE_BPS) / BPS_DENOMINATOR;
        uint256 poolCut = (fee * POOL_SHARE_BPS) / BPS_DENOMINATOR;
        ethOut = gross - fee;
        if (ethOut < minEthOut) revert SlippageExceeded();

        _burn(msg.sender, tokenAmount); // reverts on insufficient balance
        reserve -= gross;
        prizePool += poolCut;
        opsAccrued += fee - poolCut;

        emit Sell(msg.sender, tokenAmount, ethOut, currentPrice());

        (bool ok,) = msg.sender.call{value: ethOut}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------- jackpot

    /// @notice Permissionless settlement of an expired round. Pays the pool to the
    ///         last buyer and immediately opens the next round.
    function settle() external nonReentrant {
        if (!_settleIfExpired()) revert NothingToSettle();
    }

    /// @dev Effects (zero pool, advance round, clear buyer/deadline) happen strictly
    ///      before the external payout call. A failing payout is queued, never reverted
    ///      on, so no winner can block trading or settlement.
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
        emit PayoutClaimed(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Push accrued ops fees to the immutable ops address. Callable by anyone;
    ///         funds can only ever go to `opsAddress`.
    function withdrawOps() external nonReentrant {
        uint256 amount = opsAccrued;
        if (amount == 0) revert ZeroAmount();
        opsAccrued = 0;
        emit OpsWithdrawn(amount);
        (bool ok,) = opsAddress.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------- views

    /// @notice Current spot price in wei per whole token.
    function currentPrice() public view returns (uint256) {
        return basePrice + (slope * totalSupply()) / 1e18;
    }

    /// @notice Tokens received for `ethIn` (before slippage), net of the fee.
    function quoteBuy(uint256 ethIn) external view returns (uint256) {
        uint256 fee = (ethIn * FEE_BPS) / BPS_DENOMINATOR;
        return _tokensForEth(ethIn - fee, totalSupply());
    }

    /// @notice Net ETH received for selling `tokenAmount`, after the fee.
    function quoteSell(uint256 tokenAmount) external view returns (uint256) {
        uint256 gross = _ethForTokens(tokenAmount, totalSupply());
        return gross - (gross * FEE_BPS) / BPS_DENOMINATOR;
    }

    /// @notice Seconds until the current round can be settled (0 if expired/unstarted).
    function timeRemaining() external view returns (uint256) {
        if (deadline <= block.timestamp) return 0;
        return deadline - block.timestamp;
    }

    // ---------------------------------------------------------------- curve math

    /// @dev Cost of the supply integral from S to S+t:
    ///      cost = basePrice*t/1e18 + slope*(S*t + t^2/2)/1e36
    ///      Inverted for t given cost c (solving (slope/2)t^2 + B*t - c*1e36 = 0):
    ///      t = (sqrt(B^2 + 2*slope*c*1e36) - B) / slope,  B = basePrice*1e18 + slope*S
    ///      sqrt rounds down, so buyers always pay >= the exact integral and the
    ///      reserve can only over-collateralize. Sane params (basePrice, slope, supply
    ///      s.t. B < ~1e38) keep B^2 + 2*slope*c*1e36 within uint256.
    function _tokensForEth(uint256 ethIn, uint256 supply) internal view returns (uint256) {
        uint256 b = basePrice * 1e18 + slope * supply;
        uint256 discriminant = b * b + 2 * slope * ethIn * 1e36;
        return (Math.sqrt(discriminant) - b) / slope;
    }

    /// @dev Integral from S-t to S, rounded down (sellers get <= the exact integral):
    ///      out = basePrice*t/1e18 + slope*(S*t - t^2/2)/1e36
    function _ethForTokens(uint256 tokenAmount, uint256 supply) internal view returns (uint256) {
        // _burn would revert anyway; check first so quoteSell can't underflow.
        require(tokenAmount <= supply, "exceeds supply");
        uint256 linear = (basePrice * tokenAmount) / 1e18;
        uint256 curve = (slope * (supply * tokenAmount - (tokenAmount * tokenAmount) / 2)) / 1e36;
        return linear + curve;
    }

    // ---------------------------------------------------------------- holder count

    function _update(address from, address to, uint256 value) internal override {
        bool fromZeroesOut = from != address(0) && value > 0 && balanceOf(from) == value;
        bool toWasEmpty = to != address(0) && value > 0 && balanceOf(to) == 0;
        super._update(from, to, value);
        if (from == to) return;
        if (fromZeroesOut) holders--;
        if (toWasEmpty) holders++;
    }
}
