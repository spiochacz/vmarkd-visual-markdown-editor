# Task 158 — Inline diagram zoom / pan + ⛶ fullscreen button

> **Status:** 🟢 DONE (inline) — 2026-06-26; gestures Ctrl-gated 2026-06-27. **Ctrl/Cmd + wheel** =
> zoom toward the cursor, **Ctrl/Cmd + left-drag** = pan, double-click = reset, on every rendered
> static-SVG diagram (d2/mermaid/flowchart/graphviz/abc/smiles). (Plain wheel/drag were hijacking page
> scroll + selection the moment the pointer crossed a diagram — "przy dojechaniu zaczyna zmieniać
> rozmiar" — so BOTH zoom and pan are now Ctrl-gated, matching markmap/mindmap (`diagram-zoom-gate.ts`);
> plain wheel scrolls the page, plain drag selects/does nothing.)
> markmap + the ECharts mindmap keep their OWN zoom (gated by `diagram-zoom-gate.ts`) and are excluded.
> The ⛶ fullscreen button is **built but GATED OFF** (`FULLSCREEN_BUTTON = false` in `diagram-zoom.ts`,
> per the user) until the proper fullscreen *preview* (overlay chrome, controls, design TBD) is built —
> **task 157**. Flip the flag to re-enable the button as that task's entry point.

## What shipped
- New `media-src/src/diagram-zoom.ts`: `observeDiagramZoom(#app)` (MutationObserver, rAF-debounced,
  idempotent) decorates each rendered static-SVG diagram inside a preview pane. Per-svg transform state
  in a `WeakMap`; CSS `transform: translate(tx,ty) scale(k)` on the `<svg>` (`transform-origin:0 0`).
  - **wheel** → zoom toward the cursor (keeps the point under the pointer fixed), `preventDefault`'d so
    the page doesn't scroll under the diagram (chosen with the user: the diagram is an interactive
    surface). Clamp k ∈ [0.4, 12].
  - **left-drag** (pointer events + capture) → pan. **double-click** → reset to fit-width.
  - **⛶ button** (top-right, `data-render="1"` so it can't leak into Lute serialization) → native
    `requestFullscreen()` on the container; the same transform handlers keep working inside.
- Wired in `main.ts runFinishInit` (`disposeDiagramZoom = observeDiagramZoom(...)`), beside the other
  observers — survives IR/WYSIWYG/Preview switches, async D2 renders, and per-keystroke rebuilds.
- CSS in `main.css` (`.vmarkd-diagram-fs`): top-right, fades in on hover/focus, `--vscode-*` colours;
  a `:fullscreen` backdrop = editor bg so transparent/paired diagrams stay legible.
- `user-select: none` on zoom-decorated diagrams in the **IR + WYSIWYG** panes (a click there opens the
  source for editing, so text selection is pointless + fought the Ctrl-drag pan). The read-only full
  Preview pane keeps selection. (2026-06-27)

## Tests
- **Real-VS-Code e2e** `test/vscode-e2e/diagram-inline-zoom.spec.ts`: opens `all-renderers.md`, asserts
  every static-SVG diagram is decorated + has a ⛶ button, and drives the real handlers — wheel →
  `scale>1`, drag → transform changes, dblclick → `scale(1)`. PASSED (15 decorated, 14 buttons).
- **No unit test:** the module is pure DOM + pointer/wheel geometry; jsdom has no layout
  (`getBoundingClientRect`/transforms are 0), so the real webview is the only faithful level — same
  precedent as `diagram-zoom-gate.ts` (e2e-only). Behaviour is fully covered by the e2e above.

## Follow-ups
- **Task 157** — the proper fullscreen *preview* (overlay vs Fullscreen API, controls, scope, theming).
- Possible: a Ctrl-gate option if plain-wheel-zoom-over-a-diagram annoys (today it always zooms, per the
  user's request) — mirrors `diagram-zoom-gate.ts`. Revisit only on feedback ([[diagram-ctrl-zoom-gate]]).

## Related
Memories: [[diagram-fill-width]], [[diagram-ctrl-zoom-gate]], [[show-partial-results-for-eval]].
Files: `diagram-zoom.ts`, `main.ts` (wiring), `main.css` (`.vmarkd-diagram-fs`),
`diagram-inline-zoom.spec.ts`. Sibling: `diagram-zoom-gate.ts` (the markmap/mindmap Ctrl-gate, distinct).
