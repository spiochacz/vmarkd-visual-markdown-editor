# Task 173 — Scope the 3 synchronous per-keystroke observers to the mutated subtree

**Status:** TODO (medium; secondary side-effect cleanup — the spin still dominates).
**Source:** vMark edit-responsiveness analysis (2026-06-28, workflow `wf_2c64003e-264`).
**Value / Risk:** 🟨 medium on large / blockquote-heavy / code-heavy docs (marginal on typical docs) / 🟡 medium (record→block mapping + a correct full-walk fallback).
**Engines:** none (decoration observers).

## Problem

`observeCodeSource` (`code-source.ts:71-73`), `observeCallouts` (`callouts.ts:394-396`) and
`observeHtmlComments` (`html-comment.ts:96-98`) are each `new MutationObserver(() =>
fullWalk(editorEl))` — they **ignore the `MutationRecord`s** and run a **whole-`#app`
`querySelectorAll` on every keystroke, synchronously, before paint** (not rAF-coalesced). The spin
replaces **one** block's `outerHTML` (`ir/input.ts:185` — a single record), yet each observer
re-queries the whole editor; cost scales with `#blockquotes` / `#code-blocks` / `#html-blocks`. This
is the largest pure **side-effect** cost and is identical for prose and diagram-source editing.

> The `finish-init.ts:73/:87` comments claiming these are "rAF-debounced" are **stale** — the live
> code is synchronous. Fix the comments as part of this task.

These observers are synchronous **by design** — the no-flash-before-paint contract (`code-source.ts:14-16`,
`callouts.ts:383-388`) keeps the raw `[!TYPE]` marker / un-coloured source from flashing. So the goal
is to keep them sync but turn **O(document)** into **O(changed block)**.

## Plan

Pass the `MutationRecord`s into each callback; for each record resolve `record.target`'s (or its
`addedNodes`') closest top-level block and `querySelectorAll` **within** that block; dedupe across
the batched records (union the closest-block of `record.target` **and** `addedNodes`). Existing
idempotent guards (`decorateCallout` signature `callouts.ts:127`, comment sig `html-comment.ts:49`,
`.hljs` tagging) keep re-decoration safe.

## Constraints
- **Keep synchronous** (do NOT rAF — the flash contract).
- **Full-walk fallback for MORE than one case:** any record whose target is `ir.element` — both the
  `isIRElement` innerHTML replace (`ir/input.ts:183`) **AND** the link-ref-def / footnote relocations
  (`ir/input.ts:205-231`, which `insertAdjacentElement` blocks elsewhere) — must trigger a full walk,
  else a relocated/edited block silently loses decoration. (The candidate under-counted this — it's
  not just `:183`.)
- `characterData` records (source text changing) carry no `addedNodes` → must always pass so type
  changes still refresh.
- Round-trip / caret untouched (scoping changes the **search scope**, not what gets decorated; the
  Lute-invisibility guards `.hljs`, `vditor-ir__preview`+`ce=false`, comment sig stay intact). The
  spin runs before the observer microtask and these observers never touch selection.
- Scoping alone does **not** remove the cross-observer wakeup amplification — that's task 174.

## Verification
- **Real-VS-Code e2e (MANDATORY):** the existing `diagram-bg` / `content-theme` / callout no-flash
  specs stay green; add a large blockquote-/code-heavy fixture asserting decorations apply correctly
  after edits in arbitrary blocks (incl. a relocated ref-def block → full-walk fallback fires).
- Fix the stale `finish-init.ts:73/:87` `rAF-debounced` comments.
- `tsc` + `biome` + vitest + Playwright, headless. Verify coverage.

## See also
- **Strongly consider doing this as part of task 176** (one shared observer + the unified pass is a
  simpler home for record-scoping than per-file mapping across three files). 174 (ignore decoration
  mutations) layers on top.
- `code-source.ts`, `callouts.ts`, `html-comment.ts`, `finish-init.ts`; memory `callouts-observe-app-mount`,
  `github-theme-leaks-onto-ir-source`.
