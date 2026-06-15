# Host permissions: how to narrow them, and why

Manifest V3 store review punishes broad host permissions. An extension that
requests `https://*/*` will be slow to approve, flagged for justification, and
scary in the install dialog ("read and change all your data on all websites").
This kit is built to request **only the domains you actually need**, and to
derive them from one config file.

## The three buckets

`brand.config.json` splits the domains the extension touches into three groups,
and `rebrand` assembles them into the manifest:

| Config field | Example | What it grants |
| --- | --- | --- |
| `hostDomains` | `https://*.example-bank.com/*` | Payment-platform sites where the **capture click-guide** runs during an auth flow. Content script: `txClickGuideLoader` only. |
| `appOrigins` | `https://app.acme-verify.example/*` | **Your** web app origins that may use `window.peer`. Content script: `contentScriptLoader` (the full injection). Also auto-approved for connection. |
| `apiBaseUrl` + `attestationServiceUrl` | `https://api.zkp2p.xyz` | Backend `fetch` targets (provider templates + attestation). Added to `host_permissions` only — no content script. |

`rebrand` writes them into three manifest sections:

- `content_scripts` — `hostDomains` get the click-guide; `appOrigins` get the
  `window.peer` injection.
- `web_accessible_resources.matches` — `hostDomains` + `appOrigins`.
- `host_permissions` — `hostDomains` + `appOrigins` + the API and attestation
  origins.

## Rules of thumb

1. **List exact platforms, never `*://*`.** Use one wildcard per platform host
   (`https://*.example-bank.com/*`), not a global match. If you support five
   payment platforms, that's five entries — and a reviewer can read every one.
2. **`window.peer` belongs only on your app.** It is injected on `appOrigins`
   only, not on the payment platforms. Payment platforms get the capture
   click-guide and nothing else.
3. **Keep the backend origins explicit.** The extension `fetch`es provider
   templates and submits to the attestation service; those two origins must be
   in `host_permissions` or the calls fail. They are added automatically from
   `apiBaseUrl` / `attestationServiceUrl`.
4. **Don't add `<all_urls>` "to be safe."** If a capture needs a new platform,
   add that platform to `hostDomains` and re-run `rebrand`. Breadth is a
   liability, not a convenience.

## Checking what you ship

After `npm run rebrand && npm run build`, inspect `build/manifest.json` and
confirm `host_permissions` contains only:

- your payment-platform hosts,
- your app origins,
- the API + attestation origins.

If you see anything broader, fix `brand.config.json` rather than editing the
generated manifest (it will be overwritten on the next rebrand).

## A note on `webRequest`

The extension uses the `webRequest` permission to observe the responses that
carry proof material during an auth run. It observes; it does not block (no
`webRequestBlocking`). Captured requests are matched against the patterns in the
active provider config and discarded otherwise — see
`entries/Background/providerRequestMatcher.ts`.
