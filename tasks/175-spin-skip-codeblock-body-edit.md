# Task 175 — Skip SpinVditorIRDOM for non-structural keystrokes inside a fenced code/diagram body (flagged spike)

**Status:** TODO (big / L — **flagged spike**, highest ceiling AND highest risk; do task 172 first as the cheaper fallback).
**Source:** vMark edit-responsiveness analysis (2026-06-28, workflow `wf_2c64003e-264`).
**Value / Risk:** 🟥 high *for diagram/code-source typing* (removes BOTH residual components — the source round-trip AND the embedded-SVG re-parse) / 🔴 high (a missed escape-hatch diverges DOM from markdown until the next real spin).
**Engines:** every code/diagram engine; the **only** lever that also helps source-text-bound STL.

## Premise

A plain character typed/deleted **strictly inside a fenced code-block source**
(`.vditor-ir__marker--pre > code`) can **never** change markdown block structure — the fence ```` ``` ````
+ info-string define the block and the body is opaque to the block grammar. Vditor already
special-cases this: `ir/input.ts:19` guards `data-type !== "code-block"` for the space path, and
`:157` skips the ref-def/footnote append when `innerText.startsWith("```")`. Yet `SpinVditorIRDOM`
(`ir/input.ts:179`) still runs **unconditionally every keystroke** (listener `ir/index.ts:93-110`),
re-parsing the whole block (incl. its rendered SVG) only to reproduce identical structure. This is
the residual stutter task 161 could not touch.

The spin is **serialization-independent**: `processAfterRender` (`ir/process.ts:48-76`) debounces
`getMarkdown` (which reads the live source `--pre code` **text node**, skipping `data-render=2`) +
undo on `undoDelay`, **independent of the spin**. So skipping the spin keeps the saved markdown
byte-identical (the typed char already lives in the source text node), and caret stays naturally (no
innerHTML rebuild).

## Plan (flagged spike — ship behind a flag)

Build the **escape-hatch predicate** as the deliverable: a strict gate — caret **collapsed and
strictly inside a fenced body**, `inputType` `insertText`/`deleteContent*`, `data` has **no backtick
or newline**, **not** on the fence / info-language line, **not** composing (`ir/index.ts:82-91`
`composingLock`). On a match, esbuild-patch `input()` to **early-jump to `processAfterRender`** —
skipping the spin / DOM rebuild / `processCodeRender` while preserving the debounced
`getMarkdown`/undo — then run **exactly one real `SpinVditorIRDOM` on the existing 220 ms
edit-activity settle** (to normalize browser-split text nodes); `caret-preserve.ts` restores the
caret across that single rebuild. Fall through to a real spin on every escape hatch.

> Right mechanism = an esbuild patch in `input()` early-returning, **NOT** a capture-phase cancel
> (which would orphan the serialize/undo timer).

## Constraints (exhaustive — a miss = corruption)
- Helps ONLY code/diagram **bodies** — prose paragraphs need the spin every keystroke
  (`## `→heading, list, emphasis); this does **nothing** for prose typing latency. Pair with a
  prose-side lever (task 171 §1).
- **Escape hatches that MUST fall through to a real spin:** backtick (fence open/close), the
  info/language line (`code-block-info`), Enter/`insertParagraph`, paste, IME composition, caret on a
  fence line, selection-spanning / boundary deletes, the transient gap-paragraph after a fence.
- **Undo-stack consistency:** `addToUndoStack` snapshots an un-normalized DOM between skips — verify
  undo/redo round-trips.
- `getMarkdown`/serialize must still reflect typed chars so the save path stays **byte-identical**
  (it does — reads the source text node).
- Must run **one** real spin on the 220 ms settle to normalize browser-split text nodes.
- Off-thread is irrelevant (this avoids work; it doesn't move it).

## Verification
- **Real-VS-Code e2e (MANDATORY), heavy:** formatting correctness across the full escape-hatch matrix
  (backtick, info line, Enter, paste, IME, fence-line caret, selection deletes) **AND** byte-identical
  save **AND** undo/redo, on mermaid/d2/echarts/STL fixtures. `test/vscode-e2e/d2-edit-perf.spec.ts`
  `blockingMs` before/after.
- Anchor-guarded esbuild patch (drift-throw) + unit test; ship **behind a flag** (e.g.
  `vmarkd.advanced.fastCodeBodyEdit`, default off until the matrix is green).
- `tsc` + `biome` + vitest + Playwright, headless. Verify coverage.

## See also
- **Do task 172 first** (strip the `data-render=2` SVG out of the spin input) — it captures most of
  the diagram win at near-zero structural risk; pursue this full skip only if the GopherJS round-trip
  overhead itself (not just the SVG parse) proves material after 172.
- `ir/input.ts`, `ir/index.ts` (`composingLock`), `ir/process.ts`, `edit-activity.ts` (the 220 ms
  settle), `caret-preserve.ts`; the `vmarkd-lute-features` skill; memory `diagram-edit-debounce`.
