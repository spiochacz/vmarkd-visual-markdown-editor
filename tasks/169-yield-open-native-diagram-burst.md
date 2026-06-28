# Task 169 — Yield a frame between native diagram renders on the open burst (spike-first)

**Status:** TODO (big / **spike-first** — confirm the native loop blocks the critical path before committing to the M-effort esbuild patch; the originally-proposed fix site was **wrong**, relocated below).
**Source:** vMark perf analysis (2026-06-28, 39-agent workflow `wf_19aa433d-4fa`).
**Value / Risk:** 🟨 medium (lets hljs colouring + paint interleave during a multi-diagram open burst) / 🟡 medium (esbuild patch on a Vditor seam + caret/scroll contract).
**Engines:** native-deferred (mermaid/echarts/graphviz/…).

## Problem (and the corrected diagnosis)

The custom-engine family already yields a frame between renderers (`custom-diagrams.ts:840-856`,
added by task 145 to stop synchronous renders starving hljs colouring — comment quantifies ~4.8 s on
a 15-diagram doc). The **native** open burst is the unthrottled analogue: it loops
`.vditor-ir__preview[data-render='2']` calling `processCodeRender` back-to-back **synchronously**
with no yield, so on a multi-mermaid/echarts doc the main thread is blocked through all layouts
before code colouring paints.

> **The candidate originally pointed at `deferIrDiagramRender` (`edit-activity.ts`) — that is the
> wrong path.** That hook is esbuild-wired only into Vditor's `ir/input.ts` (the per-INPUT/typing
> loop, `esbuild-shared.mjs:960-961`); on open no `input` event fires, `markEditActivity` sets
> `isTyping()` in capture phase (`edit-activity.ts:310-314`), and the line-269 not-typing branch
> effectively never runs on open. The **real** open-burst native loops are in Vditor:
> - `EditMode.ts:69-71` — `setEditMode(vditor,'ir',afterRender)` (via `initUI.ts:81`) on open;
> - `index.ts:330-335` — `setValue`, used by the streaming/refresh path (`main.ts:534`).
> Neither is patched (`patchIrDeferDiagramRender`'s anchor is `ir/input.ts`-only; `String.replace`
> per-file scope leaves `EditMode.ts`'s identical loop untouched).

## Spike (do this FIRST)

Write a **real-VS-Code open-perf spec** (`test/vscode-e2e/`, extend `perf-timeline.spec.ts`) on a
multi-mermaid/echarts doc and confirm the native loop actually blocks the critical path **before
interactivity** — and that the **task-38 inline-init + the prerender teaser don't already mask** the
perceived first-paint latency. If they do, **kill this** (the perceived win is already captured by
those). Promote to implementation only if the spike shows the synchronous native burst is the real
stall.

## Plan (if the spike confirms)

Add a **new** esbuild patch wrapping the **`EditMode.ts:69-71`** native loop to `await` a frame
between `NATIVE_DEFER` (mermaid/echarts/graphviz/…) renders, mirroring `custom-diagrams.ts:840-856`.

## Constraints
- **The `setValue` path (`index.ts:330-335`) is wrapped by `preserveCaretAndScroll` (`main.ts:534`)
  which assumes a SYNCHRONOUS `setValue`** — making its inner loop async/frame-yielding breaks that
  contract (caret/scroll restore fires before renders land). Likely: leave `setValue` sync, or
  restore caret after the burst settles. The pure-open `EditMode.ts` path is lower-risk (caret at
  top).
- Keep the keep-last-overlay semantics consistent with the typing path.
- Lute round-trip + CSP/Worker untouched (only render **scheduling** changes; engines stay
  main-thread). No `Date.now`/`Math.random`.

## Verification
- The spike's perf spec is the gate (and proves it's not already masked).
- **Real-VS-Code e2e (MANDATORY)** if shipped: multi-diagram open still renders all diagrams, caret
  at expected position, no scroll jump; hljs colouring paints during (not after) the burst.
- Keep `custom-diagrams-render` + streaming specs green. `tsc` + `biome` + vitest + Playwright,
  headless. Verify coverage + the esbuild patch's anchor-drift assert.

## See also
- **Note the overlap with task 168** (viewport-gate the initial render): 168 *skips* offscreen
  diagrams (removes CPU), 169 only *spreads* the visible burst across frames (reschedules). If 168
  lands, much of 169's burst shrinks to the visible set — consider sequencing 168 first and
  re-measuring whether 169 is still worth it.
- `custom-diagrams.ts:840-856` (the precedent), `esbuild-shared.mjs` (`VDITOR_TS_PATCHES`,
  `patchIrDeferDiagramRender`), task 145 (the hljs-starvation finding), task 38 (inline init), task 50
  (prerender teaser).
