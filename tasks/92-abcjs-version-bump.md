# Task 92 — Bump bundled abcjs 5.10.3 → 6.x

> **Status:** 📋 TODO — **verify render first** (major 5→6). Vditor bundles **abcjs 5.10.3
> (2019)**; latest is **6.6.3 (2026)**. Vendor the newer build over Vditor's copy (Lute/
> Mermaid pattern). Brings ~7 years of fixes AND unblocks abc theming (`foregroundColor`,
> absent in 5.10.3 — see task 93).
> **Source:** renderer-version audit (the `vmarkd-renderer-theming` skill); user request.
> **Value / Risk:** 🟡 fixes + unblocks theming / **medium** — major version; abcjs 6
> repackaged (ESM-first), so confirm the global UMD bundle + render fidelity.

## Problem
`media/vditor/dist/js/abcjs/abcjs_basic.min.js` is **abcjs_basic v5.10.3** (Copyright 2009-2019),
loaded by `abcRender.ts` as `abcjs_basic.min.js` — **no `?v=` cache-buster**. Latest is **6.6.3**.
Vditor calls `ABCJS.renderAbc(item, code)` (global UMD). We have no independent version control.

## Why bump (not just "newer")
1. **5.10.3 is from 2019** — 6.x is 7 years of fixes.
2. **Unblocks theming (task 93).** abc renders black-on-transparent and ignores the theme; the
   fix is `renderAbc(el, text, { foregroundColor })`. The bundled 5.10.3 shows **no
   `foregroundColor`** (only `format`), so theming realistically needs v6. → do this first.

## Compatibility (the risk)
- `ABCJS.renderAbc(target, source, params)` is stable across 5→6, BUT **abcjs 6 repackaged**
  (ESM-first; the standalone global bundle moved/renamed). **Spike step:** confirm which v6
  artifact is the global UMD `ABCJS` build (e.g. `dist/abcjs-basic-min.js`) and that loading it
  via `addScript` still defines `window.ABCJS` with `renderAbc`. If the filename differs from
  `abcjs_basic.min.js`, either rename on vendor or adjust the patch.
- Render fidelity: render a few tunes (the `tmp/all-renderers.md` abc sample + a couple more) on
  6.x and eyeball vs 5.10.3.

## Approach (mirror `syncMermaid` — see the skill)
1. **Confirm artifact** = global UMD build exposing `globalThis.ABCJS` (head/tail check, like
   the Mermaid global check).
2. **Vendor** `media-src/vendor/abcjs/{abcjs_basic.min.js,source.json,LICENSE,NOTICE}` (abcjs is
   **MIT** — ship LICENSE/NOTICE). `source.json` = version + sha256. Re-pin helper
   `media-src/scripts/fetch-abcjs.mjs` (mirror `fetch-mermaid.mjs`).
3. **build.mjs `syncAbcjs()`** — after `syncVditorAssets()`, sha-verify + copy over
   `media/vditor/dist/js/abcjs/abcjs_basic.min.js` (+ LICENSE/NOTICE into `media/`).
4. **Cache-buster** — `abcRender.ts` loads `abcjs_basic.min.js` with **no `?v=`**. Add one via an
   esbuild patch (`fixAbcjsVersion`, mirror `fixMermaidVersion`): append `?v=<version>` so a
   stale webview can't serve old bytes across an update.

## Tests (per AGENTS)
- **`test/backend/abcjs-pin.test.ts`** — sha/version/global-build + MIT notice guards
  (mirror `mermaid-pin.test.ts`).
- **e2e** — a `\`\`\`abc` block renders to sheet music (non-empty `<svg>`) on the bumped build;
  loaded script src carries the pinned `?v=` (after the patch lands).
- **Fidelity note** — record the 5.10.3-vs-6.x eyeball result here before merging.

## See also
- Skill `vmarkd-renderer-theming` (global-UMD check, overwrite-after-sync, `?v=` patch).
- Task 86 (`syncMermaid`/`fixMermaidVersion` precedent), task 89 (ECharts bump — same verify-first
  major-bump shape), task 93 (abc theming — needs this).
- `media-src/node_modules/vditor/src/ts/markdown/abcRender.ts`.
