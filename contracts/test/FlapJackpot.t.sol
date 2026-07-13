// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlapJackpot} from "../src/FlapJackpot.sol";

/// Minimal token whose balances the jackpot checks in recordBuy.
contract MockToken {
    mapping(address => uint256) public balanceOf;

    function setBalance(address who, uint256 amount) external {
        balanceOf[who] = amount;
    }
}

contract RejectingWinner {
    FlapJackpot immutable jackpot;
    bool public accept;

    constructor(FlapJackpot j) {
        jackpot = j;
    }

    receive() external payable {
        require(accept, "rejecting");
    }

    function setAccept(bool v) external {
        accept = v;
    }

    function claim() external {
        jackpot.withdrawPayout();
    }
}

/// Winner that tries to reenter settle() during its payout.
contract ReenteringWinner {
    FlapJackpot immutable jackpot;
    bool public reentryReverted;

    constructor(FlapJackpot j) {
        jackpot = j;
    }

    receive() external payable {
        try jackpot.settle() {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }
}

contract FlapJackpotTest is Test {
    MockToken token;
    FlapJackpot jackpot;

    address keeper = makeAddr("keeper");
    address ops = makeAddr("ops");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address taxProcessor = makeAddr("taxProcessor");

    function setUp() public {
        token = new MockToken();
        jackpot = new FlapJackpot(address(token), keeper, ops);
        token.setBalance(alice, 1e18);
        token.setBalance(bob, 1e18);
        vm.deal(taxProcessor, 100 ether);
    }

    function _fundPot(uint256 amount) internal {
        vm.prank(taxProcessor);
        (bool ok,) = address(jackpot).call{value: amount}("");
        assertTrue(ok);
    }

    function _record(address buyer) internal {
        vm.prank(keeper);
        jackpot.recordBuy(buyer);
    }

    // ------------------------------------------------------------- pot funding

    function test_IncomingTaxSplitsPotAndOps() public {
        vm.expectEmit(false, false, false, true);
        emit FlapJackpot.PotFunded(1 ether, 0.75 ether, 0.25 ether);
        _fundPot(1 ether);
        assertEq(jackpot.prizePool(), 0.75 ether);
        assertEq(jackpot.opsAccrued(), 0.25 ether);
        assertEq(address(jackpot).balance, 1 ether);
    }

    // ------------------------------------------------------------- recordBuy auth

    function test_OnlyKeeperCanRecord() public {
        vm.prank(alice);
        vm.expectRevert(FlapJackpot.NotKeeper.selector);
        jackpot.recordBuy(alice);
    }

    function test_RecordRequiresHolder() public {
        address ghost = makeAddr("ghost"); // zero token balance
        vm.prank(keeper);
        vm.expectRevert(FlapJackpot.NotAHolder.selector);
        jackpot.recordBuy(ghost);
    }

    function test_RecordRejectsZeroAddress() public {
        vm.prank(keeper);
        vm.expectRevert(FlapJackpot.ZeroAmount.selector);
        jackpot.recordBuy(address(0));
    }

    function test_RecordSetsBuyerAndDeadline() public {
        vm.expectEmit(true, false, false, true, address(jackpot));
        emit FlapJackpot.BuyRecorded(alice, block.timestamp + 60, 1);
        _record(alice);
        assertEq(jackpot.lastBuyer(), alice);
        assertEq(jackpot.deadline(), block.timestamp + jackpot.ROUND_EXTENSION());
    }

    function test_EachRecordResetsCountdown() public {
        _record(alice);
        vm.warp(block.timestamp + 45);
        _record(bob);
        assertEq(jackpot.lastBuyer(), bob);
        assertEq(jackpot.deadline(), block.timestamp + 60);
    }

    // ------------------------------------------------------------- settle path

    function test_SettleRevertsBeforeDeadlineOrWithoutRound() public {
        vm.expectRevert(FlapJackpot.NothingToSettle.selector);
        jackpot.settle();

        _record(alice);
        vm.warp(jackpot.deadline()); // exactly at deadline: still live (strict >)
        vm.expectRevert(FlapJackpot.NothingToSettle.selector);
        jackpot.settle();
    }

    function test_SettlePaysLastBuyerAndRollsRound() public {
        _fundPot(2 ether); // pot 1.5, ops 0.5
        _record(alice);

        uint256 aliceBefore = alice.balance;
        vm.warp(jackpot.deadline() + 1);
        vm.expectEmit(true, true, false, true);
        emit FlapJackpot.Payout(1, alice, 1.5 ether);
        vm.prank(bob); // permissionless
        jackpot.settle();

        assertEq(alice.balance - aliceBefore, 1.5 ether, "winner paid");
        assertEq(jackpot.prizePool(), 0);
        assertEq(jackpot.opsAccrued(), 0.5 ether, "ops untouched");
        assertEq(jackpot.lastBuyer(), address(0));
        assertEq(jackpot.deadline(), 0);
        assertEq(jackpot.roundId(), 2);
    }

    function test_RecordAfterExpiryAutoSettlesPreviousRound() public {
        _fundPot(2 ether);
        _record(alice);
        uint256 aliceBefore = alice.balance;

        vm.warp(jackpot.deadline() + 100);
        _record(bob); // late buy: pays alice, then opens round 2 with bob

        assertEq(alice.balance - aliceBefore, 1.5 ether, "expired winner auto-paid");
        assertEq(jackpot.roundId(), 2);
        assertEq(jackpot.lastBuyer(), bob);
        assertEq(jackpot.prizePool(), 0, "new round starts with empty pot");
    }

    function test_TaxAfterExpiryStillGoesToDecidedWinner() public {
        _fundPot(2 ether);
        _record(alice);
        vm.warp(jackpot.deadline() + 1);
        _fundPot(1 ether); // dispatch lands after expiry, before settle
        uint256 aliceBefore = alice.balance;
        jackpot.settle();
        assertEq(alice.balance - aliceBefore, 2.25 ether);
    }

    // ------------------------------------------------------------- payout robustness

    function test_RejectingWinnerQueuedAndClaimable() public {
        RejectingWinner winner = new RejectingWinner(jackpot);
        token.setBalance(address(winner), 1e18);
        _fundPot(2 ether);
        _record(address(winner));

        vm.warp(jackpot.deadline() + 1);
        vm.expectEmit(true, false, false, true);
        emit FlapJackpot.PayoutQueued(address(winner), 1.5 ether);
        jackpot.settle();

        assertEq(jackpot.pendingPayouts(address(winner)), 1.5 ether);
        assertEq(jackpot.totalPendingPayouts(), 1.5 ether);
        assertEq(jackpot.roundId(), 2, "round advanced despite failed payout");

        winner.setAccept(true);
        uint256 before = address(winner).balance;
        winner.claim();
        assertEq(address(winner).balance - before, 1.5 ether);
        assertEq(jackpot.totalPendingPayouts(), 0);
    }

    function test_RejectingWinnerCannotBlockNextRound() public {
        RejectingWinner winner = new RejectingWinner(jackpot);
        token.setBalance(address(winner), 1e18);
        _fundPot(2 ether);
        _record(address(winner));
        vm.warp(jackpot.deadline() + 1);

        _record(bob); // must not be bricked by the rejecting winner
        assertEq(jackpot.lastBuyer(), bob);
        assertEq(jackpot.roundId(), 2);
        assertGt(jackpot.pendingPayouts(address(winner)), 0);
    }

    function test_WinnerCannotReenterDuringPayout() public {
        ReenteringWinner winner = new ReenteringWinner(jackpot);
        token.setBalance(address(winner), 1e18);
        _fundPot(2 ether);
        _record(address(winner));

        vm.warp(jackpot.deadline() + 1);
        jackpot.settle();

        assertTrue(winner.reentryReverted(), "reentrant settle was blocked");
        assertEq(jackpot.roundId(), 2);
    }

    // ------------------------------------------------------------- ops + no admin

    function test_OpsWithdrawOnlyToOpsAddress() public {
        _fundPot(2 ether);
        vm.prank(bob); // anyone can trigger
        jackpot.withdrawOps();
        assertEq(ops.balance, 0.5 ether);
        assertEq(jackpot.opsAccrued(), 0);
        assertEq(jackpot.prizePool(), 1.5 ether, "pot untouched");

        vm.expectRevert(FlapJackpot.ZeroAmount.selector);
        jackpot.withdrawOps();
    }

    function test_KeeperCannotTouchFunds() public {
        // The keeper has no function that moves ETH: withdrawOps only pays ops,
        // settle only pays the winner. Recording a buy never transfers value.
        _fundPot(2 ether);
        uint256 keeperBefore = keeper.balance;
        _record(alice);
        assertEq(keeper.balance, keeperBefore, "recordBuy moved no ETH");
        assertEq(address(jackpot).balance, 2 ether, "funds still in vault");
    }

    // ------------------------------------------------------------- solvency

    function testFuzz_Solvency(uint96 tax1, uint96 tax2) public {
        uint256 t1 = bound(uint256(tax1), 1, 20 ether);
        uint256 t2 = bound(uint256(tax2), 1, 20 ether);
        vm.deal(taxProcessor, t1 + t2);

        _fundPot(t1);
        _record(alice);
        _fundPot(t2);
        vm.warp(jackpot.deadline() + 1);
        jackpot.settle();
        jackpot.withdrawOps();

        assertGe(
            address(jackpot).balance,
            jackpot.prizePool() + jackpot.opsAccrued() + jackpot.totalPendingPayouts(),
            "insolvent"
        );
    }
}
