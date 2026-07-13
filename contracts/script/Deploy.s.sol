// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {JackpotToken} from "../src/JackpotToken.sol";

/// Deploys JackpotToken. Configure via env:
///   OPS_ADDRESS   - required, immutable destination of the ops fee share
///   TOKEN_NAME    - default "Last Buyer Wins"
///   TOKEN_SYMBOL  - default "JACKPOT"
///   BASE_PRICE    - wei per whole token at zero supply, default 1 gwei
///   SLOPE         - wei price increase per whole token of supply, default 1 gwei
///
/// Usage (testnet):
///   forge script script/Deploy.s.sol --rpc-url $TESTNET_RPC --broadcast \
///     --private-key $DEPLOYER_KEY
contract Deploy is Script {
    function run() external returns (JackpotToken token) {
        address ops = vm.envAddress("OPS_ADDRESS");
        string memory name = vm.envOr("TOKEN_NAME", string("Last Buyer Wins"));
        string memory symbol = vm.envOr("TOKEN_SYMBOL", string("JACKPOT"));
        uint256 basePrice = vm.envOr("BASE_PRICE", uint256(1 gwei));
        uint256 slope = vm.envOr("SLOPE", uint256(1 gwei));

        // Sanity-check we're on the chain we think we are (testnet chain id has
        // been documented inconsistently as 46630 vs 46646 — always verify live).
        console.log("Deploying to chain id:", block.chainid);

        vm.startBroadcast();
        token = new JackpotToken(name, symbol, basePrice, slope, ops);
        vm.stopBroadcast();

        console.log("JackpotToken deployed at:", address(token));
        console.log("  ops address:", ops);
        console.log("  base price (wei):", basePrice);
        console.log("  slope (wei):", slope);
    }
}
