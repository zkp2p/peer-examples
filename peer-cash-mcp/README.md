# Peer Cash MCP server

A stdio [MCP](https://modelcontextprotocol.io) server that gives an agent the
Peer Cash verbs: discover payout platforms, estimate a fiat rate, open a
cash-out, watch it fill, top it up, and unwind it.

`@zkp2p/cash` already publishes JSON-schema definitions of those verbs under
`@zkp2p/cash/tools`, so this server does not re-derive a single schema. It
serves the published manifest, validates each call against it, and dispatches to
the matching client method. Upgrading the SDK changes the tool surface without
touching this code.

## Custody and safety boundaries

Read this part first: an agent, not a person, is calling these tools.

- The server takes **no private key**, never signs, and never broadcasts.
- Every mutating verb uses the SDK's prepare path. `cash_cashout`,
  `cash_withdraw`, and `cash_topup` return unsigned `txs[]` plus one same-index
  label in `steps[]`. Signing and ordered submission stay on the host, where key
  custody and policy live.
- Those three are the only tools advertised with `readOnlyHint: false`, so a
  host can auto-approve the observers and still prompt for the rest. Nothing is
  advertised as destructive, because nothing here can move funds on its own.
- Arguments are validated against the published schema before the client is
  reached, so a malformed or hallucinated argument fails as a tool error rather
  than as a protocol call.
- Peer Cash errors come back as `{ code, message, retryable, remediation }`
  instead of an exception, so the agent can act on them and keep its turn.

## Setup

```bash
npm install
```

The defaults talk to production over the public Base RPC. Three optional
variables:

| Variable | Effect |
| --- | --- |
| `PEER_CASH_ENVIRONMENT` | `production` (default), `preproduction`, or `staging`. |
| `PEER_CASH_RPC_URL` | Your own Base RPC. The public one is rate-limited. |
| `PEER_CASH_REFERRAL_CODE` | Your six-character code from the Peer app, so filled deposits route the integration share to you. |

## Connect it to an agent host

Point any MCP host at the local `tsx` binary and the server entry point, both
as absolute paths:

```json
{
  "mcpServers": {
    "peer-cash": {
      "command": "/absolute/path/to/peer-examples/peer-cash-mcp/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/peer-examples/peer-cash-mcp/src/server.ts"],
      "env": { "PEER_CASH_RPC_URL": "https://your-base-rpc.example" }
    }
  }
}
```

To drive it by hand instead, `npm start` speaks MCP on stdio.

## The verbs

| Tool | What the agent gets |
| --- | --- |
| `cash_capabilities` | Payout platforms, currencies per platform, amount bounds, Base USDC destination. |
| `cash_fill_stats` | 30-day demand and first-fill speed per `platform:currency` pair. |
| `cash_estimate` | Fiat received at the live oracle rate, plus a recent-fill ETA. |
| `cash_cashout` | Unsigned `[approve, createDeposit]` for a new cash-out. |
| `cash_order` / `cash_orders` | Order state, fills, and next actions, resumable from `depositId` alone. |
| `cash_buyer` | The track record of the buyer who just matched an order. |
| `cash_topup` / `cash_withdraw` | Unsigned plans to add funds to a live order or unwind it. |
| `cash_source_quote` / `cash_source_status` | Route a non-Base asset into Base USDC through Relay first. |

Amounts are base units as decimal strings; USDC has six decimals. `watch` is
deliberately not a tool: an agent polls `cash_order` between other work rather
than holding a stream open.

## A cash-out, end to end

1. `cash_capabilities`, then `cash_estimate` to price the amount and currency.
2. `cash_cashout` with the payee. Review `steps[]`, then sign and submit `txs[]`
   **in order** with the host wallet.
3. Poll `cash_order` with the `depositId` until it reaches `delivered`.

If `accessPolicyRequired` comes back true — Venmo, Cash App, and PayPal legs —
the order needs a follow-up policy transaction after `createDeposit` confirms.
That step uses `CashClient.finalizePreparedCashout` and
`CashClient.prepareAccessPolicy`, which are receipt- and signer-bound and so are
not exposed as tools here. A host that supports those platforms adds them
alongside its signer.

## What a production host must add

This server is stateless and unauthenticated by design, which is right for a
local stdio host and wrong for a shared one. Before exposing it to more than one
principal, bind orders to a user, authorize the wallet an agent may act for, and
rate-limit the prepare verbs. The chain is the database — `depositId` resumes
everything — but nothing here decides *whose* order it is.

## Checks

```bash
npm run typecheck
npm test
```
