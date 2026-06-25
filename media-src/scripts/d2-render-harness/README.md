# D2 render harness

By-eye verification tool for D2 layout + feature work. Renders `.d2` sources through the three layout
engines and writes a PNG grid (or a zoomable, self-contained HTML page) so you can compare output
visually — the way D2 layout/routing is steered in this repo.

It needs the WASM compiler + the vendored ELK, so it drives a headless browser (not pure node). Run
`node build.mjs` once first so `media/vditor/` assets + the D2 WASM exist.

```bash
# all tracked fixture sources, vmarkd engine → tmp/d2-render.png
node media-src/scripts/d2-render-harness/render.mjs

# every fixture source × all three engines, side by side (dagre | elk | vmarkd)
node media-src/scripts/d2-render-harness/render.mjs --engine all

# a specific source through every engine
node media-src/scripts/d2-render-harness/render.mjs --engine all path/to/foo.d2

# self-contained HTML (inline SVG, no server) — double-click to open, zoom freely
node media-src/scripts/d2-render-harness/render.mjs --out tmp/d2.html path/to/*.d2
```

## Options

| flag | default | meaning |
|---|---|---|
| `--engine <dagre\|elk\|vmarkd\|all>` | `vmarkd` | which engine(s) to render. `all` = a column per engine. |
| `--out <path>` | `tmp/d2-render.png` | output file; `.html` extension → static HTML, else PNG. |
| `--scale <px>` | `460` | max SVG width per cell. |
| positional `*.d2` | fixture sources | sources to render; defaults to `../d2-fixtures/sources/*.d2`. |

The engines mirror the `vmarkd.diagram.d2Layout` setting: **dagre** (bundled hierarchical), **elk**
(raw Eclipse Layout Kernel), **vmarkd** (ELK + the refinement pipeline — the shipped default).

Lives outside `src/` so it's not part of the app's typecheck / lint / test surface. Throwaway output
goes under `tmp/` (gitignored). Companion to [`../d2-fixtures`](../d2-fixtures) (the CI-fixture generator).
