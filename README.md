# Peer Examples

A collection of integration examples for **Peer**, the protocol for
privacy-preserving payment verification. Each example is self-contained: clone
the repo, open the example you need, follow its README.

`window.peer` is the protocol's page-level global for payment verification.
These examples show how to ship it, how to talk to it, and how to build on top
of it.

## Examples

| Example | What it is |
| --- | --- |
| [`branded-extension/`](branded-extension/) | A brand-neutral browser extension that injects `window.peer` and runs the payment-capture + verification pipeline. Fork it, edit one config file, and re-skin it into your own extension. |
| [`peer-cash-react/`](peer-cash-react/) | A Vite React app that creates a production Peer Cash cash-out with `@zkp2p/cash` and tracks the connected wallet's orders. |

Each example is a top-level folder with its own README and dependencies; nothing
at the repo root is shared state. More examples will be added as siblings.

## License

[MIT](LICENSE).
