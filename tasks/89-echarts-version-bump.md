# Task 89 — Bump bundled ECharts 5.5.1 → 6.1.0

> **Status:** ✅ done (2026-06-10, branch `feat/echarts-theme`). Vendored **6.1.0** (global UMD,
> Apache-2.0) over Vditor's 5.5.1: `media-src/vendor/echarts/{echarts.min.js,LICENSE,NOTICE,
> source.json}` + `scripts/fetch-echarts.mjs` (sha256 + global-build + self-reported-version
> guards) + `build.mjs syncEcharts()` (verify sha + copy over Vditor's copy + ship LICENSE/NOTICE)
> + esbuild `fixEchartsVersion` bumping `?v=5.5.1→6.1.0` in **all three** loaders that share the
> `vditorEchartsScript` id (chartRender, mindmapRender, devtools — else mindmap could pin the
> stale URL). Tests: `test/backend/echarts-pin.test.ts` (6, sha/version/global-build/Apache-2.0)
> + e2e `echarts.spec.ts` (chart renders a non-empty `<canvas>`, loaded script is `?v=6.1.0`,
> `echarts.version==='6.1.0'`). **Fidelity:** the e2e renders a bar chart on 6.1.0 with no errors;
> default-palette shift is moot because task 90 overrides the palette anyway. Whole-tree lint +
> typecheck + 595 unit green.
> Original plan:
> Vditor pins ECharts **5.5.1**; latest is **6.1.0**. Vendor the newer build over Vditor's copy
> (Lute/Mermaid pattern) so charts get upstream fixes — but ECharts 6 is a major release with
> breaking changes, so unlike the Mermaid 11.6→11.15 bump this needs render verification.
> **Source:** follow-up while planning ECharts theming (task 90); user asked to bump first.
> **Value / Risk:** 🟡 upstream fixes/perf / **medium** — major version, new default theme +
> option changes can shift how existing charts render.

## Problem
`media-src/node_modules/vditor/dist/js/echarts/echarts.min.js` is **5.5.1** (Vditor's pin),
loaded by `chartRender.ts` as `echarts.min.js?v=5.5.1`. Latest is **6.1.0**. We have no
independent control of the version — same gap Lute (task 66) and Mermaid (task 86) had.

## Compatibility (the real risk)
Vditor uses only `echarts.init(el, theme).setOption(option)` — that core API is stable
5→6. But **ECharts 6 is a major** with breaking changes, e.g.:
- new **default theme / color palette** (charts using default colors look different),
- renamed/removed deprecated `option` fields,
- other rendering/default tweaks.

So a chart that renders today on 5.5.1 may look different (or warn) on 6.1.0. **Verify with a
real chart corpus before shipping** — this is NOT the safe same-major swap Mermaid was.

## Approach (mirror `syncLute`/`syncMermaid` — see the `vmarkd-renderer-theming` skill)
1. **Confirm the artifact**: `echarts@6.1.0/dist/echarts.min.js` must be the **global UMD
   build** that exposes `globalThis.echarts` (the form Vditor loads via `addScript`). Verify
   the head/tail expose the global — same check used for Mermaid.
2. **Vendor**: `media-src/vendor/echarts/{echarts.min.js,source.json,LICENSE,NOTICE}` (ECharts
   is **Apache-2.0** — ship LICENSE + NOTICE). `source.json` records version + sha256.
   Re-pin helper: `media-src/scripts/fetch-echarts.mjs` (mirror `fetch-mermaid.mjs`).
3. **build.mjs `syncEcharts()`**: after `syncVditorAssets()`, sha256-verify the vendored file
   and copy it over `media/vditor/dist/js/echarts/echarts.min.js`; copy LICENSE/NOTICE into
   `media/` (`.vscodeignore` excludes `media-src/`).
4. **Cache-buster**: `chartRender.ts` hardcodes `echarts.min.js?v=5.5.1`. Add an esbuild patch
   `fixEchartsVersion` (`media-src/esbuild-shared.mjs`, mirror `fixMermaidVersion`) to bump
   `?v=` to the pinned version — else a stale webview serves old bytes across an update.

## Tests (per AGENTS)
- **`test/backend/echarts-pin.test.ts`** — sha/version/global-build + Apache-2.0 notice guards
  (mirror `mermaid-pin.test.ts`).
- **e2e** — a `\`\`\`echarts` block renders to a chart (non-empty `<canvas>`/`<svg>`) on the
  bumped version; the loaded `#vditorEchartsScript` src carries the pinned `?v=` (not 5.5.1).
- **Fidelity check (the point of the task)** — render a small corpus (bar/line/pie + a chart
  using default colors) and eyeball 5.5.1 vs 6.1.0 in the editor; note any default-palette
  shift in this file before merging.

## Decision gate
If 6.1.0 visibly changes existing charts or breaks an `option` we rely on → either pin a
later 6.x patch that fixes it, stay on 5.5.1, or absorb the new defaults (task 90's theming
overrides the palette anyway, which mitigates the default-color shift).

## See also
- Skill `vmarkd-renderer-theming` (cache-buster `?v=`, overwrite-after-sync, global-UMD check).
- Task 66 (Lute vendoring), task 86 (Mermaid bump + the `syncMermaid`/`fixMermaidVersion`
  precedent), task 90 (ECharts theming — the reason to touch ECharts; do this bump first).
- `media-src/node_modules/vditor/src/ts/markdown/chartRender.ts`.
