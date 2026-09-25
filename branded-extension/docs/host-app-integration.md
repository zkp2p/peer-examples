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
  const approved = await peer.requestConnection(); // opens an extension-owned approval window
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
  platform: 'example',         // provider key
  actionType: 'transfer',      // provider action
  captureMode: 'buyerTee',     // 'buyerTee' | 'sellerCredential'
  attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
});

// later:
unsubscribe();
```

### `authenticate(params)`

| Field | Type | Notes |
| --- | --- | --- |
| `platform`, `actionType` | `string` | Required provider key and action. |
| `captureMode` | `'buyerTee' \| 'sellerCredential'` | Omit for metadata-only capture. |
| `attestationServiceUrl` | `string \| null` | Must match the endpoint in `brand.config.json` for Buyer TEE. |
| `capturePlugin` | plugin JSON | Optional explicit local plugin; replaces the template path. Its `id` must equal `<platform>/<actionType>`. |
| `captureParams` | flat values | Optional verifier match values passed to the plugin. |
| `initialAction` | object | Optional symbolic page actions and inputs. |

When `capturePlugin` is omitted, the extension fetches the template at
`${apiBaseUrl}/providers/<platform>/<actionType>.json`. Inline
`providerConfig` is no longer accepted.

A plugin has `id`, `name`, `authLink`, `origins`, `shouldSkipCloseTab`, and
`source` fields; optional `focusOnOpen: false` starts a background tab.
`source` defines a required `match({ request, params })` and a
`capture({ event, params })` function. Optional `interact({ inputs, url })` can
request bounded page actions. The extension runs these functions in a local
QuickJS sandbox. The host controls replay, navigation, queries, and page actions.

A plugin may target only HTTPS provider origins already included in
`brand.config.json` `hostDomains`. Each requesting origin approves each new or
changed plugin digest in the extension-owned prompt. A registry match labels the
plugin verified, but does not skip approval. Unknown hashes require explicit
risk acknowledgement. Users can remove installs in extension Settings.

## Result delivery and consent

- Results arrive on **every** `onMetadataMessage` listener; filter by
  `data.requestId` if you run concurrent flows.
- Plugin install and third-party connection requests use extension-owned approval.
  A rejection arrives as `data.errorMessage`, not a thrown error.
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
        capturePlugin?: {
          id: string; name: string; authLink: string; origins: string[];
          shouldSkipCloseTab: boolean; focusOnOpen?: boolean; source: string;
        };
        captureParams?: Record<string, string | number | boolean>;
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
