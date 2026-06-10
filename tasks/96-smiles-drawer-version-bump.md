# Task 96 — Bump bundled smiles-drawer 2.1.7 → 2.3.0

> **Status:** 📋 TODO (low-risk minor; verify a molecule renders). Vditor bundles smiles-drawer
> **~2.1.7** (its `?v=2.1.7` loader label); latest is **2.3.0** (npm `latest` = GitHub release
> v2.3.0, 2026-04-30). Single-file UMD swap (Lute/Mermaid pattern) — same major, so unlike
> ECharts/abcjs this is a safe minor bump.
> **Source:** renderer-version audit (the `vmarkd-renderer-theming` skill); user request.
> **Correction:** an earlier pass mis-read the bundle's `version="2.4.2"` as smiles-drawer — that
> string is **chroma.js** (an embedded dependency: `chroma$k.version="2.4.2"`). The real bundled
> smiles-drawer is ~2.1.7, so a bump IS available (not "already newer").
> **Value / Risk:** 🟢 fixes / low — same-major minor, single global UMD file, `?v=` present.

## Problem
`media/vditor/dist/js/smiles-drawer/smiles-drawer.min.js` is loaded by `SMILESRender.ts` as
`smiles-drawer.min.js?v=2.1.7` (global UMD; `new SmiDrawer({}, {})` + `sd.draw(code, '#'+id,
theme)`). Latest is **2.3.0**. No independent version control today.

## Approach (mirror `syncMermaid` — see the skill)
1. **Confirm artifact** — `smiles-drawer@2.3.0` standalone/global build that exposes the global
   (`SmiDrawer`/`SmilesDrawer`) with `draw(code, selector, theme)` (head/tail check, like the
   Mermaid global check). Use the dist build Vditor expects (`smiles-drawer.min.js`).
2. **Vendor** `media-src/vendor/smiles-drawer/{smiles-drawer.min.js,source.json,LICENSE,NOTICE}`
   (smiles-drawer is **MIT**; verify + ship LICENSE/NOTICE). `source.json` = version + sha256.
   Re-pin helper `media-src/scripts/fetch-smiles-drawer.mjs` (mirror `fetch-mermaid.mjs`).
3. **build.mjs `syncSmilesDrawer()`** — after `syncVditorAssets()`, sha-verify + copy over
   `media/vditor/dist/js/smiles-drawer/smiles-drawer.min.js` (+ LICENSE/NOTICE into `media/`).
4. **Cache-buster** — bump the existing `?v=2.1.7` → `?v=<version>` via an esbuild patch
   (`fixSmilesVersion`, mirror `fixMermaidVersion`) so a stale webview can't serve old bytes.

## Tests (per AGENTS)
- **`test/backend/smiles-pin.test.ts`** — sha/version/global-build + MIT notice guards
  (mirror `mermaid-pin.test.ts`).
- **e2e** — a `\`\`\`smiles` block renders a structure (non-empty `<svg>`/`<canvas>`) on the
  bumped build; loaded script src carries the new `?v=`.
- **Fidelity note** — eyeball a molecule (e.g. caffeine `CN1C=NC2=C1C(=O)N(C(=O)N2C)C`) 2.1.7
  vs 2.3.0; record here.

## See also
- Skill `vmarkd-renderer-theming` (global-UMD check, overwrite-after-sync, `?v=` patch; the
  chroma.js mis-read is the cautionary tale).
- Task 86 (`syncMermaid`/`fixMermaidVersion` precedent), task 97 (smiles theming — builds on this).
- `media-src/node_modules/vditor/src/ts/markdown/SMILESRender.ts`.
