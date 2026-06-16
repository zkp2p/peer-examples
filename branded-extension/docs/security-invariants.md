# Security invariants

These are the properties that make this extension safe to install and to ship.
Rebranding **must not** break any of them. Treat this list as a review checklist
before every release.

If you want to change something here to add a feature, stop and reconsider. This
page covers the properties users and reviewers rely on.

## Do not touch: capture & encryption internals

The capture-and-encryption pipeline is the security boundary. Leave it alone
unless you are deliberately extending the protocol.

- **Encryption happens in the offscreen document** (`entries/Offscreen/*`) using
  the Peer SDK. Captured material is encrypted before it leaves the device. Do
  not move encryption into the page, the content script, or a remote call, and
  do not log decrypted material.
- **Request matching is allow-listed.** Background only acts on requests that
  match the active provider config (`providerRequestMatcher.ts`); everything else
  is ignored. Do not widen the match to "capture everything."
- **`webRequest` observes, it never blocks.** There is no `webRequestBlocking`
  and no request modification. Keep it that way.
- The SDK encryption calls (`createEncryptedBuyerTeeSessionMaterial`,
  `apiCreateSellerCredentialBundle`) are the protocol. Don't reimplement or
  bypass them.

## Stateless and tab-scoped

- A capture run lives in an **in-memory map keyed by the auth tab id**
  (`sessionsByAuthTabId` in `entries/Background/index.ts`). When the tab closes
  or the run finishes, the session is deleted (`cleanupSession`).
- There is **no `storage` permission** and the code uses **no `chrome.storage`,
  `localStorage`, `sessionStorage`, or `indexedDB`.** Nothing about a run
  survives a browser restart. Keep it that way; persisting captured material or
  credentials would turn a transient capture into a stored secret.

## No stored secrets, no keys

- The extension bundles **no API keys, tokens, private keys, or witness/admin
  endpoints.** The only endpoints it knows are the **public** API base and
  attestation service, and they live in `brand.config.json` as plain
  configuration.
- If your deployment needs a key for your own backend, do not hardcode it here.
  Keep the extension keyless; authenticate at your backend instead.

## No telemetry

- The extension ships **no analytics, tracking, or telemetry.** `logger` only
  writes to the console, and only in development builds.
- The `data-peer-vendor` page attribute exists so your *host app* can record
  which extension served a session. It is set on the page, not phoned home by
  the extension.
- The only network calls the extension makes are: fetching the **provider
  template** from your API, **replaying the captured request** when a provider
  flow requires it, and submitting encrypted session material to the attestation
  service. If you add another endpoint, justify it in your privacy policy and
  store listing.

## Permissions stay minimal

- Requested permissions are exactly: `offscreen`, `webRequest`, `tabs`,
  `scripting`. Don't add `storage`, `cookies`, `<all_urls>`, `webRequestBlocking`,
  `declarativeNetRequest`, or `nativeMessaging` without a concrete, reviewable
  reason.
- Host permissions are narrowed to your configured domains. See
  [`host-permissions.md`](host-permissions.md).

## The protocol surface is fixed

Renaming these breaks interoperability with host apps and other extensions that
implement the protocol:

- the `window.peer` global and its method names,
- the `peer#initialized` event,
- the `data-peer-injected` and `data-peer-vendor` attributes,
- the message `type` / `action` strings in `utils/types/messages/`.

`vendorId` is the *value* of `data-peer-vendor` and is yours to set. The
attribute *name* is not.

## Pre-release checklist

- [ ] `host_permissions` in `build/manifest.json` contains only your domains +
      the API/attestation origins.
- [ ] No new entries in `permissions`.
- [ ] No `chrome.storage` / `localStorage` / network calls added beyond the two
      above.
- [ ] No secrets, keys, or non-public endpoints committed.
- [ ] `npm run typecheck && npm run test` pass.
