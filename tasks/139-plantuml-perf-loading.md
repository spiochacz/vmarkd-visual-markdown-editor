# Task 139 — PlantUML engine size / first-render latency + loading affordance

> **Status:** 💡 idea / low priority — created 2026-06-24. Documented trade-off of the offline engine
> (task 87), not a bug. Builds on task 87.

## Problem
The offline PlantUML engine is large: `plantuml.js` 7.2 MB + shared `viz-global.js` 1.4 MB (~2 MB
gzip). It's lazy-loaded (only when a ` ```plantuml ` block exists), but the **first** PlantUML render
in a session pays the full download + TeaVM warm-up — a noticeable delay — with **no loading
indicator**; the block just sits empty until the SVG appears.

## Options (low-effort → higher)
1. **Loading affordance** — show a lightweight "rendering PlantUML…" placeholder in the block while the
   engine loads/first-renders (the engine is already async). Cheapest UX win.
2. **Warm-load** — kick off the engine fetch as soon as a plantuml block is detected (idle/prefetch),
   so it's ready before the user scrolls to it. Careful: don't fetch 9 MB if the doc has no plantuml
   (already gated) or on every keystroke.
3. **Size reduction** — investigate a slimmer TeaVM build / tree-shaken diagram types (overlaps task
   137). Likely upstream-bound; low ROI.

## Decision gate
Is the first-render delay actually painful in practice? If yes → option 1 (placeholder) is the obvious
small win. Options 2/3 only if it's a real complaint.

## Acceptance / tests
- Option 1: a plantuml block shows a placeholder until its SVG lands; no layout jump when it swaps in.
- Engine still loads only when a plantuml block is present (no regression to the lazy-load gate).

## Related
Task 87 (lazy-load + vendored engine). `patchPlantumlRender` (`addScript`/dynamic `import`) in
`media-src/esbuild-shared.mjs`; `custom-diagrams`/preview render path.
