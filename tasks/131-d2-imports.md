# Task 131 — D2 imports (`@file`, `...@spread`) — document as unsupported (offline / no FS)

> **Status:** 💡 investigation / likely WON'T-DO — created 2026-06-24. Untasked D2 gap; unlike tasks
> 127–130 this is probably **not implementable** in our model. Captured so the limitation is explicit
> and we handle it gracefully. Builds on task 104.

## Problem
D2 supports composing a diagram from multiple files:
```d2
import: @common/styles
...@partials/header
```
We render a **single fenced ` ```d2 ` block** through a compile-only WASM (`compileD2`) given just that
block's text. There is **no filesystem** in the VS Code webview and no notion of sibling `.d2` files,
so `@import` targets can't be resolved.

## Current behaviour
A block using `@import` makes the d2 compiler fail (file not found) → `compileD2` returns an error →
`renderD2` leaves the source visible with `data-d2-error="compile"` (the loud fallback). So it already
fails safe — it just isn't obvious WHY.

## Options
1. **Document + clearer message (recommended).** Detect an `@import`/`...@` in the source (or the
   specific compiler error) and show a precise note: *"d2 imports aren't supported in a single Markdown
   code block — inline the imported content."* Cheap, honest, faithful-by-construction.
2. **Resolve against the workspace (large, host-side).** The extension host (`src/`) HAS filesystem
   access. It could pre-resolve `@import` relative to the `.md` file's folder and inline before handing
   the source to the webview. Real work (path resolution, the d2 import semantics incl. `...@` spread +
   board imports, cycle/security handling — don't read outside the workspace) and a new host→webview
   concern. Only if there's real demand.

## Decision gate
Is multi-file d2 a real use case for editing a single Markdown doc? Most ` ```d2 ` blocks are
self-contained. Default recommendation: **Option 1** (note), revisit Option 2 only on demand.

## Acceptance / tests
- Option 1: a block with `@import` shows the specific "imports not supported" note (not a generic
  compile error); self-contained blocks unaffected.

## Related
Tasks 104, 124. `compileD2` + the error/fallback path in `custom-diagrams.ts`; `unsupportedReason`.
