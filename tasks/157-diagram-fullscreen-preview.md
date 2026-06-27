# Task 157 — Fullscreen diagram preview (design + build)

> **Status:** 💡 idea / design-first — created 2026-06-26. Spun out of the inline diagram zoom/pan work
> (task 158 / this session): a ⛶ button in each rendered diagram's top-right corner needs a proper
> **fullscreen preview** to explore large diagrams (the trigger: a big C4 D2 diagram unreadable at the
> inline `max-height:480px`). The inline work ships a *minimal* fullscreen (native Fullscreen API on the
> diagram container, reusing the inline zoom/pan); THIS task is to design + build the richer experience.

## Problem
Large diagrams (D2 C4 graphs, wide mermaid/graphviz) are capped inline (`width:100%`, `max-height:480px`
— see [[diagram-fill-width]]). Inline zoom/pan (task 158) helps, but a dedicated fullscreen view is the
right surface for real exploration. The ⛶ button exists after task 158; its action needs designing.

## To decide (the "wymyślić" part)
- **Surface:** native `element.requestFullscreen()` on the diagram container (cheap, ships in 158) vs a
  custom in-webview overlay (`position:fixed` lightbox over the editor) — the overlay gives full control
  of chrome (toolbar, backdrop, close, ESC) and avoids Fullscreen-API quirks inside the VS Code webview
  iframe (needs `allow="fullscreen"` on the webview iframe — verify it's permitted by the host/CSP).
- **Controls:** zoom in/out/reset buttons, fit-to-screen, % indicator; keyboard (ESC close, +/−, 0 reset,
  arrows pan); double-click reset. Reuse the inline zoom/pan engine (task 158) or a fresh instance.
- **Rendering:** reuse the same SVG (scale up — SVG is resolution-independent, so no re-render needed) vs
  re-render at higher fidelity. For D2 specifically: same `toSVG` output, just a bigger viewport.
- **Scope:** all static-SVG diagrams (d2/mermaid/flowchart/graphviz/abc/smiles) or D2-first. markmap/
  mindmap already have their own zoom — decide whether ⛶ applies to them too.
- **Theming:** the overlay backdrop must follow the editor theme; the diagram keeps its own theme
  (transparent paired themes need a sensible backdrop so they stay legible — see [[content-theme-migration]]).

## Acceptance / tests
- [ ] Design decided + noted here (surface, controls, scope).
- [ ] ⛶ opens the fullscreen preview; ESC / close button exits; zoom/pan work; reset works.
- [ ] Real-VS-Code e2e (`test/vscode-e2e/`) — webview/renderer feature ⇒ MUST write AND run it (AGENTS):
      open a fixture, click ⛶, assert the overlay/fullscreen is shown and zoom/pan transforms apply.
- [ ] Works in IR preview pane AND the full Preview pane; survives mode switches (document-level / observer).
- [ ] typecheck + `lint:ci` green; coverage for the new code.

## Related
- Task **158** (inline diagram zoom/pan + the ⛶ button this opens) — the dependency.
- `media-src/src/diagram-zoom-gate.ts` (Ctrl-to-interact gate for markmap/mindmap — pattern reference),
  `custom-diagrams.ts` (diagram wrappers), `main.css` (diagram sizing). Memories: [[diagram-fill-width]],
  [[diagram-ctrl-zoom-gate]], [[show-partial-results-for-eval]].
