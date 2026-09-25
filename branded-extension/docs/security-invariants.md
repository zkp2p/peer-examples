# Security invariants

Rebranding must preserve these boundaries. Review them before each release.

## Capture and encryption

- Captured session material stays in memory and is encrypted in the offscreen
  document before it leaves the device. Never log or persist it.
- The legacy path uses only the configured provider template. An explicit local
  plugin path never falls back to that template. Matching runs before response
  replay; unrelated traffic is ignored.
- A plugin runs in the manifest sandbox with no DOM, network, storage,
  filesystem, timers, or `chrome.*`. Only bounded `match`, `capture`, and
  `interact` results cross to the privileged host. The host validates origins,
  replay targets, GraphQL queries, navigation, and page actions.
- `webRequest` observes requests and never blocks or modifies them.

## Stored state

`chrome.storage.local` stores only approved plugin JSON and third-party
connection origins. Access is restricted to trusted extension contexts. It
never stores requests, responses, cookies, credentials, payment values, capture
output, or proof history. A capture session is tab-scoped memory and is removed
when it completes or the tab closes.

## Plugin consent

- Every new or changed plugin requires approval for the exact requesting
  origin, including scheme, subdomain, and port. The extension computes the
  digest itself and checks the configured API's plugin registry. Website claims
  of trust are ignored.
- A matching registry hash is a disclosure, not automatic consent. Unknown
  hashes and failed registry requests require explicit risk acknowledgement.
- Plugin origins must be HTTPS origins covered by `hostDomains`. Rebrand before
  installing plugins for a new provider. Settings can remove each site's grant.

## Permissions and endpoints

- `host_permissions` come from configured provider, app, API, and attestation
  origins. Keep them narrow; do not add `<all_urls>`, blocking webRequest, or
  cookies permission.
- Runtime endpoints come from `brand.config.json`. No API keys, tokens, or
  private service URLs belong in the extension.
- No analytics or remote plugin source loading. The registry contains hashes
  only; provider replay and encrypted attestation calls are part of capture.

## Protocol surface

The `window.peer` global, `peer#initialized` event, `data-peer-injected` and
`data-peer-vendor` attributes, and message action names remain fixed for host
interoperability. Set only the vendor *value* through `brand.config.json`.

## Pre-release check

Run `npm run rebrand && npm run typecheck && npm run test && npm run build`.
Inspect `build/manifest.json` for the expected host domains, sandbox page,
settings page, and `storage` permission.
