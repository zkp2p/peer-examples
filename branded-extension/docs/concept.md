# Concept: the `window.peer` interface

This extension puts one object on the page: `window.peer`. It is the
**protocol global** for privacy-preserving payment verification, analogous to
`window.ethereum` for wallets. Any web page can feature-detect it and drive a
verification flow without knowing which branded extension is installed.

## The interface

The injected script defines a frozen `window.peer` (see
`src/entries/Content/injectScript.ts`):

```ts
interface Peer {
  // Ask the user to connect this site to the extension. Resolves true if approved.
  requestConnection(): Promise<boolean>;

  // Current connection state for this origin.
  checkConnectionStatus(): Promise<'connected' | 'disconnected' | 'pending'>;

  // Installed extension version.
  getVersion(): Promise<string>;

  // Start a capture + verification run (see host-app-integration.md).
  authenticate(params: {
    actionType: string;
    platform: string;
    attestationServiceUrl?: string | null;
    attestationActionType?: string | null;
    captureMode?: 'buyerTee' | 'sellerCredential';
    providerConfig?: ProviderSettings; // pass a COMPLETE inline config
  }): void;

  // Subscribe to verification results. Returns an unsubscribe function.
  onMetadataMessage(cb: (data: MetadataMessagePayload) => void): () => void;

  // Opt-in debug logging.
  logger: { enable(): void; disable(): void };
}
```

Two page attributes are also set on `<html>`:

- `data-peer-injected="true"` — the protocol global is present.
- `data-peer-vendor="<vendorId>"` — which branded extension served it (set from
  `brand.config.json`). Use it for host-app attribution only; never
  gate functionality on a specific vendor.

`window.peer` is defined **defer-if-present**: if another extension already
defined it, this one yields. Both implement the same protocol, so the page works
either way.

## The pieces

The extension is four cooperating contexts. None of them is brand-specific;
branding is injected from `brand.config.json` at the edges only.

| Context | File(s) | Responsibility |
| --- | --- | --- |
| **Injected script** (page MAIN world) | `entries/Content/injectScript.ts` | Defines `window.peer`, relays page ⇄ content messages over `window.postMessage`. |
| **Content script** (isolated world) | `entries/Content/index.ts`, `connectionApproval.ts`, `approvalPopup.ts` | Injects the page script, shows the connect/confirm approval UI, bridges page ⇄ background. |
| **Background** (service worker) | `entries/Background/*` | Opens the auth tab, intercepts the right network requests (`webRequest`), runs the capture flows, drives the in-tab auth overlay. |
| **Offscreen** (DOM-less document) | `entries/Offscreen/*` | Does the encryption / proof bundling that needs DOM crypto APIs but no UI. |

The shared **capture/metadata engine** lives in `utils/` (`metadataEngine.ts`,
`offscreenHelpers.ts`, `buyerTeePaymentCapture.ts`, `sarCredentialBundle.ts`,
typed message channels under `utils/types/messages/`).

## Capture flow (one run)

1. The page calls `peer.authenticate({ platform, actionType, ... })`.
2. Content script ensures the origin is connected (prompting if needed), then
   forwards to background.
3. Background resolves a **provider config**: either the complete one you passed
   inline, or one fetched from `${apiBaseUrl}/providers/<platform>/<actionType>.json`.
4. Background opens the platform's auth tab and arms `webRequest` interceptors
   for the URLs the provider config names.
5. When the matching request is seen, the captured material is handed to the
   offscreen document, **encrypted**, and submitted to the attestation service.
6. The attested result is posted back to the page; your
   `onMetadataMessage` callback fires.

## Two capture modes

`captureMode` selects how proof material is produced:

- **`buyerTee`** — TEE session-material capture for a buyer-side payment.
- **`sellerCredential`** — seller-credential bundle capture.

Platform-specific parsing for `sellerCredential` lives in
`entries/Background/sarCredentialCapture.ts`. The kit ships two worked examples
there. **Adding a platform means adding a parser there plus a provider template**;
it does not require touching the engine. The `buyerTee` path is fully
provider-config driven.

## Where branding stops and the protocol begins

- **Protocol (do not rename):** `window.peer`, the `peer#initialized` event, the
  `data-peer-injected` / `data-peer-vendor` attributes, the message `type`
  strings, the SDK encryption calls.
- **Brand (yours to change):** name, icons, theme colors, vendor id, which
  domains you support, and the API/attestation endpoints. These all live in
  `brand.config.json`.
