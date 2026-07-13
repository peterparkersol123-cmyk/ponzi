# Last Buyer Wins — Flap-launched Jackpot Token (Robinhood Chain)

A "last buyer wins" jackpot game built around a token launched on
[Flap](https://flap.sh) (Robinhood Chain, id 4663). Flap's Portal owns the
bonding curve and DEX migration; the jackpot is a trustless companion contract.
**Players just buy the token — no wallet connection to any dapp, ever.**

## Game rules

- the token is a Flap **Tax Token V3** with a **3% buy & sell tax** — every trade
  anywhere (flap.sh, bots, DEX after migration) pays it, plus Flap's 1% protocol fee
- the tax's sole beneficiary is the **FlapJackpot** contract: incoming tax splits
  **75% prize pool / 25% operations**
- **every buy of the token** resets the countdown to 60s and makes that buyer the
  `lastBuyer` — no matter where the buy happened
- sells never touch the timer
- when the countdown hits 0:00, the pot pays out **automatically** to the last
  buyer and a new round starts on the next buy — nobody has to claim

## Who sets "last buyer" (the keeper)

Flap owns the buy path, so it never calls our contracts. To make *every* buy count,
a small off-chain **keeper** watches Flap's `TokenBought` events and calls
`recordBuy(buyer)` on-chain, resetting the clock. The keeper is a **referee, not a
treasurer**:

- its only power is naming the current last buyer; every call is publicly auditable
  against the matching on-chain buy, and the named address must actually hold the token
- most real trades don't go through flap.sh directly — they route through
  aggregators (GMGN, etc.) whose router contract is Portal's `msg.sender` and
  briefly holds the tokens before forwarding them on in the same transaction. The
  keeper (and the indexer) don't trust Portal's reported `buyer` for this reason —
  they resolve the real holder from the token's own `Transfer` trail in that
  transaction (the last `Transfer`'s recipient), which is what `recordBuy`'s
  balance check then verifies on-chain
- it **cannot** move the pot, the ops funds, or change the split — those are hardcoded
  and `settle()` is permissionless
- if the keeper stalls, the round still resolves: anyone (including the winner) can
  call `settle()`

This is the only way to capture all buys without routing players through a dapp.
Full trustlessness would require buyers to go through our contract, which the
"no connection" requirement rules out.

## Layout

```
contracts/   Foundry
  src/FlapJackpot.sol       jackpot companion (pot, keeper clock, settlement)
  src/JackpotToken.sol      legacy standalone variant (own bonding curve, unused
                            in the Flap deployment; kept for reference)
  src/mocks/LocalFlapMock.sol  local-dev stand-in for Flap's Portal + tax token
  script/LaunchFlap.s.sol   one-shot launch: vanity salt → deploy jackpot →
                            newTokenV6 with jackpot as tax beneficiary
indexer/     Node 22+
  src/index.ts   read-only: watches Portal + jackpot + Transfer, pushes websocket
  src/keeper.ts  the referee bot: records buys + settles rounds (needs a funded key)
frontend/    Next.js read-only dashboard — tape, pot + countdown, leaderboard, payouts
```

## Security model (contracts/test/, 40 tests)

- `nonReentrant` on recordBuy/settle/withdrawals; checks-effects-interactions on payout
- **recordBuy auto-settles an expired round first** — a buy recorded after the deadline
  pays the previous winner before starting the new round (no pot hijack)
- keeper is constrained: `onlyKeeper` on recordBuy, named buyer must hold the token,
  and recordBuy moves zero ETH (covered by `test_KeeperCannotTouchFunds`)
- winner payouts that fail (reverting contracts) queue in `pendingPayouts` for
  pull-withdrawal — no winner can brick recording or settlement
- no owner, no sweep: funds only flow to winners and the immutable ops address
- accepted genre risks (disclosed): multiple wallets racing the final second, and
  keeper liveness (must record buys within the 60s window)

## Verified Flap facts (Robinhood mainnet, checked live 2026-07-13)

| What | Value |
|---|---|
| Chain id | 4663 (`https://rpc.mainnet.chain.robinhood.com`) |
| Portal | `0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09` (v5.14.15) |
| Tax Token V3 impl (clone base for 7777 salts) | `0x7777C8743C88B3aff3cf262135beF2c8b2e83333` |
| Protocol fee | 1% buy / 1% sell (`getFeeRate()`) |
| Working views | `getTokenV8Safe`, `quoteExactInput` (via eth_call) |

## Launch (mainnet)

1. Pin token metadata via Flap's upload API (`https://funcs.flap.sh/api/upload`)
   to get `META_CID` (must be pinned on their gateway or flap.sh won't render it).
2. One-shot launch — finds a 0x7777 vanity salt, predicts the token address,
   deploys `FlapJackpot` bound to it, then launches the token with the jackpot as
   tax beneficiary, atomically. Set `KEEPER_ADDRESS` to the address that will run
   the keeper bot:

   ```bash
   cd contracts
   OPS_ADDRESS=0x... KEEPER_ADDRESS=0x... META_CID=bafk... TOKEN_SYMBOL=JACKPOT \
   forge script script/LaunchFlap.s.sol \
     --rpc-url https://rpc.mainnet.chain.robinhood.com \
     --broadcast --private-key $DEPLOYER_KEY
   ```

3. Verify the jackpot on Blockscout:
   ```bash
   forge verify-contract <jackpot> src/FlapJackpot.sol:FlapJackpot \
     --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api \
     --constructor-args $(cast abi-encode "constructor(address,address,address)" \
       <token> <keeper> <ops>)
   ```
4. Run the keeper (from the KEEPER_ADDRESS key) — this is what makes the game live:
   ```bash
   cd indexer && npm install
   KEEPER_PRIVATE_KEY=0x... RPC_URL=https://rpc.mainnet.chain.robinhood.com \
   TOKEN_ADDRESS=<token> JACKPOT_ADDRESS=<jackpot> CHAIN_ID=4663 \
   npm run keeper
   ```
5. Run the read-only indexer + dashboard for the public view (`npm run dev` in
   `indexer/` and `frontend/`, addresses set in their env files).

Notes:
- Pot growth depends on Flap's tax trigger bot calling `TaxProcessor.dispatch()`;
  anyone can also call it manually if the bot lags.
- Keep the keeper's poll latency well under the 60s window so buys reset the clock
  in time.

## Deploying for real (Railway + Vercel)

The indexer and keeper are long-running processes (persistent WebSocket server,
live chain watchers, a local SQLite DB) — they need a host that keeps a process
alive, not a serverless one. The frontend is a normal Next.js app and belongs on
Vercel.

**Indexer + keeper → Railway.** Both live in `indexer/`; create two Railway
services pointed at this repo with root directory `indexer/`:

| | Indexer (`web`) | Keeper (`worker`) |
|---|---|---|
| Build command | `npm install && npm run build` | same |
| Start command | `npm run start` | `npm run start:keeper` |
| Env vars | `RPC_URL`, `WS_RPC_URL`, `TOKEN_ADDRESS`, `JACKPOT_ADDRESS`, `START_BLOCK`, `DB_PATH` | `RPC_URL`, `TOKEN_ADDRESS`, `JACKPOT_ADDRESS`, `KEEPER_PRIVATE_KEY` |
| Public domain | yes — e.g. `indexer.yourdomain.xyz`, proxies `wss://` fine | no — it never accepts connections |
| Volume | mount at `DB_PATH` so the DB survives redeploys | not needed |

Don't set `PORT` on the indexer — Railway injects its own and `src/index.ts`
already reads `process.env.PORT`. `railway.json` and `Procfile` in `indexer/`
are already set up for this; the `Procfile`'s `web`/`worker` split is mostly
documentation — set the Start Command explicitly per service in Railway's
dashboard rather than relying on Procfile auto-detection.

**Frontend → Vercel.** `cd frontend && npx vercel --prod`, then set
`NEXT_PUBLIC_TOKEN_ADDRESS`, `NEXT_PUBLIC_JACKPOT_ADDRESS`,
`NEXT_PUBLIC_CHAIN=mainnet`, and `NEXT_PUBLIC_INDEXER_WS=wss://indexer.yourdomain.xyz`
in the project's environment variables, then add your custom domain under
Settings → Domains.

Never put `KEEPER_PRIVATE_KEY` in a repo file or a committed `.env` — only in
Railway's encrypted env var field.

## Local dev loop (no Robinhood access needed)

```bash
anvil
cd contracts
OPS_ADDRESS=<addr> KEEPER_ADDRESS=0xf39F…2266 forge script script/DeployLocalMock.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key 0>
# read-only indexer:
cd ../indexer && npm install
RPC_URL=http://127.0.0.1:8545 PORTAL_ADDRESS=<mock> TOKEN_ADDRESS=<mock> \
  JACKPOT_ADDRESS=<jackpot> npm run dev
# keeper (anvil account 0):
KEEPER_PRIVATE_KEY=0xac09…ff80 RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 \
  PORTAL_ADDRESS=<mock> TOKEN_ADDRESS=<mock> JACKPOT_ADDRESS=<jackpot> npm run keeper
# dashboard:
cd ../frontend && npm install && npm run dev   # .env.local addresses, NEXT_PUBLIC_CHAIN=local
```

The mock Portal accrues tax like the real TaxProcessor; push it to the jackpot with
`cast send <mock> "dispatch()"`. Buy the mock token by calling the mock Portal's
`swapExactInput` and the keeper will record it.

## Before/at launch

- This is a real-money jackpot mechanic: check gambling/wagering rules in your
  jurisdiction plus Flap's and Robinhood Chain's ToS before going public.
- Total cost per trade is ~4% (3% tax to the pot/ops + 1% Flap protocol fee).
- The keeper key controls who is credited as last buyer — protect it like a hot
  wallet; if it leaks an attacker can grief the game (but still cannot drain funds).
