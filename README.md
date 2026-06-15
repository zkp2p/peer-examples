# Peer Examples

A collection of integration examples for **Peer** — the protocol for
privacy-preserving payment verification. Each example is self-contained: clone
the repo, open the example you need, follow its README.

`window.peer` is the protocol's page-level global (the same way `window.ethereum`
is for wallets). These examples show how to ship it, how to talk to it, and how
to build on top of it.

## Examples

| Example | What it is |
| --- | --- |
| [`branded-extension/`](branded-extension/) | A complete, brand-neutral browser extension that injects `window.peer` and runs the payment-capture + verification pipeline. Fork it, edit one config file, and re-skin it into your own branded extension in a few minutes. |

## Coming next

More examples will land alongside `branded-extension/` as siblings, e.g.:

- **`host-app-integration/`** — a minimal web app that detects `window.peer` and
  drives an `authenticate()` → `onMetadataMessage()` verification flow.
- **`sdk-usage/`** — server- and client-side use of the Peer SDK.

Each new example is a top-level folder with its own README and dependencies;
nothing at the repo root is shared state.

## License

[MIT](LICENSE).
