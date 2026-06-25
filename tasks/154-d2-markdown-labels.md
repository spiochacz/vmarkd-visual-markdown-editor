# Task 154 — D2 markdown labels (`|md|`) rendered formatted (foreignObject + Lute)

> **Status:** 📋 TODO (spike-first; size-neutral). Came out of the TinyGo d2-WASM slimming
> (`[[d2-wasm-tinygo-spike]]`): the compile-only WASM never emitted rendered markdown, and the TinyGo
> build dropped d2's Go `RenderMarkdown` entirely — so this is the JS-side replacement, where it
> belongs in our architecture (WASM = structure, JS = render).

## Problem
D2 supports markdown text shapes:
```d2
note: |md
  # Heading
  - **bold** point
  - a [link](https://x)
|
```
d2 compiles this to a shape with `shape: "text"` and the **raw markdown source** as the label. Our
renderer draws every label as a plain, XML-escaped SVG `<text>` element (`d2-render.ts` — see the
`<text …>${esc2(s.label)}</text>` sites around `:1422` / `:1471` / `:1519` / `:1659`). So a `|md|`
block shows up as literal `# Heading - **bold** …` text — **no formatting** (headings, bold, lists,
tables, links all lost).

Note this was **never** rendered, even with the stock-Go WASM: that WASM emitted only the graph
structure (label = raw md), and d2's Go `RenderMarkdown` produced HTML that our pipeline discarded.
The TinyGo change (minimal `textmeasure` stub) didn't regress anything — it just made the redundancy
explicit. This task is the feature we never had.

## Approach (JS render layer — we already have the pieces)
1. **WASM:** emit a flag distinguishing a markdown text shape from a plain text shape. d2 knows this
   at compile time (the shape's `Language == "markdown"`); surface it as e.g. `isMarkdown bool` on
   `outShape` in `media-src/vendor/d2/build/main.go` (one field, mirrored in `D2Shape` in
   `media-src/src/d2-wasm.ts`). Rebuild the WASM via `build-d2-wasm.sh` (TinyGo). Alternatively detect
   markdown syntax JS-side, but a compile-time flag is unambiguous.
2. **toSVG:** for a markdown shape, render `lute.Md2HTML(s.label)` and embed it with `<foreignObject>`
   instead of `<text>`:
   ```
   <foreignObject x y width height>
     <div xmlns="http://www.w3.org/1999/xhtml" class="vmarkd-d2-md">${lute.Md2HTML(s.label)}</div>
   </foreignObject>
   ```
   Lute is already loaded in the webview and exposes `Md2HTML` (used in `custom-renderer.ts:71`); it's
   full GFM (tables, strikethrough) — a superset of d2's goldmark.
3. **Theming:** HTML inside `foreignObject` inherits page CSS (`currentColor`) → follows the content
   theme for free, like KaTeX (theming model #1 in the `vmarkd-renderer-theming` skill). No palette
   plumbing, no live re-render wiring.
4. **Sizing (the fiddly part):** ELK/dagre need node dimensions **before** layout. Plain text is sized
   via `canvasMeasure`; markdown must be measured as rendered HTML — render the `Md2HTML` output into
   an offscreen, width-constrained element, read its bbox, feed it back as the node size. This is
   exactly the role d2's `lib/textmeasure` played server-side (which we stubbed); we move it to the DOM.

## Decision gates
- **Raster/export caveat (the real gate).** `<foreignObject>` is notoriously unreliable when
  rasterizing SVG→PNG (`canvas.drawImage` of an SVG containing foreignObject often taints the canvas
  or renders blank). On-screen webview rendering is fine. If/when d2 diagrams get a raster export path,
  markdown labels may not rasterize — plain `<text>`/`<tspan>` always does. Decide whether to (a) accept
  formatted-only-on-screen, or (b) fall back to flattened `<text>` for export. Verify against any
  existing export feature before committing.
- **Sizing pass cost:** an extra offscreen measure per markdown node. Acceptable (few nodes), but
  measure before/after on a heavy diagram.
- **Scope:** start with `|md|` text shapes only. Inline markdown in *regular* node labels (d2 also
  allows it) is a possible follow-up; keep the first cut to the explicit `|md|` block.
- **CSP:** none — inline HTML in `foreignObject` is covered by `style-src 'unsafe-inline'` (already
  shipped). No new hole.

## Acceptance / tests
- [ ] Unit (`d2-render.test.ts`): a hand-built Layout with an `isMarkdown` text shape emits a
  `<foreignObject>` containing the Lute-rendered HTML (`<h1>`, `<strong>`, `<ul>`, `<table>`), not a
  flat `<text>`; a plain text shape still emits `<text>`.
- [ ] Unit (`d2-wasm.test.ts`): a `|md|` shape compiles with `isMarkdown:true`; a plain text shape
  `false`. (Boots the real TinyGo WASM — keep the `ctx.global` shim.)
- [ ] Node measurement: markdown node dimensions reflect the rendered HTML (taller for multi-line),
  feeding ELK/dagre — no clipped/overlapping markdown nodes in the render harness
  (`media-src/scripts/d2-render-harness/`).
- [ ] Visual (harness): a `|md|` block renders formatted (heading/bold/list/table) and follows the
  content theme (currentColor) on light + dark.
- [ ] Decide + document the raster-export behaviour.

## Related
Tasks 104 (d2 renderer), 127/128/133/126 (d2 feature batch). Spike `[[d2-wasm-tinygo-spike]]` (why Go
RenderMarkdown was dropped). Files: `media-src/src/d2-render.ts` (`toSVG` text sites),
`media-src/vendor/d2/build/main.go` (`outShape`), `media-src/src/d2-wasm.ts` (`D2Shape`),
`media-src/src/custom-renderer.ts:71` (`lute.Md2HTML` precedent). Skill: `vmarkd-renderer-theming`
(foreignObject = theming model #1, currentColor).
