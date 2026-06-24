# Task 98 — Disable the `mindmap` renderer (adapter-neuter)

> **🔎 Audit 2026-06-24 (task 142):** still UNCHANGED — `mindmap` blocks still render (echarts-tree,
> baked light palette, hostile URL-encoded-JSON input). Decision still pending: disable (this task) vs
> theme it. No action taken; keep TODO until decided.

> **Status:** 📋 TODO. Stop rendering ` ```mindmap ` blocks. The ECharts-tree mindmap is
> **redundant with markmap**, takes a **hostile input** (URL-encoded JSON —
> `JSON.parse(decodeURIComponent(text))`, unwritable by hand), and is **locked to a light
> palette** (5 hardcoded colors in Vditor's `setOption`). Rather than theme a renderer nobody
> can realistically use (theming was the rejected alternative), disable it with one patch; mind
> maps are served by **markmap** (natural markdown outline — task 95).
> **Source:** renderer audit (the `vmarkd-renderer-theming` skill); user decision to drop it.
> **Value / Risk:** 🟢 less surface, no broken-looking output / very low — one esbuild patch.

## Why disable, not theme
- **Redundant:** markmap produces the same mind-map/tree from a **markdown outline**; mindmap
  needs URL-encoded JSON — effectively unauthored in a markdown editor.
- **Broken on dark:** `mindmapRender.ts` hardcodes `itemStyle.color:#4285f4`,
  `label.backgroundColor:#f6f8fa`, `label.color:#586069`, `label.borderColor`/`lineStyle:#d1d5da`
  in `setOption`, overriding the dark/light theme → light boxes float on a dark surface.
- Theming it (a task-90-style patch of those 5 hexes) is effort spent on a dead path.

## Approach (one esbuild patch — mirror the `fix*` patches in `esbuild-shared.mjs`)
All four `mindmapRender` call sites (`markdown/previewRender.ts`, `preview/index.ts`,
`util/processCode.ts`, `export/index.ts`) funnel through one adapter:
```ts
// markdown/adapterRender.ts
export const mindmapRenderAdapter = {
  getElements: (el) => el.querySelectorAll(".language-mindmap"),
  getCode: …,
}
```
Patch `adapterRender.ts` so `mindmapRenderAdapter.getElements` queries a **never-matching**
selector (e.g. `.vmarkd-mindmap-disabled`) → it returns an empty list → every call site's
`if (mindmapElements.length > 0)` / `forEach` is a no-op. `mindmapRenderAdapter` is used **only**
by mindmap, so nothing else is affected.
- New plugin `fixDisableMindmap` in `media-src/esbuild-shared.mjs`, registered in
  `vditorSourceConfig.plugins`. Anchor on the exact `querySelectorAll(".language-mindmap")` in
  `adapterRender.ts`; **throw if the anchor drifts** on a Vditor bump (like the other patches).

## What the user sees
A ` ```mindmap ` block no longer draws an ECharts tree — it falls through to a **plain code
block** (codeRender/highlightRender already skip `language-mindmap` for highlighting, so it's an
unstyled `<pre><code>` showing the raw text). Acceptable: the trigger is vanishingly rare.

## Not in scope / notes
- **No bundle-size win.** `echarts.min.js` stays — it's shared by the `echarts` (chart) renderer
  (and `mindmap` only *used* it). Disabling mindmap is about UX/correctness, not size.
- Full call-site removal (3–4 patches + tree-shaking `mindmapRender` out) is an alternative; the
  tree-shake gain is ~60 lines — not worth the extra patch surface. Adapter-neuter is simpler.
- Leaves Vditor's fence recognition intact (that's Lute); we only stop the render.

## Tests (per AGENTS)
- **e2e** — a ` ```mindmap ` block does **not** produce an ECharts node (no `<canvas>`/tree
  `<svg>`; stays a code block); a ` ```echarts ` chart **still renders** (shared engine
  unaffected). Mirror the existing render specs.

## See also
- Skill `vmarkd-renderer-theming` (the renderer map; mindmap = ECharts engine, hardcoded option).
- Task 95 (markmap — the kept mind-map path), task 89/90 (ECharts bump/theming — the shared
  engine stays), the `esbuild-shared.mjs` `fix*` patch convention.
- `media-src/node_modules/vditor/src/ts/markdown/{adapterRender,mindmapRender}.ts`.
