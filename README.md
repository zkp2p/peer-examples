# Peer Examples

Integration examples for **Peer**, the protocol for privacy-preserving payment
verification. Clone the repo, open an example, and follow its README.

## Examples

| Example | What it is |
| --- | --- |
| [`branded-extension/`](branded-extension/) | A brand-neutral browser extension that injects `window.peer` and runs the payment-capture + verification pipeline. Fork it, edit one config file, and re-skin it into your own extension. |
| [`mpp-merchant-cashout/`](mpp-merchant-cashout/) | A merchant server that takes Base USDC revenue over MPP and prepares unsigned Peer Cash cash-out plans after settlement. The planner is localhost-only, holds no keys, and never signs. |

Each example is self-contained in its top-level folder with its own README and
dependencies; nothing at the repo root is shared state.

Peer's canonical CLI, MCP server, and custody-separated `peer_cash_*` tools now
live in [`zkp2p/peer-cli`](https://github.com/zkp2p/peer-cli). Use the
[`cash` profile documentation](https://agents.peer.xyz/docs/reference/peer-cash)
instead of copying the retired standalone server example.

## License

[MIT](LICENSE).
