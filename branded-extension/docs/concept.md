# Concept: the `window.peer` interface

This extension puts one object on the page: `window.peer`. It is the
**protocol global** for privacy-preserving payment verification. Any web page
can feature-detect it and drive a verification flow without knowing which
branded extension is installed.

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
| **Offscreen** (DOM-less document) | `entries/Offscreen/*` | Runs metadata extraction and request replay in an isolated document. |

The shared **capture/metadata engine** lives in `utils/` (`metadataEngine.ts`,
`offscreenHelpers.ts`, `buyerTeePaymentCapture.ts`,
typed message channels under `utils/types/messages/`).

## Capture flow (one run)

1. The page calls `peer.authenticate({ platform, actionType, ... })`.
2. Content script ensures the origin is connected (prompting if needed), then
   forwards to background.
3. Background resolves a **provider config**: either the complete one you passed
   inline, or one fetched from `${apiBaseUrl}/providers/<platform>/<actionType>.json`.
4. Background opens an empty auth tab, arms `webRequest` interceptors and
   sign-in recovery, then navigates to the provider's authentication URL.
5. When the matching request is seen, the captured material is handed to the
   offscreen document, **encrypted**, and submitted to the attestation service.
6. The attested result is posted back to the page; your
   `onMetadataMessage` callback fires.

## Capture capabilities

Without `captureMode`, the JSON engine returns transaction metadata.
`captureMode: 'buyerTee'` encrypts session material for buyer-side payment
verification through the SDK. Both paths use the configured JSON template.

`captureMode: 'sellerCredential'` is rejected before template fetch or tab
creation. Seller credential capture requires a sandboxed capture-program hook;
this example does not include that runtime. There are no embedded seller
parsers or seller-bundle worker routes. Hosted capture JS and capture-program
plugins are also outside this example's capabilities.

Cross-tab OAuth recovery lives in `entries/Background/signInResume.ts`. It
correlates navigation only for an active capture and keeps that state in memory.
See the README for callback-origin and host-permission prerequisites.

## Where branding stops and the protocol begins

- **Protocol (do not rename):** `window.peer`, the `peer#initialized` event, the
  `data-peer-injected` / `data-peer-vendor` attributes, the message `type`
  strings, the SDK encryption calls.
- **Brand (yours to change):** name, icons, theme colors, vendor id, which
  domains you support, and the API/attestation endpoints. These all live in
  `brand.config.json`.
