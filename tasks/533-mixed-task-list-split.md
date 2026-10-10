# Task 533 — A list mixing task items and plain items is split into three lists

**Status:** 📋 planned (diagnosed 2026-10-10, no fix applied) · **Impact:** 🟡 med (on-disk fidelity:
a tight mixed list is rewritten loose on the first edit) ·
**Origin:** found by task 532's task-list work; user decision 2026-10-10: record as a task, do not fix now.

## Problem

`- [x] a\n- plain\n- [ ] b` (one tight list in GFM) is parsed by Lute as THREE lists. Every
serializer then joins sibling lists with a blank line, so after the first edit the file reads
`- [x] a\n\n- plain\n\n- [ ] b`. Ordered lists do the same (`1. [ ] a\n2. b`). Stock Lute behaves
identically — this is not caused by our build-time anchors.

## Diagnosis (measured on the vendored blob, 2026-10-10)

- The split happens in the markdown PARSER, before any of our layers see the document — not in the
  DOM walkers or renderers.
- `parseBulletListMarker` sets `ListData.Typ = 3` on a task item (a plain bullet is `Typ 0`; ordered
  task items also get 3). `listsMatch(d, e)` decides whether an item continues the open list and
  requires `d.Typ === e.Typ` (plus `Delimiter` and `BulletChar`), so every task/plain boundary closes
  the list and opens a new one.
- Evidence: `Md2VditorIRDOM('- [x] a\n- plain\n- [ ] b')` yields three `<ul data-tight="true">`;
  `MarkdownStr` gives three `<ul>`.

## Candidate fix (prototyped, then reverted)

One count-asserted build-time anchor in `listsMatch` (the `scripts/lute-blob-patch.mjs` mechanism,
task 530): replace `return(d.Typ===e.Typ)&&(` with
`return(d.Typ===e.Typ||3===d.Typ||3===e.Typ)&&(`. The `Delimiter` / `BulletChar` checks still keep
ordered vs bullet and `-` vs `*` lists apart.

Prototype result: byte-identical round trip in IR, WYSIWYG, after a spin and in split view for
tight, loose, nested, plain-first, task-first and ordered mixes; real-VS-Code specs (IR, WYSIWYG,
sv) and a 7-case unit corpus green, red with the anchor broken. Side effect: a half-loose list
(`- [x] a\n- plain\n\n- [ ] b`) is normalised to fully loose, which is standard CommonMark.

## Steps

- [ ] Decide: ship the anchor (it patches the PARSER, a step beyond the DOM-bridge anchors so far)
      or keep this as a known Lute limitation.
- [ ] If shipped: anchor + unit corpus (`test/backend/lute-patch-kit.ts`) + real-VS-Code spec
      (edit inside a mixed list → saved bytes; IR, WYSIWYG, sv), red-green-red.

## See also

- Task 532 (task-list anchors T1–T6, loose-list anchors L1–L3), task 530 (the anchor mechanism).
- Skill `vmarkd-lute-features` (lists are whole-list AST; `ListData.Tight`).
