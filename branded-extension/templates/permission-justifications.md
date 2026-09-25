<!--
  Permission justifications for the Chrome Web Store dashboard. Paste each into
  the matching field. Replace {{PLACEHOLDER}}s. Keep them honest: they must match
  what the Extension actually does (../docs/security-invariants.md).
-->

# {{EXTENSION_NAME}} permission justifications

## Single purpose

{{EXTENSION_NAME}} has one purpose: to let a user prove a payment to
{{WEBSITE}} in a privacy-preserving way, by capturing and encrypting session
material on the user's device and returning only the verification result.

## `webRequest`

Used to observe (not block or modify) the specific payment-provider network
responses that contain the transaction the user is verifying. The Extension acts
only on requests matching the active provider configuration and ignores all
others. It does not use `webRequestBlocking`.

## `tabs`

Used to open the payment provider's authentication page in a new tab during a
verification the user initiated, and to return the user to their original tab
when the run completes.

## `scripting`

Used to inject the on-page capture helper (a click-guide that points the user to
the right transaction) and a success overlay into the provider tab during a
verification run.

## `storage`

Used to retain only plugin JSON approved for a specific requesting origin and
third-party connected-site origins. Captured requests, responses, credentials,
payment values, and session material are never persisted. Users can remove
grants in Settings.

## `offscreen`

Used to run capture encryption and credential bundling in a offscreen
document. Encryption is performed on-device before any session material is
transmitted.

## Host permissions

The Extension requests access only to:

- the payment platforms it supports ({{SUPPORTED_PLATFORMS}}), to capture session
  material during a verification the user starts;
- your application origin ({{WEBSITE}}), where the `window.peer` interface is
  exposed to the page;
- the API and attestation endpoints ({{API_BASE_URL}}, {{ATTESTATION_SERVICE_URL}})
  to fetch verification configuration and submit encrypted session material.

It does not request broad host access (no `<all_urls>`).

## Local capture plugins

The host application may supply a capture plugin JSON object containing source
for `match`, `capture`, and optional `interact` hooks. After exact-origin user
approval, the Extension runs it in the packaged QuickJS sandbox with no DOM,
network, storage, or extension API access. The Extension never fetches plugin
source from the API. The API registry supplies review hashes only. Review this
capability against the current store policy before submission.

## Data usage certification

- Does not sell or transfer user data to third parties beyond the approved
  verification flow.
- Does not use or transfer user data for purposes unrelated to the single
  purpose above.
- Does not use or transfer user data to determine creditworthiness or for
  lending.
