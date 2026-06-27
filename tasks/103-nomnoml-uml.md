# Task 103 — nomnoml lightweight UML

> **🔎 Audit 2026-06-24 (task 142):** IMPLEMENTED — `renderNomnoml` is wired in `custom-diagrams.ts`
> (nomnoml 1.7.0 vendored); status below is stale. Verify-first: theming — do `#fill`/`#stroke`
> directives + default colours follow / clash with the content theme? Mark done once theming verified.
>
> **✅ Verify 2026-06-27 (103b):** theming CONFIRMED complete — `themeNomnomlSvg` recolors nomnoml's
> baked palette (text/stroke `#33322e` → currentColor; node fill `#eee8d5`/`#fdf6e3` → currentColor @
> 0.06) on `fill`/`stroke` ATTRIBUTES. A probe on github-dark showed every nomnoml SVG colour resolves
> to `currentColor`/`transparent`/`none` — including a NESTED-container example (depth 3) added to the
> fixture: nomnoml uses only those 2 baked colours at every nesting level (NO per-depth shade array, so
> the suspected "deep-nested beige on dark" gap does NOT exist — no code change needed). Custom
> `#fill`/`#stroke` colours aren't in the recolor lists, so they survive as-authored (respected). The
> theming was previously UNASSERTED (e2e only logged colours); now locked by
> `test/vscode-e2e/nomnoml-theme.spec.ts` (flat + nested, no baked colour survives on dark). No
> `media-src` change — render + theming were already correct; this round is test + docs only.

> **Status:** ✅ DONE (2026-06-27 — render + theming verified incl. nested + e2e; see verify note 103b above).
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
