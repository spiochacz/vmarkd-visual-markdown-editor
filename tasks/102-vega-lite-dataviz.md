# Task 102 — Vega / Vega-Lite data-visualization

> **🔎 Audit 2026-06-24 (task 142):** IMPLEMENTED — `renderVega` is wired in `custom-diagrams.ts`
> (vega 7.x / vega-embed vendored); status below is stale. **Open gap:** `spec.data.url` is stripped
> (offline) → only inline data works; document it. Verify-first: vega light/dark theming + responsive
> width/height. Mark done for inline-data render + track the data-URL limitation.

> **Status:** 📋 TODO (after [task 99](99-geojson-topojson-maps.md) — reuses its renderer pass).
> Render ` ```vega ` / ` ```vega-lite ` fenced blocks (JSON spec) as charts. Vega is a richer
> data-viz grammar than ECharts for declarative/statistical plots; supported by Kroki + Jupyter +
> Observable. Pure-JS, offline.
> **Source:** ecosystem survey; user request.
> **Value / Risk:** 🟡 powerful but heavy + overlaps ECharts / medium — bundle size is the concern.

## Problem
No declarative data-viz grammar in vMarkd. Vega-Lite specs (`{ "mark": …, "encoding": … }`) are a
common, portable chart format.

## Approach
1. **Reuse the custom fenced-renderer pass** from task 99 — register `{ lang: 'vega', fn }` +
   `{ lang: 'vega-lite', fn }`.
2. **Lib** — **vega** + **vega-lite** + **vega-embed** (BSD-3). `vega-embed` handles both. Add as
   `media-src` deps; **lazy-import** — Vega is **large** (hundreds of KB to ~MB); measure. Consider
   shipping only `vega-lite` + a slim `vega` if full Vega isn't needed.
3. **Render** — parse the fenced JSON spec → `vegaEmbed(el, spec, { actions: false })` → SVG/canvas.
   `data-processed` guard. Prefer `renderer: 'svg'` (crisper, themeable, CSP-friendly).
4. **CSP / offline** — SVG renderer = no remote, no eval. ⚠️ Specs can reference **remote `data.url`**
   → that's a remote fetch (`connect-src`); **block/ignore remote data URLs** by default (or gate on
   `allowRemoteImages`-style trust), so offline + no exfil. Inline `data.values` always works.
5. **Theme** — `vega-themes` (dark/excel/…) or pass a config derived from the palette (background,
   axis, range colors) — reuse the shared mapping (task 86/90). Live re-theme on flip.

## Overlap note
We already have **ECharts** (task 89/90) for charts. Vega-Lite is **complementary** (declarative
statistical grammar, not a config object) — document when to use which; don't drop ECharts.

## Tests (per AGENTS)
- **e2e** — a ` ```vega-lite ` spec with inline `data.values` renders an SVG chart (not a code
  block); a spec with a remote `data.url` does **not** fetch when untrusted; theme flip re-renders.

## See also
- Skill `vmarkd-renderer-theming`; task 99 (renderer pass); task 90 (ECharts pairing — shared palette
  mapping). [Kroki diagram set](https://kroki.io/).
