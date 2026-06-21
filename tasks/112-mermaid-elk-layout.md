# Task 112 — Mermaid ELK layout engine (opt-in alternative to dagre)

**Status:** planned (spike-first — vendor `@mermaid-js/layout-elk` + size gate before building).
**KEY UPDATE 2026-06-21:** the D2 ELK work (task 104/113, `d2-elk-main-thread` memory + ADR-0004)
already hit and **solved** the elkjs-in-webview blocker — `@mermaid-js/layout-elk` will hit the SAME
one, and should **reuse our main-thread ELK boot** instead of vendoring a second elkjs. See the new
"Reuse our webview-ELK" section below — it changes the bundle plan (no second ~1.4 MB elkjs).

## Origin / motivation

We ship **mermaid 11.6.0** (vendored `media-src/vendor/mermaid`, synced by
`build.mjs syncMermaid()` — task 86). Mermaid's graph diagrams (**flowchart, class,
state, ER**) lay boxes out with **dagre** — the *same* dagre that d2 bundles, with the
same limitation: strictly layered along `direction`, spreads wide, no compact 2D
packing / clean orthogonal routing.

Mermaid ≥10.3 made layout **pluggable**: register `@mermaid-js/layout-elk` and you can
set `layout: "elk"` (globally or per-diagram via `%%{init: {"layout":"elk"}}%%`) to get
**ELK layered** — cleaner orthogonal edge routing and tighter graphs than dagre. We do
**not** bundle that package (`media-src/node_modules/@mermaid-js/` has no `layout-elk`),
so today only dagre is available. This task vendors + wires ELK as an **opt-in** layout
for mermaid graph diagrams. (Came out of the d2/TALA layout-quality investigation —
ELK is the realistic step up from dagre that the ecosystem actually exposes.)

## Background — how our mermaid is loaded / configured (so the wiring is accurate)

- Vditor's `mermaidRender.ts` lazy-loads `…/dist/js/mermaid/mermaid.min.js?v=11.6.0`
  (`addScript`, id `vditorMermaidScript`) and builds a `config` object →
  `mermaid.initialize(config)` → `mermaid.render(...)` per element.
- We **intercept Vditor's lazy `window.mermaid = …` assignment exactly once**
  (`mermaid-theme.ts`, `__vmarkdMermaidHook`, lines ~102–116) and **wrap
  `mermaid.initialize`** (`__vmarkdMermaidInit`, ~84–87) to inject our theme +
  `themeVariables` (`window.__vmarkdMermaidTheme` / `__vmarkdMermaidVars`) — task 86.
- Live re-theme re-renders via `mermaid-retheme.ts` (`reRenderMermaid`, task 59/86).
- Version is pinned + cache-busted: `source.json` sha256 + esbuild patch
  `fixMermaidVersion` rewriting the `?v=` anchor (`esbuild-shared.mjs` ~562).

**The hook in `mermaid-theme.ts` is the natural injection point** — it already owns the
`window.mermaid` interception, so registering the ELK loader + defaulting `config.layout`
belongs in the same wrapped `initialize`.

## Scope / plan

