# Task 99 — GeoJSON / TopoJSON interactive maps (GitHub parity)

> **🔎 Audit 2026-06-24 (task 142):** IMPLEMENTED — `renderGeojson`/`renderTopojson` are wired in
> `custom-diagrams.ts` (Leaflet 1.9.4 + topojson 3.1.0 vendored); status below is stale. **Open gap:**
> no base-map TILE layer (remote tiles → CSP-blocked offline), so only the geometry shows on a blank
> background. Decide: vendor offline tiles (size) vs document as "geometry-only". Mark this task done
> for the render + track the basemap gap.
>
> **🟣 Basemap done 2026-06-27 (99a):** chose **option (b)** — a remote basemap behind an opt-in.
> `initLeafletMap` now adds CARTO's no-key tiles (light_all/dark_all per editor mode) UNDER the
> geometry **only when `image.allowRemoteImages` is on**. No CSP change needed: `img-src` already adds
> `https:` exactly when that setting is on, so the tiles can't be requested while off (default stays
> fully offline, geometry-only). Plumbed `allowRemoteImages` through `collectConfigOptions` →
> `window.__vmarkdAllowRemoteImages`. Attribution control re-enabled when tiles load (OSM/CARTO
> requirement). Test: `test/vscode-e2e/geojson-tiles.spec.ts` (ON → CARTO tiles present; OFF → 0 tiles).
> Remaining for a clean DONE: a unit test for the lang-dispatch + assert the theme-flip re-render (both
> low; render itself has strong real-VS-Code coverage).
>
> **🟣 Basemap configurable 2026-06-29 (99b):** user — "geojson ma czarno-białą mapę" (the 99a basemap
> is CARTO Positron/Dark Matter, intentionally monochrome). Added `vmarkd.theme.geoBasemap` (Themes
> group) so the basemap is overridable: `auto` (default = the 99a themed mono, unchanged), `voyager`
> (colored CARTO Voyager), `osm` (OpenStreetMap), `none` (geometry only even with remote images on).
> Threaded through the SAME theme mechanism: `protocol.VmarkdConfigOptions.geoBasemap` →
> `collectConfigOptions` → the typed `d2-config` holder (`getD2Config().geoBasemap`, read by
> `initLeafletMap` alongside `.mode`) → `basemapFor(setting, dark)`. Live re-apply: a new `geo` flag in
> `rethemeDiagrams`/`reThemeMonochromeGroup` (separate from `monoGroup` so a basemap change re-renders
> only the maps; a content/theme flip still re-renders them via `mono || geo`, so `auto` flips
> light/dark). Tile source still gated by `image.allowRemoteImages` (CSP). Tests: `basemapFor` unit
> (`custom-diagrams.test.ts`), `d2-config` round-trip, `manifest` schema, real-VS-Code
> `geojson-basemap.spec.ts` (osm/voyager/none tile-source assertions); `geojson-tiles.spec.ts` (default
> mono) still green.
>
> **🟣 Map z-index fix 2026-06-29 (99c):** user — "mapa przykrywa rozwijane menu jak np w toolbarze".
> Leaflet gives its panes/controls high z-indexes (the zoom control container is z-index 1000 and is
> always present, even offline); with no stacking boundary they escaped to the editor root and painted
> OVER Vditor's toolbar dropdown (`.vditor-panel`, z-index 3). Fix: `isolation: isolate` on the
> `.language-geojson`/`.language-topojson` wrapper (main.css) → Leaflet's z-indexes stay scoped to the
> map, which then sits at its natural level below the positioned toolbar UI. Real-VS-Code
> `geojson-zindex.spec.ts` parents a faithful `.vditor-panel` probe over the map's zoom control and
> asserts elementFromPoint hits the panel, not Leaflet (RED-checked: without isolate the
> leaflet-control-zoom wins).

> **Status:** ✅ DONE (2026-06-27 — render + theming + opt-in CARTO basemap 99a + e2e; see audit/99a notes above).
> Render ` ```geojson ` / ` ```topojson ` fenced blocks as interactive maps
> — a **GitHub-native** Markdown feature (since 2022) that vMarkd lacks. Offline via a bundled
> JS map lib (Leaflet/MapLibre). **First of the new-renderer tasks: it establishes the shared
> custom fenced-renderer pass** that 100–103 reuse.
> **Source:** GitHub-parity gap (internet survey — GitHub renders only mermaid+geojson+topojson+stl
> natively; we have mermaid). User request.
> **Value / Risk:** 🟡 parity + useful / medium — new renderer plumbing + a real offline-basemap caveat.

## Problem
GitHub renders ` ```geojson `/` ```topojson ` as interactive maps; vMarkd shows them as plain code
blocks. We want parity, offline.

## Shared mechanism (this task establishes it; 100–103 reuse)
vMarkd has **no custom fenced-diagram renderer pass** today — Vditor's renderers (mermaid, …) are
built-in; our `custom-renderer.ts` is Lute-level (wiki chips). Add a **post-render DOM pass** over
`.language-<x>` code blocks (mirror how `mermaidRender` finds `.language-mermaid`), registered for
a set of `{lang → renderFn}`. Wire it into **every** render entry point mermaid is handled at:
init render, live update, **streaming** (`stream-render.ts`), and the host-side **instant-preview
prerender** (or accept no map in the teaser). Re-run is idempotent (`data-processed`). Build this as
`media-src/src/custom-diagrams.ts` (or extend the render dispatch) so 100–103 just add a `{lang, fn}`.

## Approach (this renderer)
1. **Lib** — **Leaflet** (MIT, ~150 KB) or **MapLibre GL** (BSD, larger, WebGL). Prefer **Leaflet**
   (lighter, SVG/DOM, no WebGL). `topojson` → convert with **topojson-client** (BSD) to GeoJSON,
   then same path. Add as `media-src` deps; esbuild bundles into `main.js` (lazy-import so docs
   without maps don't pay for it).
2. **Render** — parse the fenced JSON; `L.geoJSON(data).addTo(map)`; fit bounds to the geometry.
3. **CSP / offline caveat (the catch):** a real **basemap = remote tiles** (`img-src https:`),
   which our CSP blocks unless `vmarkd.image.allowRemoteImages` is on. **Default: render the
   geometry on a blank/no-tile canvas** (shapes + a neutral background), so it works offline; if
   `allowRemoteImages` is on, add an OSM/Carto tile layer for a true basemap. Document this clearly.
4. **Theme** — shape stroke/fill from the palette (`line`/`accent`) so it reads on any background;
   blank canvas bg from the surface.
5. **Live re-theme** — re-render on a theme flip (mirror `reRenderMermaid`).

## Tests (per AGENTS)
- **e2e** — a ` ```geojson ` block renders an SVG/DOM map with the geometry path present (not a code
  block); `topojson` converts + renders; **no remote request** when `allowRemoteImages` is off
  (assert no tile fetch); theme flip re-renders.
- **Unit** — the lang-dispatch pass picks `.language-geojson`/`.language-topojson` and skips others.

## See also
- Skill `vmarkd-renderer-theming` (offline/CSP discipline — remote tiles are the `<img https>` case
  task 67 gates). [GitHub Docs — creating diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams).
- Tasks 100–103 (reuse the pass this task builds).
