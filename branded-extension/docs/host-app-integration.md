# Host app integration

How your web app talks to the extension. This is what you implement on your
site (one of your `appOrigins`).

## 1. Detect the extension

`window.peer` may be injected before or after your script runs. Handle both:

```ts
function getPeer(): Promise<typeof window.peer | null> {
  if (window.peer) return Promise.resolve(window.peer);
  return new Promise((resolve) => {
    const done = () => resolve(window.peer ?? null);
    window.addEventListener('peer#initialized', done, { once: true });
    // Fallback if it was already injected without an event you caught.
    setTimeout(() => resolve(window.peer ?? null), 1500);
  });
}
```

You can also check the page attributes synchronously:

```ts
const installed = document.documentElement.getAttribute('data-peer-injected') === 'true';
const vendor = document.documentElement.getAttribute('data-peer-vendor'); // e.g. "acme-verify"
```

Use `vendor` for host-app attribution only. **Do not gate functionality on a
specific vendor** — any extension implementing the protocol should work.

## 2. Connect

```ts
const peer = await getPeer();
if (!peer) {
  // Prompt the user to install your extension.
  return;
}

const status = await peer.checkConnectionStatus(); // 'connected' | 'disconnected' | 'pending'
if (status !== 'connected') {
  const approved = await peer.requestConnection(); // shows the in-page approval card
  if (!approved) return;
}
```

Origins listed in the extension's `appOrigins` are auto-approved, so on your own
domains `requestConnection()` resolves without a prompt.

## 3. Subscribe, then authenticate

Register the result listener **before** calling `authenticate`, because the
result is delivered asynchronously via the listener (the call itself returns
`void`).

```ts
const unsubscribe = peer.onMetadataMessage((data) => {
  // data: { requestId, platform, metadata[], expiresAt,
  //         errorMessage?, buyerTeeCapture?, sarCredentialCapture? }
  if (data.errorMessage) {
    // capture failed or was rejected by the user
    return;
  }
  // Hand data.buyerTeeCapture / data.sarCredentialCapture to your backend
  // for verification, keyed by data.requestId.
});

peer.authenticate({
  platform: 'venmo',           // which payment platform
  actionType: 'transfer',      // which provider action
  captureMode: 'buyerTee',     // 'buyerTee' | 'sellerCredential'
  attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
  providerConfig: { /* see below */ },
});

// later:
unsubscribe();
```

### `authenticate(params)`

| Field | Type | Notes |
| --- | --- | --- |
| `platform` | `string` | Payment platform key. Required. |
| `actionType` | `string` | Provider action key. Required. |
| `captureMode` | `'buyerTee' \| 'sellerCredential'` | Which encrypted capture pipeline to run. |
| `attestationServiceUrl` | `string \| null` | Defaults to the extension's configured attestation service. |
| `attestationActionType` | `string \| null` | Optional override for the attested action. |
| `providerConfig` | `ProviderSettings` | Optional. **If you pass it, pass a complete config** (see next section). If omitted, the extension fetches one from `${apiBaseUrl}/providers/<platform>/<actionType>.json`. |

## 4. Pass a COMPLETE inline `providerConfig` (or none)

`providerConfig` is **not merged** with a fetched template. It replaces it. If
you pass a partial object, capture will misbehave because the required fields
(`authLink`, the `metadata` matchers) will be missing. So either:

- **omit `providerConfig`** and let the extension fetch the canonical template
  from your API, or
- **pass a full `ProviderSettings`** including at least `authLink` and a complete
  `metadata` block (`platform`, `urlRegex`, and the click-guide fields).

```ts
// Minimal shape: every field the run needs must be present.
const providerConfig = {
  authLink: 'https://www.example-bank.com/login',
  metadata: {
    platform: 'venmo',
    urlRegex: 'https://api\\.example-bank\\.com/transactions\\?.*',
    // ...the remaining metadata fields your platform needs
  },
};
```

When in doubt, omit it and rely on the fetched template. That is the path the
extension is tuned for.

## Result delivery and consent

- Results arrive on **every** `onMetadataMessage` listener; filter by
  `data.requestId` if you run concurrent flows.
- For requests the user must explicitly approve, the extension shows an in-page
  confirmation before the result is shared with your page. A rejection arrives as
  a `data.errorMessage`, not a thrown error.
- `metadata` is an array of payment rows; the encrypted capture payloads you submit to your
  backend are in `buyerTeeCapture` / `sarCredentialCapture` depending on
  `captureMode`.

## TypeScript

Add an ambient declaration so `window.peer` is typed in your app:

```ts
declare global {
  interface Window {
    peer?: {
      requestConnection(): Promise<boolean>;
      checkConnectionStatus(): Promise<'connected' | 'disconnected' | 'pending'>;
      getVersion(): Promise<string>;
      authenticate(params: {
        platform: string;
        actionType: string;
        captureMode?: 'buyerTee' | 'sellerCredential';
        attestationServiceUrl?: string | null;
        attestationActionType?: string | null;
        providerConfig?: unknown;
      }): void;
      onMetadataMessage(cb: (data: {
        requestId: string;
        platform: string;
        metadata: Array<Record<string, unknown>>;
        expiresAt: number;
        errorMessage?: string;
        buyerTeeCapture?: unknown;
        sarCredentialCapture?: unknown;
      }) => void): () => void;
      logger: { enable(): void; disable(): void };
    };
  }
}
export {};
```
