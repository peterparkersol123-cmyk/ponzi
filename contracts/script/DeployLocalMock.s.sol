// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LocalFlapPortal, LocalFlapToken} from "../src/mocks/LocalFlapMock.sol";
import {FlapJackpot} from "../src/FlapJackpot.sol";

/// LOCAL DEV ONLY — deploys the mock Flap Portal + token + FlapJackpot on anvil
/// so the indexer/keeper/frontend loop can be tested without touching Robinhood.
///   OPS_ADDRESS=0x... KEEPER_ADDRESS=0x... forge script script/DeployLocalMock.s.sol \
///     --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key>
///
/// KEEPER_ADDRESS defaults to anvil account 0 (the one the keeper bot uses locally).
contract DeployLocalMock is Script {
    function run() external {
        address ops = vm.envAddress("OPS_ADDRESS");
        address keeper = vm.envOr("KEEPER_ADDRESS", 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266);

        vm.startBroadcast();
        LocalFlapPortal portal = new LocalFlapPortal();
        LocalFlapToken token = new LocalFlapToken(address(portal));
        FlapJackpot jackpot = new FlapJackpot(address(token), keeper, ops);
        portal.init(token, address(jackpot));
        vm.stopBroadcast();

        console.log("LocalFlapPortal:", address(portal));
        console.log("LocalFlapToken: ", address(token));
        console.log("FlapJackpot:    ", address(jackpot));
        console.log("keeper:         ", keeper);
    }
}
