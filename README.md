# Peer Examples

An integration example for **Peer**, the protocol for privacy-preserving
payment verification. Clone the repo, open the example, and follow its README.

`window.peer` is the protocol's page-level global for payment verification.
This example shows how to ship it, how to talk to it, and how to build on top
of it.

## Example

| Example | What it is |
| --- | --- |
| [`branded-extension/`](branded-extension/) | A brand-neutral browser extension that injects `window.peer` and runs the payment-capture + verification pipeline. Fork it, edit one config file, and re-skin it into your own extension. |

The example is self-contained in its top-level folder with its own README and
dependencies; nothing at the repo root is shared state.

## License

[MIT](LICENSE).
