// Stable entry point for brand configuration.
//
// Everything in the extension imports `BRAND` from here. The actual values live
// in `brand.generated.ts`, which is produced by `scripts/rebrand.mjs` from
// `brand.config.json`. Never edit the generated file by hand — edit
// `brand.config.json` and re-run `npm run rebrand`.
export { BRAND } from './brand.generated';
export type { Brand, BrandTheme } from './brand.generated';