1. **Vendor `@mermaid-js/layout-elk`** like mermaid itself: `media-src/vendor/mermaid-layout-elk`
   + a `fetch-mermaid-layout-elk.mjs` (mirror `media-src/scripts/fetch-mermaid.mjs`),
   `source.json` (version + sha256), MIT license file; a `syncMermaidLayoutElk()` in
   `build.mjs` copying it into `media/vditor/dist/js/mermaid/` next to `mermaid.min.js`.
   The package is ESM and normally pulls **elkjs (~1.4 MB min)** — but see "Reuse our webview-ELK":
   we already ship elkjs for D2, so vendor only the thin `layout-elk` adapter and share our instance
   (and our fake-worker — stock elkjs's blob worker rejects in the webview anyway).
2. **Register the loader once** in `mermaid-theme.ts`'s hook:
   `mermaid.registerLayoutLoaders(elkLayouts)` right after we capture `window.mermaid`,
   so `layout: "elk"` resolves (otherwise mermaid errors / falls back to dagre).
3. **Config / setting** — inject `config.layout` in the wrapped `initialize`:
   - `%%{init: {"layout":"elk"}}%%` per-diagram works for free once the loader is registered.
   - Add a global default **setting** (decision below): `dagre` (default) | `elk`. Read via
     the live-config path (`live-config.ts`), surfaced into the wrapped initialize like
     theme/vars are.
4. **Lazy-load the ELK bundle** — only fetch the elk script when it's actually needed
   (setting = elk, or a diagram carries `layout: elk`), so dagre-only docs don't pay the
   ~1.4 MB. Mirror the markmap offline-bundle lazy pattern (task 95) / the per-script
   `addScript` gating mermaid already uses.
5. **Live re-render** — make `reRenderMermaid` (task 59) re-run cleanly when the layout
   setting flips, same as a theme flip.

## ⚠️ Reuse our webview-ELK (learned from D2 ELK, 2026-06-21)

**The blocker `@mermaid-js/layout-elk` WILL hit:** stock `elkjs` spawns a **blob Web Worker**, and
`elk.layout()` **rejects under the VS Code webview** (CSP / worker origin) — it silently fails or
falls back. We already proved + fixed this for D2: vendored `elk-api.js` + `elk-worker.min.js` as an
**in-process FAKE worker**, esbuild-bundled via `elk-entry.ts` → `media/vditor/dist/js/elk/elk-main.js`
→ constructs the ELK instance on the **MAIN THREAD** and exposes `window.__vmarkdElk`
(`elk-layout.ts bootElk`, `d2-elk-main-thread` memory, ADR-0004; verified by `d2-elk.spec`).

**So the bundle plan changes:** do NOT vendor a second full elkjs inside `@mermaid-js/layout-elk`.
Instead point mermaid's elk loader at our existing main-thread instance:
- `@mermaid-js/layout-elk` internally does `new ELK()` (which spawns the blob worker). Patch/shim it to
  use **our** already-booted `window.__vmarkdElk` (or construct via our `elk-api` + fake-worker factory,
  the same `workerFactory` we pass in `elk-layout.ts`). An esbuild source patch (like `VDITOR_TS_PATCHES`)
  on the layout-elk entry is the likely seam.
- Net: we ship **one** elkjs (already present for D2), shared by D2 + mermaid → the ~1.4 MB size gate in
  step 1/decisions is **already paid** by D2; mermaid-elk adds only the thin `layout-elk` adapter.
- `bootElk(cdn)` is already the lazy main-thread loader; mermaid's elk path can `await` it before render.

**This is the single biggest reuse** (per the 2026-06-21 D2↔mermaid discussion): our hard-won
main-thread ELK boot, NOT our `toSVG` (that's a D2-shape renderer — mermaid keeps its own renderer +
theming). Empirical ELK option knowledge (task 113: BALANCED BK, model-order, spacing) can also seed
mermaid-elk config where it exposes knobs (it exposes few — see Out of scope).

## Interactions to verify (don't regress)

- **Theme pairing (task 86)** — ELK layout is orthogonal to `themeVariables`; confirm an
  ELK-laid flowchart still picks up the content-theme palette + re-themes live.
- **Diagram fill-width / max-height cap** (`diagram-fill-width.md`, `diagram-width.spec.ts`)
  — ELK output is still an SVG with mermaid's `useMaxWidth`; confirm width:100% + 480px
  cap still hold.
- **Only graph diagrams change** — sequence/gantt/pie/journey/timeline/gitGraph use
  bespoke deterministic layout (no engine); `mindmap` uses cytoscape. `layout: elk` is a
  no-op there — document that, don't imply it restyles everything.

## Decisions to make (spike)

- **Setting name + grouping**: `vmarkd.mermaid.layout` vs `vmarkd.diagram.mermaidLayout`
  vs folding under `vmarkd.theme.*` (it's *layout*, not theme — argues for its own key).
  Values `dagre` | `elk` (no `auto` — there's no content-theme signal that implies a layout).
- **Bundle strategy**: SUPERSEDED by "Reuse our webview-ELK" — share the D2 main-thread elkjs
  (`window.__vmarkdElk` via `bootElk`) rather than bundling a second one. Open question is just the
  esbuild seam to make `@mermaid-js/layout-elk` use our instance/`workerFactory` instead of `new ELK()`.
- **Is the size worth it?** elkjs's ~1.4 MB is **already paid by D2** — sharing it makes mermaid-elk
  nearly free (only the thin `layout-elk` adapter). If D2 ELK is ever removed, re-open the size gate.

## Out of scope

- Replacing dagre as the default (keep dagre default — ELK is opt-in; flips would churn
  every existing flowchart's appearance).
- ELK tuning knobs (spacing/aspectRatio/wrapping) — mermaid's elk integration exposes
  little; revisit only if users ask. (Same ceiling we hit with d2's ELK.)
- Non-graph diagram layouts (sequence/gantt/etc.) — no engine to swap.

## Verification

- Unit: the hook registers the loader exactly once; wrapped `initialize` sets
  `config.layout` from the setting; `dagre` setting leaves layout unset (default).
- e2e (harness, headless): a flowchart renders under `layout: elk` and its geometry
  differs from the dagre render (e.g. node coordinates / edge path count); a
  `%%{init:{"layout":"elk"}}%%` diagram renders without the loader-missing error; theme
  palette still applied. **Verify coverage** on the new code (AGENTS.md).
- Build: `syncMermaidLayoutElk()` verifies sha256 + ships MIT license; `fixMermaidVersion`
  still green; bundle size delta recorded (≈0 — elkjs shared with D2, not re-vendored).
- **Real-VS-Code (mandatory):** `elk.layout()` actually RESOLVES in the webview (uses our
  `window.__vmarkdElk` / fake-worker, not a blob worker) — mirror `test/vscode-e2e/d2-elk.spec`; a
  harness/headless pass is NOT sufficient proof for this (the blob-worker rejection is webview-only).
- `tsc` + `biome` + full vitest + Playwright green, headless (`xvfb-run -a`).

## See also
- `d2-elk-main-thread` memory + ADR-0004 (the fake-worker main-thread ELK we reuse), `elk-entry.ts`,
  `elk-layout.ts` (`bootElk`, `window.__vmarkdElk`), `test/vscode-e2e/d2-elk.spec`.
- Task 104 (our D2 renderer — note we DON'T reuse its `toSVG` here; mermaid keeps its own renderer),
  task 113 (empirical ELK option findings), task 86 (mermaid theme pairing — stays orthogonal to layout).
