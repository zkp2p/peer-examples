# Publishing to the Chrome Web Store

A checklist for shipping your rebranded extension. This covers packaging and the
listing. You own the store account, privacy policy, and data claims.

## 1. Finalize the brand

```bash
# edit brand.config.json (name, vendorId, theme, hostDomains, appOrigins, icons)
npm run rebrand
npm run typecheck && npm run test
```

Bump the version in `package.json` (the build stamps it into the manifest).
Versions must be increasing dotted integers, e.g. `1.0.0` to `1.0.1`.

## 2. Build and package

```bash
npm run release   # builds, then zips build/ into release/<name>-<version>.zip
```

The zip in `release/` is what you upload. Sanity-check it first by loading the
**unpacked** `build/` folder:

1. `chrome://extensions`
2. enable **Developer mode**
3. **Load unpacked** → select `build/`
4. confirm the popup, the connect flow on one of your `appOrigins`, and a full
   `authenticate` run on one of your `hostDomains`.

## 3. Create the listing

Use the templates in [`../templates/`](../templates/) as starting points:

- `store-listing.md` — name, summary, description, category.
- `privacy-policy.md` — host it on your domain and link it in the dashboard.
- `permission-justifications.md` — paste these into the dashboard's permission
  justification fields.

Assets you'll need to produce:

| Asset | Spec |
| --- | --- |
| Store icon | 128×128 PNG (you already have `icon-128.png`) |
| Screenshots | 1280×800 or 640×400 PNG, at least one |
| Small promo tile | 440×280 PNG (optional but recommended) |

## 4. Permissions review

Reviewers will ask why you need each permission. The honest answers:

- **`webRequest`** — observe (not block) the payment-platform responses that
  carry proof material during a user-initiated verification.
- **`tabs`** — open the payment-platform auth tab and return the user to their
  original tab.
- **`scripting`** — inject the capture click-guide and the success overlay into
  the auth tab.
- **`offscreen`** — run the encryption/proof bundling in a DOM-less document.
- **Host permissions** — only your supported payment platforms, your app
  origins, and the API + attestation endpoints. See
  [`host-permissions.md`](host-permissions.md).

Keep permissions narrow and explain each one in the dashboard. If you add a
host, update the justification before submitting.

## 5. Data disclosures

In the dashboard's privacy section, the truthful posture for this kit:

- **Does not collect** authentication information, personal communications,
  location, web history, or user activity for the extension's own purposes.
- Captured payment material is **encrypted on-device** and submitted to the
  attestation service to produce a verification result; it is not sold and not
  used for tracking.
- The extension uses **no analytics or telemetry**.

Make sure these statements match what you actually ship. See
[`security-invariants.md`](security-invariants.md). If you add any data flow,
update the disclosures and the privacy policy.

## 6. Submit

Upload the zip, fill the listing, set visibility, and submit for review. First
reviews can take a few days. Keep `release/` artifacts so you can correlate a
store version with a build.
