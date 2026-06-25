# Task 124 — D2 feature parity (connection styles, text/code/image, markdown/LaTeX, tooltips/links, multi-board)

> **Status:** 🟡 Phase A DONE (2026-06-25) — `shape: text` (borderless prose) + `shape: code`
> (monospace panel), both toSVG-only with multi-line `<tspan>` rows (`textShapeBox` sizes them in
> `leafInfo`). Items #1/#3/#4/#5/#6 still open and need a WASM bump. **Audit note (2026-06-25):** the
> Phase-B batch (127/128/133/126A) extended the WASM but for a DIFFERENT slice — none of THIS task's
> own items #1/#3/#4/#5 got their fields, so the "capture EVERY field in one rebuild" premise below was
> only partially executed; another WASM bump is still needed (cheap now that the WASM is TinyGo). Note
> arrowhead *shapes* (128) ≠ connection *stroke* styles (#1, still hardcoded). md labels (#4) split to
> task 154.
> Originally 💡 idea / planned (decision-gated) — created 2026-06-24. Catalogs the D2 language
> features our renderer (task 104) does NOT yet handle, found while auditing the pipeline after the
> shape + colour-theme work (shapes 1:1 with d2; `sql_table`/`class`; faithful `d2Theme` palettes).
> Most items need a **Go + WASM rebuild** — our compile-only entrypoint
> (`media-src/vendor/d2/build/main.go`) doesn't marshal the fields they need. **Batch the WASM bump
> with task 121** (shape effects) — same toolchain, same `outShape`/`outEdge` extension, one rebuild.
> Builds on tasks 104 (renderer), 119 (themes), 122 (layout pipeline).

## Out of scope (already decided elsewhere)
- `sequence_diagram` → currently a loud fallback (`unsupportedReason`). Rendering it via a mermaid
  transpile is tracked separately in **task 125**.
- `near` positioning (legends / free-floating labels pinned to a shape or viewport) → tracked
  separately in **task 126** (viewport-constant form is cheap + high-value; near-shape form deferred).
- Shape **effects** (shadow / 3d / multiple / double-border / fill-pattern) → tracked separately in
  **task 121** (same WASM bump — coordinate).

## Root cause (shared)
`main.go` marshals, per shape: `fill, stroke, strokeWidth, strokeDash, opacity, fontColor,
borderRadius, bold, italic` (+ `gridRows/gridColumns`, sql columns, class members). Per **edge** it
marshals only `src, dst, label, srcArrow, dstArrow` — **no style at all**. It also never emits
label-type (md/latex/code), icons, tooltips/links, or non-root boards. So the webview can't render
what it never received. The fixes are mostly "extract field in Go → consume in `toSVG`".

## Items (each: cost + what to do)

### 1. Connection (edge) styles — HIGH ROI
- **Gap:** every connection is drawn hard-coded `stroke=<theme edge>` `stroke-width="2"`, ignoring the
  source's `style.stroke` / `stroke-dash` / `stroke-width` / `opacity` / `animated`. (Shapes honour
  these; edges don't.) Dashed/colored/thick connections are common in real diagrams.
- **Cost:** WASM (extend `outEdge` with `stroke/strokeWidth/strokeDash/opacity/animated`) + `toSVG`
  edge draw (the `<path … stroke="${themeColor}" stroke-width="2">` block) reads them; `animated` →
  an SVG `stroke-dasharray` + `<animate>` dash-offset (respect `prefers-reduced-motion`).
- **Note:** keep theme colour as the *default* when the edge sets no explicit `style.stroke` (so
  `d2Theme` still drives un-styled edges).

### 2. `shape: text` / `shape: code` — ✅ DONE (Phase A, 2026-06-25)
- **Done:** `toSVG` now branches before the shape switch — `text` = borderless, left-aligned prose;
  `code` = monospace in a subtle panel (`sty.paper` fill + `leafStroke` border). Multi-line labels
  split into `<tspan>` rows (SVG `<text>` doesn't wrap on `\n`). `textShapeBox` (exported) sizes both
  in `leafInfo` (shared by dagre + ELK): proportional Sizer per line for text; monospace char-count
  estimate for code (the Sizer has no mono font). Unit tests in `d2-render.test.ts` (6); visual via the
  render harness; fixture block in `all-renderers.md` §18 for the real-VS-Code suite. No WASM needed.
- **Left (deferred):** syntax highlighting for `code` needs the block's **language** (not marshalled)
  → folds into the Phase-B WASM bump; reuse the highlight.js path. Markdown labels = task 154.

### 3. `shape: image` + icons (`icon: <url>`) — MEDIUM (needs WASM + CSP)
- **Gap:** image shapes / shape icons are not rendered.
- **Cost:** WASM (extract `icon`/image URL); `toSVG` emits `<image href>`. **CSP:** `img-src` already
  allows `data:`/`blob:` but NOT arbitrary remote hosts — offline-first means only `data:` URIs (or a
  vendored set) render; remote `icon:` URLs are blocked by design (document it, mirror PlantUML's note).

### 4. Markdown / LaTeX labels (`|md …|`, `|latex …|`) — MEDIUM
- **Gap:** rendered as plain text.
- **Cost:** WASM (extract the label's *type*: text vs md vs latex vs code). md → reuse Lute/preview
  render into a `<foreignObject>`; latex → reuse the KaTeX path. `<foreignObject>` sizing must feed back
  into `dimsToFit` so layout reserves the right box.

### 5. Tooltips & links (`tooltip:` / `link:`) — LOW-MEDIUM (interactive)
- **Gap:** not wired. d2 shapes can carry a hover tooltip and a click-through link.
- **Cost:** WASM (extract `tooltip`/`link`); `toSVG` adds `<title>` (tooltip) + wraps the shape in
  `<a>` (link). Link clicks must go through the webview's existing link-open policy
  (`link-open-policy.ts`) — internal `.md`/wiki vs external, same as body links. Not offline-blocking.

### 6. Multi-board composition: `layers` / `scenarios` / `steps` — LARGE
- **Gap:** d2 can define multiple boards (composition / animated walkthroughs); we render only the root
  board.
- **Cost:** WASM (emit the board tree, not just the root graph) + a webview board switcher UI + layout
  per board. Significant; likely its own task if pursued. List the dropped boards LOUDLY (a note) so a
  multi-board `.d2` doesn't silently show only page 1.

## Recommended phasing
1. ✅ **Phase A (no WASM) — DONE 2026-06-25:** `shape: text` + `shape: code` basic render in `toSVG` (#2). Cheapest, immediate.
2. **Phase B (one WASM bump, batched with task 121):** extend `outEdge` (#1) + `outShape` (icon #3, label-type #4, tooltip/link #5) + task-121 effect booleans + the fields tracked in **tasks 127–130, 132, 134, 135** (direction, arrowhead shapes, text styles, explicit width/height, `vars.d2-config`, label/icon positioning, grid-gap/edge-radius) — capture EVERY missing field in ONE Go rebuild (per the task-121 note). Then consume incrementally in `toSVG`. (Task 133 = sql column/FK edges, edge-resolution; task 131 = d2 imports, separate / likely won't-do.)
3. **Phase C (optional, large):** multi-board (#6) — only if there's demand.

## Verification (every item)
- Render the feature through the production pipeline (`tmp/d2-compare` harness / real-VS-Code suite) and
  compare against the real `d2` binary (`projects/tala/bin/d2`) — same fidelity bar used for shapes + themes.
- Unit + e2e per item; keep `d2-quality.test.ts` / `d2-theme.test.ts` / typecheck / `lint:ci` green.
- Each item that can't render faithfully must keep the **faithful-by-construction** contract: extend
  `unsupportedReason` (loud raw-source fallback) rather than draw something wrong.
