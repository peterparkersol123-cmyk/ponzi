// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlapJackpot} from "../src/FlapJackpot.sol";
import {IFlapPortalLauncher} from "../src/interfaces/IFlapPortal.sol";

/// Launches the jackpot game on Flap (Robinhood Chain) in one broadcast:
///
///   1. find a CREATE2 vanity salt so the token address ends in 0x7777 (Flap's
///      requirement for tax tokens), which lets us PREDICT the token address
///   2. deploy FlapJackpot bound to that predicted address
///   3. call Portal.newTokenV6 launching a TOKEN_TAXED_V3 with the jackpot as
///      the sole tax beneficiary (mktBps = 10000)
///
/// After this, every trade's tax flows to the jackpot (75% pot / 25% ops) and
/// buys routed through FlapJackpot.buy() drive the countdown. No admin anywhere.
///
/// Env:
///   OPS_ADDRESS    required — immutable destination of the ops fee share
///   KEEPER_ADDRESS required — the off-chain referee allowed to call recordBuy.
///                  Run the keeper bot (indexer/src/keeper.ts) from this address.
///   TOKEN_NAME     default "Last Buyer Wins"
///   TOKEN_SYMBOL   default "JACKPOT"
///   META_CID       required — IPFS CID of token metadata JSON, pinned via Flap's
///                  upload API (https://funcs.flap.sh/api/upload) so flap.sh can
///                  render it
///   TAX_BPS        default 300 (3% buy AND sell tax; Flap max is 1000)
///   TAX_DURATION   default 315360000 (10 years, in seconds)
///   INITIAL_BUY    default 0 — ETH (wei) for the creator's initial buy
///
/// Usage:
///   OPS_ADDRESS=0x... META_CID=bafk... forge script script/LaunchFlap.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast \
///     --private-key $DEPLOYER_KEY
contract LaunchFlap is Script {
    // Flap on Robinhood Chain mainnet (verified live, Portal v5.14.15).
    address constant PORTAL = 0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09;
    address constant TAX_TOKEN_V3_IMPL = 0x7777C8743C88B3aff3cf262135beF2c8b2e83333;
    uint256 constant EXPECTED_CHAIN_ID = 4663;

    // IPortalTypes enum values (see interfaces/IFlapPortal.sol)
    uint8 constant DEX_THRESH_FOUR_FIFTHS = 1;
    uint8 constant MIGRATOR_V2 = 1; // tax tokens must use the V2 migrator
    uint8 constant TOKEN_TAXED_V3 = 6;

    function run() external returns (address token, FlapJackpot jackpot) {
        require(block.chainid == EXPECTED_CHAIN_ID, "wrong chain: expected Robinhood mainnet (4663)");

        address ops = vm.envAddress("OPS_ADDRESS");
        address keeperAddr = vm.envAddress("KEEPER_ADDRESS");
        string memory name = vm.envOr("TOKEN_NAME", string("Last Buyer Wins"));
        string memory symbol = vm.envOr("TOKEN_SYMBOL", string("JACKPOT"));
        string memory meta = vm.envString("META_CID");
        uint16 taxBps = uint16(vm.envOr("TAX_BPS", uint256(300)));
        uint64 taxDuration = uint64(vm.envOr("TAX_DURATION", uint256(315_360_000)));
        uint256 initialBuy = vm.envOr("INITIAL_BUY", uint256(0));

        (bytes32 salt, address predicted) = _findVanitySalt();
        console.log("Found vanity salt; predicted token address:", predicted);

        vm.startBroadcast();

        jackpot = new FlapJackpot(predicted, keeperAddr, ops);
        console.log("FlapJackpot deployed at:", address(jackpot));
        console.log("  keeper:", keeperAddr);

        token = IFlapPortalLauncher(PORTAL).newTokenV6{value: initialBuy}(
            IFlapPortalLauncher.NewTokenV6Params({
                name: name,
                symbol: symbol,
                meta: meta,
                dexThresh: DEX_THRESH_FOUR_FIFTHS,
                salt: salt,
                migratorType: MIGRATOR_V2,
                quoteToken: address(0), // native ETH
                quoteAmt: initialBuy,
                beneficiary: address(jackpot), // ALL tax -> jackpot (pot + ops)
                permitData: "",
                extensionID: bytes32(0),
                extensionData: "",
                dexId: 0,
                lpFeeProfile: 0,
                buyTaxRate: taxBps,
                sellTaxRate: taxBps,
                taxDuration: taxDuration,
                antiFarmerDuration: 0,
                mktBps: 10_000, // 100% of tax remainder to the beneficiary
                deflationBps: 0,
                dividendBps: 0,
                lpBps: 0,
                minimumShareBalance: 0,
                dividendToken: address(0),
                commissionReceiver: address(0),
                tokenVersion: TOKEN_TAXED_V3
            })
        );

        vm.stopBroadcast();

        require(token == predicted, "token address mismatch vs prediction");
        console.log("Token launched at:", token);
        console.log("Tax bps (buy & sell):", taxBps);
        console.log("Flap page: https://flap.sh/ (search the token address)");
    }

    /// @dev Flap deploys tokens as EIP-1167 minimal proxies via CREATE2 from the
    ///      Portal. Iterate keccak over a seed until the predicted clone address
    ///      ends in 0x7777 (tax-token vanity requirement).
    function _findVanitySalt() internal view returns (bytes32 salt, address predicted) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                hex"3d602d80600a3d3981f3363d3d373d3d3d363d73",
                TAX_TOKEN_V3_IMPL,
                hex"5af43d82803e903d91602b57fd5bf3"
            )
        );
        salt = keccak256(abi.encode(vm.envOr("SEED", uint256(1)), block.number));
        for (uint256 i = 0; i < 5_000_000; i++) {
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", PORTAL, salt, initCodeHash)))));
            if (uint16(uint160(predicted)) == 0x7777) return (salt, predicted);
            salt = keccak256(abi.encode(salt));
        }
        revert("no vanity salt found");
    }
}
