# Peer Cash React Demo

Small Vite app that shows the maker-side Peer Cash loop with the published
`@zkp2p/cash@0.1.3` package:

1. Connect an injected wallet on Base.
2. Pick Base USDC or a Relay-supported EVM source asset.
3. Estimate the indicative fiat receive amount and historical `estimate().eta`.
4. Create a protocol-held cash-out deposit.
5. Load the connected wallet's cash-outs.
6. Poll order state and withdraw when `nextActions` allows it.

The app is production-only. It submits real transactions, so use a funded Base
wallet and a real handle for platforms that validate accounts. Non-Base source
assets are routed through Relay into Base USDC before the Peer Cash order is
created.

Live demo: https://react-cashout-demo.vercel.app

```bash
bun install
bun run dev
```

Build for Vercel:

```bash
bun run build
```

## Links

- SDK on npm: https://www.npmjs.com/package/@zkp2p/cash
- SDK source: https://github.com/zkp2p/peer-cash
- Product page: https://peer.xyz/cash
