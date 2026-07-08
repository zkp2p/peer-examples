# Peer Cash React Demo

Small Vite app that shows the maker-side Peer Cash loop with the published
`@zkp2p/cash` package:

1. Connect an injected wallet on Base.
2. Estimate an indicative fiat receive amount from the live oracle (final pricing resolves at fill, never a locked quote).
3. Create a protocol-held cash-out deposit.
4. Load the connected wallet's cash-outs.
5. Poll order state and withdraw when `nextActions` allows it.

The app is production-only. It submits real transactions, so use a funded Base
wallet and a real handle for platforms that validate accounts.

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
