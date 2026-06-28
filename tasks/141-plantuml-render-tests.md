# Task 141 — PlantUML render test coverage (real-VS-Code "SVG actually rendered" assertion)

> **Status:** ✅ DONE 2026-06-27 — `test/vscode-e2e/plantuml.spec.ts` renders a ` ```plantuml `
> sequence block in the real VS Code webview and asserts (1) the wrapper contains an `<svg>` (TeaVM
> engine booted + rendered, not raw source / not the remote `<object>`), and (2) `themePumlSvg` ran:
> no baked `#181818/#000000` foreground survives, participant boxes use the faint `currentColor` tint,
> the transparent bg rect is gone, and the text fill resolves to the theme foreground (not black) on
> `vscode-dark-2026`. Headless via `xvfb-run -a`. Created alongside [task 144](144-plantuml-architecture-hardening.md)
> item 2 (which extracted the render+theme logic into the tested `media-src/src/plantuml-render.ts`).
> The optional theme-flip-re-render bullet (`reRenderPlantuml`) is covered by the live re-theme code
> path + the shared offscreen pattern; a dedicated flip assertion can be added later if needed.
> Builds on task 87.

## Problem
Offline PlantUML (task 87) is under-tested for the thing that matters: that it **actually renders an
SVG**. Today we have:
- a **unit** test that the esbuild patch's anchor exists (`test/backend/vditor-source-patches.test.ts`)
  — guards drift, not rendering;
- a **fixture** (`test/vscode-e2e/fixtures/all-renderers.md`) used by `parity.spec` — but no explicit
  assertion that the plantuml block produced an `<svg>` (vs an error / raw source).

So a regression in the TeaVM load, the `render` call, or `themePumlSvg` could ship unnoticed.

## Goal
A real-VS-Code e2e (`test/vscode-e2e/`) that:
- renders a simple ` ```plantuml ` sequence block and asserts the wrapper contains an `<svg>` (engine
  booted + rendered in the webview, not the remote `<object>` and not raw source);
- asserts `themePumlSvg` ran (e.g. baked `#000000` replaced → `currentColor` present on strokes/text);
- (with task 138/87) a theme flip re-renders (`reRenderPlantuml`) without error.
- Must be headless-friendly per AGENTS.md (`xvfb-run -a`); the engine is large, so allow a generous
  timeout / mark slow.

## Acceptance / tests
- The new spec passes in the real-VS-Code suite; CI-suitable (or clearly marked local/slow if the 9 MB
  engine load is too heavy for CI — document which).
- Pairs with task 137's support-matrix test (share the harness).

## Related
Task 87 (engine), 137 (type matrix), 138 (theming). `vditor-source-patches.test.ts`,
`test/vscode-e2e/`, `plantuml-retheme.ts`.
