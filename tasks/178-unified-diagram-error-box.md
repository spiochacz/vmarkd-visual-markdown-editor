# Task 178 — Unified validation/render-error box for ALL diagram engines

**Status:** TODO (ready — mermaid is the shipped precedent to generalize). Medium.
**Source:** user request (2026-06-29) — "mermaid pokazuje błędy parsowania w niesformatowany sposób" → fixed for mermaid; generalize to every engine.
**Value / Risk:** 🟨 medium (consistent, readable validation feedback across all diagrams; today it's either an unformatted raw dump or silent nothing) / 🟢 low (per-engine catch rewrites + a shared box; preview-only, never serialized).
**Engines:** all (mermaid done; echarts, mindmap, graphviz, plantuml, math/KaTeX, d2, smiles, wavedrom, nomnoml, vega, geojson, topojson, stl, flowchart, abc, markmap).

## Premise — the mermaid precedent (already shipped, generalize it)

The mermaid parse-error UX was just fixed: `suppressErrorRendering: true` + an esbuild patch
(`patchMermaidErrorRender`, `esbuild-shared.mjs`) replaces Vditor's raw dump with a compact themed
**`.vmarkd-mermaid-error`** box — escaped message in a `<pre>` (preserves newlines + the caret
diagram), null-safe, lives in the `data-render="2"` preview (Lute-invisible), styled in
`media-src/src/main.css`. **This task generalizes that box to every engine.**

## Problem — the current per-engine landscape (audited 2026-06-29)

Whether an engine can even *report* a validation error governs the scope. **Reports errors?** —
✅ throws a hard parse/validation error (box applies) · ◑ renders its OWN error, doesn't throw (box
optional — catch only the hard throws) · ✗ effectively can't error / always renders (skip). Current
behaviour is then inconsistent: raw unformatted dump, silent nothing, or raw source.

| Engine | Reports errors? | Current behaviour | Where |
|---|---|---|---|
| **mermaid** | ✅ parse error | ✅ clean themed box | `patchMermaidErrorRender` (done) |
| **graphviz** | ✅ invalid DOT | ❌ raw `graphviz render error: <br>` dump | our `graphviz-render.ts:120-121` (+ native `graphvizRender.ts:39`) |
| **d2** | ✅ compile error | ◑ source + note ("d2: … — showing source") + `data-d2-error` | `custom-diagrams.ts:~346-363` |
| **echarts** | ✅ parse spec / `setOption` | ❌ raw `echarts render error: <br>` dump | native `chartRender.ts:31-33` |
| **mindmap** | ✅ `setOption` (rare) | ❌ raw `mindmap render error: <br>` dump | native `mindmapRender.ts:67-69` |
| **vega / vega-lite** | ✅ invalid spec | ⚠️ silent catch → blank | `custom-diagrams.ts` (per-engine catch) |
| **wavedrom** | ✅ bad WaveJSON | ⚠️ throw leaves the raw source visible | `custom-diagrams.ts:245` |
| **nomnoml** | ✅ bad syntax | ⚠️ silent catch → blank | `custom-diagrams.ts` (per-engine catch) |
| **smiles** | ✅ invalid SMILES | ⚠️ silent `catch {}` → blank svg, no feedback | `smiles-render.ts:90` |
| **flowchart** | ✅ parse error | ⚠️ no catch → uncaught throw possible | native `flowchartRender.ts:20` |
| **geojson / topojson** | ✅ `JSON.parse` (bad JSON) | ⚠️ silent catch → leave source / blank | `custom-diagrams.ts` (per-engine catch) |
| **stl** | ✅ bad ASCII STL | ⚠️ silent catch → blank | `custom-diagrams.ts:~791` |
| **plantuml** | ◑ own red "syntax error" SVG (throws only on boot/encode) | ❌ raw `plantuml render error: <br>` (infra only) | our `plantuml-render.ts:165-167` |
| **math (KaTeX)** | ◑ own red inline error (`throwOnError:false`, task 57) | ❌ raw `e.message` (secondary catch) | native `mathRender.ts:64` |
| **abc** | ✗ lenient — renders partial, warnings not throws | no catch | — |
| **markmap** | ✗ any outline is valid | no catch | — |

So a typo gives you **unformatted red text** (echarts/mindmap/graphviz/plantuml/math), **nothing at
all** (smiles/nomnoml/vega/geojson/topojson/stl), or the raw source (wavedrom) — depending on which
diagram you typed.

**Scope from the capability column:** the box targets the **12 ✅ engines** (turn raw dump / silence
into a clean box; mermaid done, so 11 to do). The **2 ◑ engines** (plantuml, math) keep their own
rendered error — apply the box only to their hard (boot/encode/secondary) throws, don't fight their
inline error. The **2 ✗ engines** (abc, markmap) are skipped — they can't meaningfully error. The
goal is **one clean, themed validation-error box everywhere an engine actually reports an error**.

## Goal

Every diagram, on a parse/validation/render error, shows the same compact themed box: engine name +
the engine's error message (escaped, newline-preserving `<pre>`), instead of a raw dump or silence.

