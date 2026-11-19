<!--
  Privacy policy template. Replace every {{PLACEHOLDER}}, review with someone who
  can speak to your actual data handling, host it at a public URL, and link it in
  the Chrome Web Store dashboard. This is a starting point, not legal advice.

  Only keep statements that remain true for YOUR build. If you add a data flow,
  document it here (see ../docs/security-invariants.md).
-->

# {{EXTENSION_NAME}} Privacy Policy

_Last updated: {{LAST_UPDATED}}_

{{COMPANY}} ("we") operates the {{EXTENSION_NAME}} browser extension (the
"Extension"). This policy explains what the Extension does and does not do with
your data.

## Summary

The Extension helps you prove a payment to {{WEBSITE}} without sharing your
banking credentials. It processes payment data **locally on your device**,
encrypts buyer session material for {{ATTESTATION_SERVICE_URL}}, and returns
it with payment details to {{WEBSITE}} for verification. We do not sell your data and we do not track you.

## What the Extension accesses

To verify a payment you initiate, the Extension:

- Opens your payment provider in a browser tab and observes the specific network
  requests used to identify the payment.
- Encrypts the relevant session material **on your device** before any
  transmission.
- Returns payment rows and the encrypted session to {{WEBSITE}}, which submits
  the selected payment for verification by {{ATTESTATION_SERVICE_URL}}.
- For seller credential capture, obtains an encrypted credential bundle from
  the service and returns the bundle and seller identifier to {{WEBSITE}}.

The Extension only runs this process on the sites it supports
({{SUPPORTED_PLATFORMS}}) and your application origin ({{WEBSITE}}).

## What we do NOT do

- The host page receives encrypted session material. Your plaintext login
  session is not included in the capture result.
- We do **not** persist your payment data. A verification run is held in memory
  for the duration of that run and discarded afterward; the Extension uses no
  local storage and nothing survives a browser restart.
- We do **not** include analytics, telemetry, or tracking of any kind.
- We do **not** sell, rent, or share your personal data with third parties for
  advertising.

## Data we transmit

Payment rows shared with {{WEBSITE}} can include amounts, dates, recipients and
payment identifiers. The encrypted buyer session is intended for
{{ATTESTATION_SERVICE_URL}}. Seller credential capture shares a credential
bundle and seller identifier with {{WEBSITE}}.

## Permissions

The Extension requests the minimum permissions needed to perform verification:
observing payment-provider responses, opening and returning tabs, injecting the
on-page capture helper, and extracting metadata and preparing seller credentials in an isolated document. See our
store listing for the per-permission justification.

## Your choices

- Uninstalling the Extension removes it and any in-memory state immediately.
- You can decline any connection or capture prompt; the Extension does nothing
  without your action.

## Changes

We will update this policy if the Extension's data handling changes, and revise
the "Last updated" date above.

## Contact

Questions: {{SUPPORT_EMAIL}}
