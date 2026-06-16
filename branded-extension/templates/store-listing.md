<!--
  Store listing template. Replace every {{PLACEHOLDER}} and delete this comment.
  Keep claims truthful and consistent with your privacy policy and the
  extension's actual behavior (see ../docs/security-invariants.md).
-->

# {{EXTENSION_NAME}} Chrome Web Store listing

## Name (≤ 45 chars)

{{EXTENSION_NAME}}

## Summary (≤ 132 chars)

Verify your payments privately. Prove a payment happened without sharing
passwords, cookies, or screenshots.

## Category

Productivity (or Finance, if available in your locale)

## Description

{{EXTENSION_NAME}} lets you prove a payment to {{WEBSITE}} without handing over
your banking login or sharing screenshots.

When {{WEBSITE}} asks you to verify a payment, {{EXTENSION_NAME}} opens your
payment provider, helps you find the right transaction, and creates a
encrypted verification payload on your own device. Only the verified result is
shared back with {{WEBSITE}}. Your credentials never leave your browser.

**Why it's safe**

- Your passwords, cookies, and session data never leave your device.
- Proof material is encrypted locally before anything is sent.
- No analytics, no tracking, no selling your data.
- Works only on the sites it needs: {{SUPPORTED_PLATFORMS}} and {{WEBSITE}}.

**How it works**

1. {{WEBSITE}} asks you to verify a payment.
2. {{EXTENSION_NAME}} opens your payment provider in a new tab.
3. You confirm the transaction; the extension captures and encrypts the session material.
4. The verified result is returned to {{WEBSITE}}.

Built on the open Peer protocol for privacy-preserving payment verification.

## Support

- Website: {{WEBSITE}}
- Support: {{SUPPORT_EMAIL}}
- Privacy policy: {{PRIVACY_POLICY_URL}}
