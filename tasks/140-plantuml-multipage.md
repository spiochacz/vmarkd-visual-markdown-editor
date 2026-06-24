# Task 140 — PlantUML multiple diagrams / `newpage` in one block

> **Status:** 💡 investigation / low priority — created 2026-06-24. Builds on task 87.

## Problem
PlantUML supports multiple diagrams or pages in one source:
- several `@startuml … @enduml` pairs in a row, and
- `newpage` inside a single `@startuml` (multi-page output).
Our patched `plantumlRender` calls the TeaVM `render(lines, targetId, {dark})` once per ` ```plantuml `
block and assumes a single SVG. It's **untested** what happens with multi-page/multi-diagram source —
likely only the first page/diagram renders (the rest dropped silently).

## Step 0 — VERIFY
Feed a block with two `@startuml…@enduml` and one with `newpage` through our engine and observe: does
`render` emit one SVG (first only), all of them, or error?

## Approach (if only the first renders)
- Split the block source into individual diagrams (by `@startuml`/`newpage`) and render each into its
  own SVG, stacked in the wrapper (or paginate). Keep `data-code` per sub-diagram for re-theme.
- If the engine already emits all pages, just verify layout/scroll is sane and add a test.

## Decision gate
How common is multi-page PlantUML in a single Markdown code block? Likely rare. Default: verify + document;
implement splitting only if it's a real use case.

## Acceptance / tests
- A two-`@startuml` block renders both diagrams (not just the first); a `newpage` source renders all
  pages; single-diagram blocks unchanged.

## Related
Task 87 (engine + render call). `patchPlantumlRender` in `media-src/esbuild-shared.mjs`.
