# Task 124 — D2 feature parity (connection styles, text/code/image, markdown/LaTeX, tooltips/links, multi-board)

> **Status:** 🟢 DONE (2026-06-25) — all directly-scoped items shipped: **#1** connection styles
> (`outEdge` stroke/width/dash/opacity/animated; reduced-motion-safe marching dashes; arrowheads follow
> the stroke), **#2** `shape: text`/`code` (borderless prose / mono panel, multi-line `<tspan>`), **#3**
> `shape: image` + decorative icons (`<image>`, CSP-gated), **#5** tooltips/links (`<title>` + `<a>` hit-
> rect, SVG-anchor routing fixed in `fixLinkClick`, scheme-guarded). **#4** md/latex labels → **task 154**
> (md via foreignObject+Lute; latex via KaTeX). **#6** multi-board → **task 155**. Three WASM bumps over
> the session (all TinyGo). Each item unit-tested + visual (render harness) + fixture §18, and the whole
> set is **verified in the real VS Code webview** (`test/vscode-e2e/d2-feature-parity.spec.ts`: text/code,
> connection styles + reduced-motion animation, image/icon, tooltip, and the SVG-link click intercept).
> Audit note: the earlier Phase-B batch (127/128/133/126A) was a SEPARATE slice — arrowhead *shapes*
> (128) ≠ connection *stroke* styles (#1).
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

### 1. Connection (edge) styles — ✅ DONE (2026-06-25)
- **Done:** `outEdge` (main.go) now marshals `stroke/strokeWidth/strokeDash/opacity/animated` from
  `e.Style` (WASM rebuilt, TinyGo). `D2Edge` + a `PlacedEdge.style` object carry them through both
  engines (`edgeStyle()` helper packs them; threaded in dagre setEdge/readback + ELK edgeMeta/
  placedEdges). `toSVG` draws stroke (default `themeColor`), width (default 2), dash, opacity; the
  arrowheads follow the same effective stroke colour. `animated` marches the dashes via a CSS class
  (`.d2-anim` + `@keyframes`, injected once) guarded by `@media (prefers-reduced-motion: reduce)` —
  chosen over SMIL `<animate>` so reduced-motion is honourable. Theme colour stays the default for
  un-styled edges (so `d2Theme` still drives them). Unit tests in `d2-wasm.test.ts` (marshalling) +
  `d2-render.test.ts` (6, render/animated/default/arrowhead-colour); visual via the render harness;
  fixture block in `all-renderers.md` §18.

### 2. `shape: text` / `shape: code` — ✅ DONE (Phase A, 2026-06-25)
- **Done:** `toSVG` now branches before the shape switch — `text` = borderless, left-aligned prose;
  `code` = monospace in a subtle panel (`sty.paper` fill + `leafStroke` border). Multi-line labels
  split into `<tspan>` rows (SVG `<text>` doesn't wrap on `\n`). `textShapeBox` (exported) sizes both
  in `leafInfo` (shared by dagre + ELK): proportional Sizer per line for text; monospace char-count
  estimate for code (the Sizer has no mono font). Unit tests in `d2-render.test.ts` (6); visual via the
  render harness; fixture block in `all-renderers.md` §18 for the real-VS-Code suite. No WASM needed.
- **Fix 2026-06-26 (styled text shapes):** d2 assigns `shape: text` to any `|md|`/`|latex|`/plain-text
  label with no explicit shape, and `toSVG`'s text branch was unconditionally borderless — so an
  explicit `fill`/`stroke`/`border-radius` (e.g. a `class` style) was DROPPED. Real d2 paints a box in
  that case; we didn't, so md-label nodes rendered as text-only → invisible on a dark theme (reported on
  a C4 diagram whose `system`/`focus`/`external` classes set fills). Now the text branch paints a rect
  when the shape is styled (bare text stays borderless). Unit (`d2-render.test.ts` styled-text-box) +
  real-VS-Code e2e (`d2-feature-parity.spec.ts` `hasStyledTextBox`, fixture §18 `boxed` node).
- **Left (deferred):** syntax highlighting for `code` needs the block's **language** (not marshalled)
  → folds into the Phase-B WASM bump; reuse the highlight.js path. Markdown labels rendered as FORMATTED
  markdown (bold/headings/etc. instead of raw `**text**`) = task 154 — this fix only restores the node
  box, not md formatting of the label content.

### 3. `shape: image` + icons (`icon: <url>`) — ✅ DONE (2026-06-25)
- **Done:** `outShape` marshals `icon` (= `o.Icon.String()`). `toSVG`: `shape: image` draws a full
  `<image>` filling the box (pre-switch branch; `leafInfo` floors it to a 96×72 picture box); a
  non-image shape with an `icon` gets a small decorative `<image>` badge (top-left) in the decorations
  post-pass. **CSP** is the gate (unchanged): `img-src` allows `data:`/`blob:` always and `https:` only
  when `image.allowRemoteImages` is on — so offline diagrams use `data:` URIs; remote icons need the
  opt-in (documented). Precise icon placement (`icon.near` / position) = task 134.

### 4. Markdown / LaTeX labels (`|md …|`, `|latex …|`) — MEDIUM
- **Gap:** rendered as plain text.
- **Cost:** WASM (extract the label's *type*: text vs md vs latex vs code). md → reuse Lute/preview
  render into a `<foreignObject>`; latex → reuse the KaTeX path. `<foreignObject>` sizing must feed back
  into `dimsToFit` so layout reserves the right box.

### 5. Tooltips & links (`tooltip:` / `link:`) — ✅ DONE (2026-06-25)
- **Done:** `outShape` marshals `tooltip` + `link`. The decorations post-pass draws a transparent
  hit-rect ON TOP of each node carrying a `<title>` (hover tooltip) and/or an `<a href>` (click). Links
  go through the webview link policy: `fixLinkClick` (utils.ts) now reads the href robustly for SVG
  `<a>` (its `.href` is an `SVGAnimatedString`, not a string) → routed like any body link. `safeLinkHref`
  blocks `javascript:`/`vbscript:`/`data:`/`file:` schemes (defense in depth). Unit-tested + **verified in
  real VS Code** (`test/vscode-e2e/d2-feature-parity.spec.ts` — the SVG `<a>` click is intercepted by
  `fixLinkClick`, `defaultPrevented`).

### 6. Multi-board composition: `layers` / `scenarios` / `steps` — LARGE → split to **task 155**
- **Gap:** d2 can define multiple boards (composition / animated walkthroughs); we render only the root
  board, silently dropping the rest.
- **Moved:** spec + phasing now live in **task 155** (loud-fallback first, then static switcher, then
  interactive drill-down / step player). Significant enough for its own task; on-demand.

## Recommended phasing
1. ✅ **Phase A (no WASM) — DONE 2026-06-25:** `shape: text` + `shape: code` basic render in `toSVG` (#2). Cheapest, immediate.
2. **Phase B (WASM bumps):** ✅ **#1 connection styles DONE 2026-06-25** (own `outEdge` bump). Still
   to do in a FUTURE bump (batch with task 121): `outShape` icon #3 + label-type #4 + tooltip/link #5 +
   task-121 effect booleans + the fields in **tasks 129/130/132/134/135** (text styles, explicit
   width/height, `vars.d2-config`, label/icon positioning, grid-gap/edge-radius) — capture them in ONE
   Go rebuild. Then consume in `toSVG`. (127/128/133/126A already landed in the earlier Phase-B batch;
   task 131 = d2 imports, separate / likely won't-do.)
3. **Phase C (optional, large):** multi-board (#6) — **split to task 155**; only if there's demand.

## Verification (every item)
- Render the feature through the production pipeline (`tmp/d2-compare` harness / real-VS-Code suite) and
  compare against the real `d2` binary (`projects/tala/bin/d2`) — same fidelity bar used for shapes + themes.
- Unit + e2e per item; keep `d2-quality.test.ts` / `d2-theme.test.ts` / typecheck / `lint:ci` green.
- Each item that can't render faithfully must keep the **faithful-by-construction** contract: extend
  `unsupportedReason` (loud raw-source fallback) rather than draw something wrong.
