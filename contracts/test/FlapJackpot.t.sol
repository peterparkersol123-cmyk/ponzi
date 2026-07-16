// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlapJackpot} from "../src/FlapJackpot.sol";

/// Minimal token whose balances the jackpot checks in recordBuy/revealLottery.
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
        // blockhash(block.number - 1) is used by revealLottery; give the test a
        // real previous block so it isn't zero.
        vm.roll(10);
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

    function _commit(bytes32 secret) internal {
        vm.prank(keeper);
        jackpot.commitLottery(keccak256(abi.encodePacked(secret)));
    }

    function _reveal(bytes32 secret) internal {
        vm.prank(keeper);
        jackpot.revealLottery(secret);
    }

    function _declare(address winner) internal {
        vm.prank(keeper);
        jackpot.declareLotteryWinner(winner);
    }

    // ------------------------------------------------------------- pot funding

    function test_IncomingTaxSplitsThreeWays() public {
        vm.expectEmit(false, false, false, true);
        emit FlapJackpot.PotFunded(1 ether, 0.375 ether, 0.375 ether, 0.25 ether);
        _fundPot(1 ether);
        assertEq(jackpot.prizePool(), 0.375 ether);
        assertEq(jackpot.lotteryPool(), 0.375 ether);
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
        emit FlapJackpot.BuyRecorded(alice, block.timestamp + 180, 1);
        _record(alice);
        assertEq(jackpot.lastBuyer(), alice);
        assertEq(jackpot.deadline(), block.timestamp + jackpot.ROUND_EXTENSION());
    }

    function test_EachRecordResetsCountdown() public {
        _record(alice);
        vm.warp(block.timestamp + 90);
        _record(bob);
        assertEq(jackpot.lastBuyer(), bob);
        assertEq(jackpot.deadline(), block.timestamp + 180);
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

    function test_SettlePaysHalfPrizePoolAndKeepsSeed() public {
        _fundPot(2 ether); // prizePool 0.75, lottery 0.75, ops 0.5
        _record(alice);

        uint256 aliceBefore = alice.balance;
        vm.warp(jackpot.deadline() + 1);
        vm.expectEmit(true, true, false, true);
        emit FlapJackpot.Payout(1, alice, 0.375 ether);
        vm.prank(bob); // permissionless
        jackpot.settle();

        assertEq(alice.balance - aliceBefore, 0.375 ether, "winner paid half the pool");
        assertEq(jackpot.prizePool(), 0.375 ether, "other half stays as next round's seed");
        assertEq(jackpot.lotteryPool(), 0.75 ether, "lottery pool untouched by last-buyer settle");
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
        _record(bob); // late buy: pays alice half, then opens round 2 with bob

        assertEq(alice.balance - aliceBefore, 0.375 ether, "expired winner auto-paid half");
        assertEq(jackpot.roundId(), 2);
        assertEq(jackpot.lastBuyer(), bob);
        assertEq(jackpot.prizePool(), 0.375 ether, "new round starts seeded with the other half");
    }

    function test_TaxAfterExpiryStillGoesToDecidedWinner() public {
        _fundPot(2 ether); // prizePool 0.75
        _record(alice);
        vm.warp(jackpot.deadline() + 1);
        _fundPot(1 ether); // dispatch lands after expiry, before settle; +0.375 to prizePool
        uint256 aliceBefore = alice.balance;
        jackpot.settle();
        // prizePool at settle time = 0.75 + 0.375 = 1.125; winner gets half.
        assertEq(alice.balance - aliceBefore, 0.5625 ether);
        assertEq(jackpot.prizePool(), 0.5625 ether, "remaining half seeds next round");
    }

    // ------------------------------------------------------------- payout robustness

    function test_RejectingWinnerQueuedAndClaimable() public {
        RejectingWinner winner = new RejectingWinner(jackpot);
        token.setBalance(address(winner), 1e18);
        _fundPot(2 ether);
        _record(address(winner));

        vm.warp(jackpot.deadline() + 1);
        vm.expectEmit(true, false, false, true);
        emit FlapJackpot.PayoutQueued(address(winner), 0.375 ether);
        jackpot.settle();

        assertEq(jackpot.pendingPayouts(address(winner)), 0.375 ether);
        assertEq(jackpot.totalPendingPayouts(), 0.375 ether);
        assertEq(jackpot.roundId(), 2, "round advanced despite failed payout");

        winner.setAccept(true);
        uint256 before = address(winner).balance;
        winner.claim();
        assertEq(address(winner).balance - before, 0.375 ether);
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

    // ------------------------------------------------------------- lottery: commit/reveal/declare

    function test_OnlyKeeperCanCommitRevealOrDeclare() public {
        vm.prank(alice);
        vm.expectRevert(FlapJackpot.NotKeeper.selector);
        jackpot.commitLottery(keccak256("x"));

        _commit(bytes32(uint256(1)));
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);
        vm.prank(alice);
        vm.expectRevert(FlapJackpot.NotKeeper.selector);
        jackpot.revealLottery(bytes32(uint256(1)));

        _reveal(bytes32(uint256(1)));
        vm.prank(alice);
        vm.expectRevert(FlapJackpot.NotKeeper.selector);
        jackpot.declareLotteryWinner(alice);
    }

    function test_CannotCommitWhileOneIsPending() public {
        _commit(bytes32(uint256(1)));
        vm.prank(keeper);
        vm.expectRevert(FlapJackpot.CommitmentPending.selector);
        jackpot.commitLottery(keccak256(abi.encodePacked(bytes32(uint256(2)))));
    }

    function test_CannotCommitWhileRandomnessPending() public {
        _commit(bytes32(uint256(1)));
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);
        _reveal(bytes32(uint256(1)));

        vm.prank(keeper);
        vm.expectRevert(FlapJackpot.RandomnessPending.selector);
        jackpot.commitLottery(keccak256(abi.encodePacked(bytes32(uint256(2)))));
    }

    function test_RevealRejectsWrongSecret() public {
        _commit(bytes32(uint256(1)));
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);
        vm.prank(keeper);
        vm.expectRevert(FlapJackpot.BadReveal.selector);
        jackpot.revealLottery(bytes32(uint256(2)));
    }

    function test_RevealRejectsBeforeIntervalElapsed() public {
        _commit(bytes32(uint256(1)));
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() - 1);
        vm.prank(keeper);
        vm.expectRevert(FlapJackpot.NotYetDue.selector);
        jackpot.revealLottery(bytes32(uint256(1)));
    }

    function test_DeclareRequiresWinnerHoldsToken() public {
        address ghost = makeAddr("ghost");
        _commit(bytes32(uint256(1)));
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);
        _reveal(bytes32(uint256(1)));

        vm.prank(keeper);
        vm.expectRevert(FlapJackpot.NotAHolder.selector);
        jackpot.declareLotteryWinner(ghost);
    }

    function test_DeclareRequiresRandomnessPending() public {
        vm.prank(keeper);
        vm.expectRevert(FlapJackpot.NoRandomnessPending.selector);
        jackpot.declareLotteryWinner(alice);
    }

    function test_RevealFinalizesRandomnessWithoutPayingOut() public {
        _fundPot(2 ether); // lotteryPool 0.75
        bytes32 secret = bytes32(uint256(1));
        _commit(secret);
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);

        _reveal(secret);

        assertTrue(jackpot.lotteryRandomness() != bytes32(0), "randomness finalized");
        assertEq(jackpot.lotteryCommitment(), bytes32(0), "commitment cleared");
        assertEq(jackpot.lotteryPool(), 0.75 ether, "reveal alone does not pay out");
    }

    function test_DeclarePaysFullLotteryPoolAndResets() public {
        _fundPot(2 ether); // lotteryPool 0.75
        bytes32 secret = bytes32(uint256(1));
        _commit(secret);
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);
        _reveal(secret);

        uint256 aliceBefore = alice.balance;
        _declare(alice);

        assertEq(alice.balance - aliceBefore, 0.75 ether, "lottery pays out its full pool");
        assertEq(jackpot.lotteryPool(), 0, "pool resets after a draw");
        assertEq(jackpot.lotteryRandomness(), bytes32(0), "ready for the next cycle");
        assertEq(jackpot.lotteryRoundId(), 2);
    }

    function test_CanCommitAgainImmediatelyAfterDeclare() public {
        bytes32 secret = bytes32(uint256(1));
        _commit(secret);
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);
        _reveal(secret);
        _declare(alice);

        // Should not revert — previous cycle was fully cleared by the declare.
        _commit(bytes32(uint256(2)));
        assertTrue(jackpot.lotteryCommitment() != bytes32(0));
    }

    function test_StaleRandomnessCanBeCancelledByAnyoneAfterTimeout() public {
        bytes32 secret = bytes32(uint256(1));
        _commit(secret);
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);
        _reveal(secret);

        vm.expectRevert(FlapJackpot.NotYetDue.selector);
        jackpot.cancelStaleLotteryRandomness();

        vm.warp(block.timestamp + jackpot.COMMITMENT_TIMEOUT() + 1);
        vm.prank(bob); // permissionless
        jackpot.cancelStaleLotteryRandomness();

        assertEq(jackpot.lotteryRandomness(), bytes32(0));
        // Keeper can now start a fresh cycle.
        _commit(bytes32(uint256(2)));
    }

    function test_StaleCommitmentCanBeCancelledByAnyoneAfterTimeout() public {
        _commit(bytes32(uint256(1)));

        vm.expectRevert(FlapJackpot.NotYetDue.selector);
        jackpot.cancelStaleLotteryCommitment();

        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + jackpot.COMMITMENT_TIMEOUT() + 1);
        vm.prank(bob); // permissionless
        jackpot.cancelStaleLotteryCommitment();

        assertEq(jackpot.lotteryCommitment(), bytes32(0));
        // Keeper can now start a fresh cycle.
        _commit(bytes32(uint256(2)));
    }

    function test_LotteryTimeRemaining() public {
        assertEq(jackpot.lotteryTimeRemaining(), 0, "nothing pending");
        _commit(bytes32(uint256(1)));
        assertEq(jackpot.lotteryTimeRemaining(), jackpot.LOTTERY_INTERVAL());
        vm.warp(block.timestamp + jackpot.LOTTERY_INTERVAL() + 1);
        assertEq(jackpot.lotteryTimeRemaining(), 0, "past due");
    }

    // ------------------------------------------------------------- ops + no admin

    function test_OpsWithdrawOnlyToOpsAddress() public {
        _fundPot(2 ether);
        vm.prank(bob); // anyone can trigger
        jackpot.withdrawOps();
        assertEq(ops.balance, 0.5 ether);
        assertEq(jackpot.opsAccrued(), 0);
        assertEq(jackpot.prizePool(), 0.75 ether, "prize pool untouched");
        assertEq(jackpot.lotteryPool(), 0.75 ether, "lottery pool untouched");

        vm.expectRevert(FlapJackpot.ZeroAmount.selector);
        jackpot.withdrawOps();
    }

    function test_KeeperCannotTouchFunds() public {
        // The keeper has no function that moves ETH to itself: withdrawOps only
        // pays ops, settle/revealLottery only pay the named winner. Recording a
        // buy or committing/revealing the lottery never transfers value to msg.sender.
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
            jackpot.prizePool() + jackpot.lotteryPool() + jackpot.opsAccrued() + jackpot.totalPendingPayouts(),
            "insolvent"
        );
    }
}
