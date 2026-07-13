// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {JackpotToken} from "../src/JackpotToken.sol";

/// Winner that can toggle accepting ETH; used to test the pull-payment fallback.
contract TogglableWinner {
    JackpotToken immutable token;
    bool public accept;

    constructor(JackpotToken t) {
        token = t;
    }

    receive() external payable {
        require(accept, "rejecting");
    }

    function setAccept(bool v) external {
        accept = v;
    }

    function doBuy() external payable {
        token.buy{value: msg.value}(0);
    }

    function claim() external {
        token.withdrawPayout();
    }
}

/// Winner whose receive() tries to reenter buy() during the settlement payout.
contract ReenteringWinner {
    JackpotToken immutable token;
    bool public reentryReverted;

    constructor(JackpotToken t) {
        token = t;
    }

    receive() external payable {
        try token.buy{value: 1}(0) {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }

    function doBuy() external payable {
        token.buy{value: msg.value}(0);
    }
}

/// Seller whose receive() tries to reenter sell() during the sale payout.
contract ReenteringSeller {
    JackpotToken immutable token;

    constructor(JackpotToken t) {
        token = t;
    }

    receive() external payable {
        token.sell(1, 0); // must revert (reentrancy guard), failing the whole sell
    }

    function doBuy() external payable {
        token.buy{value: msg.value}(0);
    }

    function doSell(uint256 amount) external {
        token.sell(amount, 0);
    }
}

contract JackpotTokenTest is Test {
    uint256 constant BASE_PRICE = 1 gwei; // wei per whole token at S=0
    uint256 constant SLOPE = 1 gwei; // wei per whole token of supply

    JackpotToken token;
    address ops = makeAddr("ops");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        token = new JackpotToken("Last Buyer Wins", "JACKPOT", BASE_PRICE, SLOPE, ops);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(carol, 1000 ether);
    }

    // ------------------------------------------------------------- fee math

    function test_BuyFeeSplit() public {
        vm.prank(alice);
        uint256 tokensOut = token.buy{value: 1 ether}(0);

        // 2% fee = 0.02 ETH, split 50/50 pool/ops; 0.98 ETH to the curve.
        assertEq(token.prizePool(), 0.01 ether, "pool cut");
        assertEq(token.opsAccrued(), 0.01 ether, "ops cut");
        assertEq(token.reserve(), 0.98 ether, "curve reserve");
        assertEq(address(token).balance, 1 ether, "contract holds all ETH");
        assertEq(token.balanceOf(alice), tokensOut);
        assertGt(tokensOut, 0);
    }

    function test_QuoteBuyMatchesBuy() public {
        uint256 quoted = token.quoteBuy(1 ether);
        vm.prank(alice);
        uint256 actual = token.buy{value: 1 ether}(0);
        assertEq(actual, quoted);
    }

    function test_SellFeeSplit() public {
        vm.prank(alice);
        uint256 tokensOut = token.buy{value: 1 ether}(0);

        uint256 poolBefore = token.prizePool();
        uint256 opsBefore = token.opsAccrued();
        uint256 quoted = token.quoteSell(tokensOut);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        uint256 ethOut = token.sell(tokensOut, 0);

        assertEq(ethOut, quoted, "sell matches quote");
        assertEq(alice.balance - balBefore, ethOut);
        // Sell fee also split into pool/ops.
        assertGt(token.prizePool(), poolBefore);
        assertGt(token.opsAccrued(), opsBefore);
        assertEq(token.totalSupply(), 0);
        // Round trip loses ~2% each way (plus rounding dust): got back < paid.
        assertLt(ethOut, 1 ether);
        assertApproxEqRel(ethOut, 0.9604 ether, 0.001e18); // 0.98 * 0.98
    }

    function test_PriceIncreasesWithSupply() public {
        uint256 p0 = token.currentPrice();
        assertEq(p0, BASE_PRICE);
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        assertGt(token.currentPrice(), p0);
    }

    function test_BuySlippageReverts() public {
        uint256 quoted = token.quoteBuy(1 ether);
        vm.prank(alice);
        vm.expectRevert(JackpotToken.SlippageExceeded.selector);
        token.buy{value: 1 ether}(quoted + 1);
    }

    function test_ZeroBuyReverts() public {
        vm.prank(alice);
        vm.expectRevert(JackpotToken.ZeroAmount.selector);
        token.buy{value: 0}(0);
    }

    function test_BuyEmitsEvent() public {
        uint256 expectedTokens = token.quoteBuy(1 ether);
        vm.expectEmit(true, false, false, false);
        emit JackpotToken.Buy(alice, 1 ether, expectedTokens, 0);
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
    }

    // ------------------------------------------------------------- timer semantics

    function test_BuySetsLastBuyerAndDeadline() public {
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        assertEq(token.lastBuyer(), alice);
        assertEq(token.deadline(), block.timestamp + token.ROUND_EXTENSION());
    }

    function test_EachBuyResetsCountdown() public {
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        vm.warp(block.timestamp + 45);
        vm.prank(bob);
        token.buy{value: 1 ether}(0);
        assertEq(token.lastBuyer(), bob);
        assertEq(token.deadline(), block.timestamp + 60);
    }

    function test_SellDoesNotTouchTimerOrLastBuyer() public {
        vm.prank(bob);
        uint256 bobTokens = token.buy{value: 1 ether}(0);
        vm.prank(alice);
        token.buy{value: 1 ether}(0);

        uint256 deadlineBefore = token.deadline();
        vm.warp(block.timestamp + 30);
        vm.prank(bob);
        token.sell(bobTokens / 2, 0);

        assertEq(token.lastBuyer(), alice, "sell must not steal lastBuyer");
        assertEq(token.deadline(), deadlineBefore, "sell must not extend deadline");
    }

    // ------------------------------------------------------------- settle path

    function test_SettleRevertsBeforeDeadline() public {
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        vm.expectRevert(JackpotToken.NothingToSettle.selector);
        token.settle();
        // Exactly at the deadline is still not settleable (strict >).
        vm.warp(token.deadline());
        vm.expectRevert(JackpotToken.NothingToSettle.selector);
        token.settle();
    }

    function test_SettleRevertsWhenNoRoundStarted() public {
        vm.expectRevert(JackpotToken.NothingToSettle.selector);
        token.settle();
    }

    function test_SettlePaysWinnerAndRollsRound() public {
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        uint256 pot = token.prizePool();
        uint256 aliceBefore = alice.balance;

        vm.warp(token.deadline() + 1);
        vm.expectEmit(true, true, false, true);
        emit JackpotToken.Payout(1, alice, pot);
        vm.prank(carol); // permissionless: anyone can trigger, funds still go to winner
        token.settle();

        assertEq(alice.balance - aliceBefore, pot, "winner paid");
        assertEq(token.prizePool(), 0, "pool zeroed");
        assertEq(token.lastBuyer(), address(0), "buyer reset");
        assertEq(token.deadline(), 0, "deadline reset");
        assertEq(token.roundId(), 2, "round advanced");
        // Reserve and ops untouched by settlement.
        assertEq(token.reserve(), 0.98 ether);
        assertEq(token.opsAccrued(), 0.01 ether);
    }

    function test_SettleTwiceReverts() public {
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        vm.warp(token.deadline() + 1);
        token.settle();
        vm.expectRevert(JackpotToken.NothingToSettle.selector);
        token.settle();
    }

    function test_BuyAfterExpirySettlesPreviousRoundFirst() public {
        // The critical anti-hijack property: a buy landing after the deadline must
        // pay the expired round's winner, not become that round's lastBuyer.
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        uint256 alicePot = token.prizePool();
        uint256 aliceBefore = alice.balance;

        vm.warp(token.deadline() + 100);
        vm.prank(bob);
        token.buy{value: 2 ether}(0);

        assertEq(alice.balance - aliceBefore, alicePot, "expired winner auto-paid");
        assertEq(token.roundId(), 2);
        assertEq(token.lastBuyer(), bob);
        assertEq(token.prizePool(), 0.02 ether, "new pool holds only bob's cut");
    }

    function test_MultipleRoundsAccumulateIndependently() public {
        for (uint256 i = 1; i <= 3; i++) {
            vm.prank(alice);
            token.buy{value: 1 ether}(0);
            vm.warp(token.deadline() + 1);
            token.settle();
            assertEq(token.roundId(), i + 1);
            assertEq(token.prizePool(), 0);
        }
    }

    function test_SettleWithZeroPotStillRollsRound() public {
        // A buy small enough that the 2% fee rounds to zero leaves the pot empty
        // but the round live; settlement must still roll the round cleanly.
        vm.prank(alice);
        token.buy{value: 49}(0);
        assertEq(token.prizePool(), 0);
        assertEq(token.lastBuyer(), alice);
        vm.warp(token.deadline() + 1);
        token.settle();
        assertEq(token.roundId(), 2);
        assertEq(token.lastBuyer(), address(0));
    }

    // ------------------------------------------------------------- payout robustness

    function test_RevertingWinnerQueuedForPull() public {
        TogglableWinner winner = new TogglableWinner(token);
        vm.deal(address(winner), 10 ether);
        winner.doBuy{value: 1 ether}();
        uint256 pot = token.prizePool();

        vm.warp(token.deadline() + 1);
        vm.expectEmit(true, false, false, true);
        emit JackpotToken.PayoutQueued(address(winner), pot);
        token.settle(); // must NOT revert even though the winner rejects ETH

        assertEq(token.pendingPayouts(address(winner)), pot);
        assertEq(token.roundId(), 2, "round still advanced");

        // Once the winner accepts ETH again, the pull path pays out.
        winner.setAccept(true);
        uint256 before = address(winner).balance;
        winner.claim();
        assertEq(address(winner).balance - before, pot);
        assertEq(token.pendingPayouts(address(winner)), 0);
    }

    function test_RevertingWinnerCannotBlockNextBuy() public {
        TogglableWinner winner = new TogglableWinner(token);
        vm.deal(address(winner), 10 ether);
        winner.doBuy{value: 1 ether}();
        vm.warp(token.deadline() + 1);

        // Bob's buy auto-settles the expired round; the rejecting winner must not
        // be able to brick it.
        vm.prank(bob);
        token.buy{value: 1 ether}(0);
        assertEq(token.lastBuyer(), bob);
        assertEq(token.roundId(), 2);
        assertGt(token.pendingPayouts(address(winner)), 0);
    }

    function test_WinnerCannotReenterDuringPayout() public {
        ReenteringWinner winner = new ReenteringWinner(token);
        vm.deal(address(winner), 10 ether);
        winner.doBuy{value: 1 ether}();
        uint256 pot = token.prizePool();

        vm.warp(token.deadline() + 1);
        token.settle();

        // The reentrant buy attempt inside receive() must have been rejected by the
        // guard; the payout itself still lands (receive caught the failure).
        assertTrue(winner.reentryReverted(), "reentrant buy was blocked");
        assertEq(token.pendingPayouts(address(winner)), 0, "payout was pushed");
        assertGe(address(winner).balance, pot);
        assertEq(token.roundId(), 2);
    }

    function test_SellerCannotReenterDuringSellPayout() public {
        ReenteringSeller seller = new ReenteringSeller(token);
        vm.deal(address(seller), 10 ether);
        seller.doBuy{value: 1 ether}();
        uint256 tokens = token.balanceOf(address(seller));

        // The seller's receive() reenters sell(), which reverts on the guard, which
        // fails the payout call, which reverts the outer sell. No state change.
        uint256 reserveBefore = token.reserve();
        vm.expectRevert(JackpotToken.TransferFailed.selector);
        seller.doSell(tokens);
        assertEq(token.reserve(), reserveBefore);
        assertEq(token.balanceOf(address(seller)), tokens);
    }

    // ------------------------------------------------------------- ops + no-admin

    function test_OpsWithdrawGoesOnlyToOpsAddress() public {
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        uint256 accrued = token.opsAccrued();

        // Anyone can trigger it, but funds land at the immutable ops address.
        vm.prank(bob);
        token.withdrawOps();
        assertEq(ops.balance, accrued);
        assertEq(token.opsAccrued(), 0);

        vm.expectRevert(JackpotToken.ZeroAmount.selector);
        token.withdrawOps();
    }

    function test_PrizePoolUntouchedByOpsWithdraw() public {
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        uint256 pot = token.prizePool();
        token.withdrawOps();
        assertEq(token.prizePool(), pot);
        assertEq(address(token).balance, token.reserve() + pot);
    }

    // ------------------------------------------------------------- holders

    function test_HoldersCount() public {
        assertEq(token.holders(), 0);
        vm.prank(alice);
        uint256 aliceTokens = token.buy{value: 1 ether}(0);
        assertEq(token.holders(), 1);
        vm.prank(bob);
        token.buy{value: 1 ether}(0);
        assertEq(token.holders(), 2);

        // Partial transfer to a new holder: +1.
        vm.prank(alice);
        token.transfer(carol, aliceTokens / 2);
        assertEq(token.holders(), 3);

        // Full transfer out: sender drops, receiver already counted.
        uint256 aliceRemaining = token.balanceOf(alice);
        vm.prank(alice);
        token.transfer(carol, aliceRemaining);
        assertEq(token.holders(), 2);

        // Self-transfer changes nothing.
        vm.prank(carol);
        token.transfer(carol, 1);
        assertEq(token.holders(), 2);

        // Selling entire balance zeroes out the holder.
        uint256 carolBalance = token.balanceOf(carol);
        vm.prank(carol);
        token.sell(carolBalance, 0);
        assertEq(token.holders(), 1);
    }

    // ------------------------------------------------------------- solvency

    /// The contract must always hold enough ETH to cover the curve reserve, the
    /// pot, accrued ops fees, and queued payouts — across arbitrary trade patterns
    /// and round rollovers.
    function testFuzz_Solvency(uint256 seed) public {
        address[3] memory traders = [alice, bob, carol];
        for (uint256 i = 0; i < 30; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address trader = traders[r % 3];
            uint256 action = (r >> 8) % 4;

            if (action <= 1) {
                uint256 ethIn = bound(r >> 16, 1e9, 50 ether);
                vm.prank(trader);
                token.buy{value: ethIn}(0);
            } else if (action == 2) {
                uint256 bal = token.balanceOf(trader);
                if (bal > 0) {
                    uint256 amount = bound(r >> 16, 1, bal);
                    vm.prank(trader);
                    token.sell(amount, 0);
                }
            } else {
                vm.warp(block.timestamp + ((r >> 16) % 90));
                if (token.lastBuyer() != address(0) && block.timestamp > token.deadline()) {
                    token.settle();
                }
            }

            assertGe(
                address(token).balance,
                token.reserve() + token.prizePool() + token.opsAccrued(),
                "insolvent"
            );
        }

        // Everyone can always exit fully.
        for (uint256 t = 0; t < 3; t++) {
            uint256 bal = token.balanceOf(traders[t]);
            if (bal > 0) {
                vm.prank(traders[t]);
                token.sell(bal, 0);
            }
        }
        assertEq(token.totalSupply(), 0);
        assertGe(address(token).balance, token.prizePool() + token.opsAccrued());
    }

    // ------------------------------------------------------------- misc

    function test_PlainEthTransferRejected() public {
        vm.prank(alice);
        (bool ok,) = address(token).call{value: 1 ether}("");
        assertFalse(ok, "no receive(): stray ETH must bounce");
    }

    function test_QuoteSellAboveSupplyReverts() public {
        vm.prank(alice);
        token.buy{value: 1 ether}(0);
        uint256 overSupply = token.totalSupply() + 1;
        vm.expectRevert("exceeds supply");
        token.quoteSell(overSupply);
    }
}