## Plan

1. **Shared box helper + CSS** — generalize the mermaid box into a reusable
   `renderDiagramError(el, engine, message)` (new `media-src/src/diagram-error.ts`) that builds the
   `.vmarkd-diagram-error` markup (escape `&`/`<`/`>`, `<pre>` body, title = engine). Rename
   `.vmarkd-mermaid-error` → **`.vmarkd-diagram-error`** in `main.css` (keep mermaid's box pointing at
   the shared class). Expose it as `window.__vmarkdDiagramError` so the native esbuild patches can call
   it without bundling.
2. **Custom renderers** (`custom-diagrams.ts` + `smiles-render.ts`, `graphviz-render.ts`,
   `plantuml-render.ts`) — replace each raw-dump / silent / leave-source catch with
   `renderDiagramError(el, '<engine>', String(err))`. Keep **d2's** richer source+note fallback (it's
   intentional — show the source so the user can fix it; just align the note to the box's styling, or
   leave as-is).
3. **Native Vditor renderers** (`chartRender.ts` echarts, `mindmapRender.ts`, `mathRender.ts`, and
   `flowchartRender.ts` — wrap its render in a catch) — esbuild patches mirroring
   `patchMermaidErrorRender`: rewrite each `e.innerHTML = "X render error: <br>" + error` to
   `window.__vmarkdDiagramError(e, 'X', error)`, anchored + drift-throw. (graphviz/plantuml are already
   our modules via `patchGraphvizRender`/`patchPlantumlRender` — edit the module, not a new patch.)
4. **Don't flash errors while typing** — the box should appear on **settle**, not mid-keystroke
   (a half-typed diagram is "invalid" on every keystroke). Render is already debounced per task 161
   (edit-activity `isTyping` gate); confirm the error path rides that gate too (don't bypass it) so the
   box doesn't strobe during editing.
5. **Decision per silent engine** — show the box (feedback) vs keep "show source". Recommend the box
   for hard parse errors (smiles/nomnoml/vega/wavedrom), but keep the **source visible** for
   geojson/topojson (`JSON.parse` failure → showing the bad JSON is useful). Resolve while implementing.

## Constraints
- **Escape** the message (`&`/`<`/`>`) — engine errors echo user source; an unescaped `<` injects HTML.
- **`<pre>` + `white-space:pre`** to preserve multi-line errors (the user's exact complaint) + caret
  diagrams; horizontal-scroll, don't blow the `width:100%` diagram layout.
- **Null-safe** — never assume the engine left a DOM node to read (the mermaid bug: `errorElement`
  was null with `suppressErrorRendering`).
- **Preview-only / Lute-safe** — the box lives in the `data-render="2"` preview half; never the
  editable source, never serialized (round-trip byte-identical). Theme-var driven (`--vscode-*`), no
  palette interaction.
- **Native patches** carry an anchor-drift `throw` (fail the build loudly on a Vditor bump), like
  every patch in `VDITOR_TS_PATCHES`; add each to `vditor-source-patches.test.ts`.
- Keep d2's source-fallback (richest); don't regress it.

## Verification (per AGENTS.md — real-VS-Code e2e MANDATORY for renderer behaviour)
- **Unit:** each new esbuild patch (anchor found, rewrite shape, drift-throw) in
  `test/backend/vditor-source-patches.test.ts`; `renderDiagramError` escaping + `<pre>` (jsdom unit).
- **Real-VS-Code e2e** (`test/vscode-e2e/`, headless `xvfb-run -a`): a fixture with a deliberately
  **broken** block per engine family (echarts / d2 / graphviz / plantuml / smiles / vega / wavedrom /
  geojson) → assert `.vmarkd-diagram-error` (title = engine, `<pre>` message, non-empty), **no** raw
  `"… render error:"` text, **no** silent-blank. Extend the existing `mermaid-error.spec.ts` pattern;
  reuse `fixtures/`. Confirm the box does **not** appear mid-typing (settles only).
- `lint:ci` (7 parity warnings only) + `typecheck` + full vitest + Playwright green. Verify coverage.

## See also
- The mermaid precedent: `patchMermaidErrorRender` (`esbuild-shared.mjs`), `.vmarkd-mermaid-error`
  (`main.css`), `mermaid-error.spec.ts`, `mermaid-error.md` fixture — the box + test pattern to
  generalize.
- `custom-diagrams.ts` (custom-engine catches), `custom-renderer.ts`, `graphviz-render.ts`,
  `plantuml-render.ts`, `smiles-render.ts`; native `chartRender.ts` / `mindmapRender.ts` /
  `mathRender.ts` / `flowchartRender.ts`.
- ADR-0006 (diagram theming policy), task 161 (edit-debounce — the settle gate the box must ride),
  `vmarkd-renderer-theming` skill (the box CSS), `vmarkd-lute-features` skill (preview `data-render=2`
  is Lute-invisible). Validation-only MCP companion idea: task 111.
