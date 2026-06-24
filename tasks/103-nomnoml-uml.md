# Task 103 — nomnoml lightweight UML

> **🔎 Audit 2026-06-24 (task 142):** IMPLEMENTED — `renderNomnoml` is wired in `custom-diagrams.ts`
> (nomnoml 1.7.0 vendored); status below is stale. Verify-first: theming — do `#fill`/`#stroke`
> directives + default colours follow / clash with the content theme? Mark done once theming verified.

> **Status:** 📋 TODO (after [task 99](99-geojson-topojson-maps.md) — reuses its renderer pass).
> Render ` ```nomnoml ` fenced blocks as UML diagrams. nomnoml is a tiny, pure-JS UML language —
> a lightweight, fully-offline alternative to PlantUML (task 87) for class/relationship sketches.
> Supported by Kroki.
> **Source:** ecosystem survey; user request.
> **Value / Risk:** 🟢 clean + offline UML / low — small pure-JS lib, SVG output.

## Problem
PlantUML (task 87) is heavy/awkward offline; nomnoml gives quick UML from a simple DSL
(`[A] -> [B]`, `[A|field;method()]`) with a tiny dependency.

## Approach
1. **Reuse the custom fenced-renderer pass** from task 99 — register `{ lang: 'nomnoml', fn }`.
2. **Lib** — **nomnoml** (MIT, small, pure-JS, SVG). Add as a `media-src` dep; lazy-import.
   `nomnoml.renderSvg(source)` → inline SVG.
3. **Render** — `nomnoml.renderSvg(code)` → set as the block's innerHTML; `data-processed` guard.
4. **CSP / offline** — pure-JS SVG, no remote, no eval. Fits our CSP. ✅
5. **Theme** — nomnoml supports **style directives** (`#fill`, `#stroke`, `#background`,
   `#fontColor`, …) prepended to the source. Inject palette-derived directives (`#stroke: line`,
   `#fontColor: fg`, `#fill: surface`, `#background: transparent`) — reuse the shared mapping
   (task 86/90); user directives in the source still override. Live re-theme on flip.

## Tests (per AGENTS)
- **e2e** — a ` ```nomnoml ` block renders an SVG diagram (not a code block) with palette stroke/text
  colors; theme flip re-renders; a source with its own `#stroke` keeps it.

## See also
- Skill `vmarkd-renderer-theming` (style-directive injection mirrors graphviz DOT-attr/task 94);
  task 99 (renderer pass); task 87 (PlantUML — the heavier UML option). [Kroki diagram set](https://kroki.io/).
