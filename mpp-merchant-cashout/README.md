# MPP revenue to a Peer cash-out

A merchant server that accepts Base USDC over MPP, counts confirmed settlements,
and prepares an unsigned Peer cash-out plan once revenue reaches a threshold.

MPP handles the incoming machine payment. Peer handles a separate merchant
operation *after* settlement: `peer.sell.prepare()` from
[`@zkp2p/sdk`](https://www.npmjs.com/package/@zkp2p/sdk) plans the move of Base
USDC out of the merchant-controlled recipient wallet into a fiat cash-out
order. Those are two different jobs, and this example keeps the boundary
explicit. Peer is never a payer-side payment method here.

The example uses `@zkp2p/sdk@0.16.0` for `createPeer()` and `peer.sell`.
To move an existing integration,
follow the [migration guide](https://docs.peer.xyz/developer/sell/migrate-from-cash).

## Custody and safety boundaries

The point of the example is where it refuses to go, so read this part first.

- The public MPP route and the cash-out planner are **separate listeners**. The
  planner binds to `127.0.0.1`.
- The planner never accepts a private key, never signs, and never broadcasts. It
  returns unsigned transactions and same-index step descriptions.
- The merchant wallet that received the MPP revenue keeps custody and decides
  whether to submit anything.
- Only successful EVM settlement hooks increase tracked revenue, and receipt
  references are deduplicated, so one payment cannot be counted twice.
- Planned amounts are reserved before the asynchronous prepare call, so a second
  request cannot spend the same revenue. A rejected prepare, such as
  `PAYEE_NOT_FOUND` for a handle that does not exist on the platform, releases
  the reservation and returns the SDK's `PeerError` as JSON.

## Setup

```bash
npm install

export MPPX_RECIPIENT=0xMerchantWallet
export X402_FACILITATOR_URL=https://your-facilitator.example
export MPP_SECRET_KEY=replace-with-at-least-32-random-characters
export PEER_CASH_PLATFORM=revolut
export PEER_CASH_CURRENCY=USD
export PEER_CASH_PAYEE=your-handle
export PEER_CASH_THRESHOLD_USDC=10

npm run dev
```

Use a facilitator that supports Base mainnet USDC. `MPPX_RECIPIENT` must be the
merchant-controlled Base wallet that will sign any cash-out transactions.

## Payment and cash-out flow

Pay the MPP resource with an EVM-capable client:

```bash
MPPX_PRIVATE_KEY=0x... npx mppx http://localhost:5173/api/report
```

Inspect confirmed, unreserved revenue on the local admin listener:

```bash
curl http://127.0.0.1:5174/status
```

Once the threshold is reached, prepare a cash-out for all available revenue:

```bash
curl -X POST http://127.0.0.1:5174/cashout \
  -H 'content-type: application/json' \
  -d '{}'
```

Pass `{"amountUsdc":"5.25"}` to prepare a smaller amount. The response contains
unsigned transactions (with `value` as a decimal string) and their step
descriptions. There is no follow-up access-policy transaction. Review them, then sign and
submit with the recipient wallet.

## What a production host must add

The accounting here is in memory, which is fine for an example and wrong for a
service. Before exposing an equivalent operator endpoint, persist settlement,
reservation, transaction, and deposit state, and make the reservation survive a
restart. A crash between `reserve` and a signed deposit is the failure this
example cannot protect you from.

## Checks

```bash
npm run typecheck
npm test
```

## Provenance

This example was originally offered upstream as
[wevm/mppx#798](https://github.com/wevm/mppx/pull/798). The mppx maintainers
prefer to keep vendor-specific examples out of that repo and
[invited us to host it in our own](https://github.com/wevm/mppx/pull/798#issuecomment-5295353420),
so it lives here. It is unchanged in behaviour; it drops the monorepo-only
tsconfig path mapping, targets published `mppx` releases, and uses npm to match
the rest of this repo. It has since moved to `peer.sell` in `@zkp2p/sdk`.
