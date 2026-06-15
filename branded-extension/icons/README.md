# Icons

Replace these four placeholder PNGs with your own brand icons, then run
`npm run rebrand` to copy them into `src/assets/` (the build reads them from
there).

| File          | Size      | Used for                                  |
| ------------- | --------- | ----------------------------------------- |
| `icon-16.png` | 16×16     | favicon-scale toolbar / context menu      |
| `icon-32.png` | 32×32     | Windows / retina toolbar                   |
| `icon-48.png` | 48×48     | extensions management page, popup mark     |
| `icon-128.png`| 128×128   | Chrome Web Store, install dialog, auth overlay |

Guidelines:

- **Square, transparent PNG.** Keep the artwork inside the canvas with a little
  padding so it is not clipped when Chrome rounds the corners.
- **Provide all four sizes.** Don't upscale a small icon; export each size from
  a vector source for crisp edges.
- **128×128 is the most visible** (store listing + install dialog); make it the
  cleanest.

`brand.config.json` → `iconDir` controls which folder `rebrand` reads from
(default: this `icons/` folder).
