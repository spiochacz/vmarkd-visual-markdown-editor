# Task 125 — Render D2 `sequence_diagram` via mermaid (transpile + reuse the mermaid engine)

> **Status:** 💡 idea / planned (decision-gated) — created 2026-06-24. A prototype was written and
> **reverted the same day at the user's request** (kept as a task instead of shipping). Splits the
> "sequence_diagram" item out of task 124 (which lists it as out-of-scope/keep-fallback). Builds on
> task 104 (D2 renderer) + the mermaid pipeline (tasks 59/86).

## Problem
A D2 `sequence_diagram` currently hits the loud fallback (`unsupportedReason` → raw source + note):
our `toSVG()` can't draw d2's bespoke sequence layout (lifelines, activation spans, groups, notes),
and we deliberately don't bundle d2's official renderer. So users see source text, not a diagram.

## The lever
mermaid is **vendored, offline, and already themed** (tasks 59/86) and has a first-class
`sequenceDiagram`. PlantUML is NOT an option — it renders via a remote image and is blocked by our
CSP (`object-src 'none'`). So the play is: **transpile the compiled D2 sequence graph → a mermaid
`sequenceDiagram` string, then render it through Vditor's `mermaidRender`** (the same engine native
` ```mermaid ` blocks use).

## What the data gives us (already extracted by the compile-only WASM)
`compileD2` returns enough for a basic transpile:
- `graph.sequence` (boolean flag; also `shape.special.isSequence` for the nested form)
- `graph.shapes` = participants, in declaration (left-to-right) order, each with `id` + `label`
- `graph.edges` = messages **in declaration order**, each `{ src, dst, label, srcArrow, dstArrow }`

That maps cleanly to:
```
sequenceDiagram
  participant p_<id> as <label>      // one per non-sequence shape, in order
  p_<src>->>p_<dst>: <label>         // one per edge, in order; reverse endpoints when only srcArrow
```
(ids sanitised to mermaid-safe tokens via a shared `alias(id)` so messages line up with participants.)

## Prototype shape (reverted — reference for implementation)
- New `media-src/src/d2-sequence.ts`: `d2SequenceToMermaid(graph): string | null` — returns null when
  it's not a sequence or has no messages (→ caller keeps the raw fallback).
- Wire in `custom-diagrams.ts` `renderD2`, BEFORE `unsupportedReason`: if `d2SequenceToMermaid` returns
  a string, inject a `<div class="language-mermaid">` into the wrapper and call
  `mermaidRender(wrapper, cdn, dark)` (dark = `.vditor--dark` present); stamp
  `data-d2-engine="mermaid-sequence"`.

## Limitations / open questions (why it's decision-gated)
- **Lossy transpile vs faithful-by-construction.** This renders a DIFFERENT-but-equivalent picture,
  not d2's own. d2 sequence features NOT in our compiled graph are silently dropped:
  **activation spans, groups, notes, self-references styling, actor shapes**, and edge **dash/style**
  (our `outEdge` has no style → every message becomes a solid `->>`). Decide: is a best-effort
  transpile acceptable here, or does it violate the "never show a subtly-wrong picture" rule? Options:
  (a) ship best-effort with a small "rendered via mermaid" affordance; (b) only transpile when the
  sequence uses sub-features we KNOW we cover, else keep raw fallback; (c) extract spans/groups/notes
  in a WASM bump (task 124 Phase B) and transpile more fully.
- **Live re-theme.** The injected mermaid has no editable-source sibling, so `reRenderMermaid` (theme
  flip) skips it; it only re-renders when the D2 block itself re-renders. Acceptable or wire explicitly?
- **Message ordering with spans/groups.** Plain edge order is correct for simple sequences; nested
  groups/alt/loop would need the structure we don't currently extract.

## Acceptance / tests
- Unit: `d2-sequence.test.ts` — participants + ordered messages, reverse-arrow handling, null for
  non-sequence / no-edge graphs, id sanitisation.
- e2e: a `shape: sequence_diagram` D2 block renders a mermaid `<svg>` (real-VS-Code suite), follows the
  mermaid theme, and an empty/edge-less sequence still falls back to raw source.
- Keep `unsupportedReason` as the fallback for sequences we choose NOT to transpile + for `near`.

## Related
- Task 124 (other D2 feature-parity gaps; this was item "out of scope"). Task 104 (renderer),
  59/86 (mermaid render + palette). `unsupportedReason` in `media-src/src/d2-render.ts`.
