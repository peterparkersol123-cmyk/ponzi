// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IFlapPortalTrade} from "../interfaces/IFlapPortal.sol";

/// LOCAL DEV ONLY — a stripped-down stand-in for Flap's Portal + tax token so the
/// indexer/frontend can be exercised on anvil. Constant token price, 1% protocol
/// fee, 2% tax pushed straight to the beneficiary (simulating TaxProcessor
/// dispatch). Event shapes match the real Portal exactly.
contract LocalFlapToken is ERC20 {
    address public immutable portal;

    constructor(address portal_) ERC20("Last Buyer Wins (local)", "JACKPOT") {
        portal = portal_;
    }

    modifier onlyPortal() {
        require(msg.sender == portal, "only portal");
        _;
    }

    function portalMint(address to, uint256 amount) external onlyPortal {
        _mint(to, amount);
    }

    function portalBurn(address from, uint256 amount) external onlyPortal {
        _burn(from, amount);
    }
}

contract LocalFlapPortal {
    uint256 public constant PRICE = 1e11; // wei per whole token, constant for the mock
    uint256 public constant FEE_BPS = 100; // flap protocol fee 1%
    uint256 public constant TAX_BPS = 200; // token tax 2%
    uint256 public constant DEX_SUPPLY_THRESH = 8e26; // 800M tokens

    LocalFlapToken public token;
    address public beneficiary; // the jackpot; settable once (mock-only wiring)
    /// Tax accumulates here and is pushed by dispatch(), like Flap's TaxProcessor
    /// + trigger bot — never synchronously during a swap.
    uint256 public accruedTax;

    event TokenBought(
        uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice
    );
    event TokenSold(
        uint256 ts, address token, address seller, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice
    );
    event FlapTokenCirculatingSupplyChanged(address token, uint256 newSupply);

    function init(LocalFlapToken token_, address beneficiary_) external {
        require(address(token) == address(0), "initialized");
        token = token_;
        beneficiary = beneficiary_;
    }

    function swapExactInput(IFlapPortalTrade.ExactInputParams calldata params)
        external
        payable
        returns (uint256 outputAmount)
    {
        if (params.inputToken == address(0)) {
            // BUY: native ETH in, tokens out
            require(params.outputToken == address(token) && msg.value == params.inputAmount, "bad buy");
            uint256 fee = (msg.value * FEE_BPS) / 10_000;
            uint256 tax = (msg.value * TAX_BPS) / 10_000;
            outputAmount = ((msg.value - fee - tax) * 1e18) / PRICE;
            require(outputAmount >= params.minOutputAmount, "slippage");
            accruedTax += tax;
            token.portalMint(msg.sender, outputAmount);
            emit TokenBought(block.timestamp, address(token), msg.sender, outputAmount, msg.value, fee + tax, PRICE);
            emit FlapTokenCirculatingSupplyChanged(address(token), token.totalSupply());
        } else {
            // SELL: tokens in, native ETH out
            require(params.inputToken == address(token) && params.outputToken == address(0), "bad sell");
            uint256 gross = (params.inputAmount * PRICE) / 1e18;
            uint256 fee = (gross * FEE_BPS) / 10_000;
            uint256 tax = (gross * TAX_BPS) / 10_000;
            outputAmount = gross - fee - tax;
            require(outputAmount >= params.minOutputAmount, "slippage");
            token.portalBurn(msg.sender, params.inputAmount);
            accruedTax += tax;
            emit TokenSold(block.timestamp, address(token), msg.sender, params.inputAmount, outputAmount, fee + tax, PRICE);
            emit FlapTokenCirculatingSupplyChanged(address(token), token.totalSupply());
            (bool ok,) = msg.sender.call{value: outputAmount}("");
            require(ok, "eth out failed");
        }
    }

    function quoteExactInput(IFlapPortalTrade.QuoteExactInputParams calldata params)
        external
        view
        returns (uint256 outputAmount)
    {
        if (params.inputToken == address(0)) {
            uint256 net = params.inputAmount - (params.inputAmount * (FEE_BPS + TAX_BPS)) / 10_000;
            return (net * 1e18) / PRICE;
        }
        uint256 gross = (params.inputAmount * PRICE) / 1e18;
        return gross - (gross * (FEE_BPS + TAX_BPS)) / 10_000;
    }

    struct TokenStateV8Safe {
        uint8 status;
        uint256 reserve;
        uint256 circulatingSupply;
        uint256 price;
        uint8 tokenVersion;
        uint256 r;
        uint256 h;
        uint256 k;
        uint256 dexSupplyThresh;
        address quoteTokenAddress;
        bool nativeToQuoteSwapEnabled;
        bytes32 extensionID;
        uint256 buyTaxRate;
        uint256 sellTaxRate;
        address pool;
        uint256 progress;
        uint8 lpFeeProfile;
        uint8 dexId;
    }

    /// Matches the real Portal's TokenStateV8Safe ABI.
    function getTokenV8Safe(address) external view returns (TokenStateV8Safe memory state) {
        uint256 supply = token.totalSupply();
        state.status = 1; // Tradable
        state.reserve = address(this).balance;
        state.circulatingSupply = supply;
        state.price = PRICE;
        state.tokenVersion = 6; // TOKEN_TAXED_V3
        state.dexSupplyThresh = DEX_SUPPLY_THRESH;
        state.buyTaxRate = TAX_BPS;
        state.sellTaxRate = TAX_BPS;
        state.progress = (supply * 1e18) / DEX_SUPPLY_THRESH;
    }

    /// Anyone can push accumulated tax to the beneficiary (Flap's bot does this).
    function dispatch() external {
        uint256 amount = accruedTax;
        require(amount > 0, "nothing to dispatch");
        accruedTax = 0;
        (bool ok,) = beneficiary.call{value: amount}("");
        require(ok, "tax dispatch failed");
    }
}
