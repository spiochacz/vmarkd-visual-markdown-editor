# Task 167 — Extend incremental serialize to WYSIWYG mode

**Status:** TODO (medium; **de-risk with a WYSIWYG-specific fidelity fuzz FIRST** — task-69's proof does not transfer). Lowest-priority of the medium bets (WYSIWYG is non-default, win is large-doc-only).
**Source:** vMark perf analysis (2026-06-28, 39-agent workflow `wf_19aa433d-4fa`).
**Value / Risk:** 🟦 low–medium (removes the full O(n²) idle serialize in WYSIWYG on large docs) / 🟡 medium (per-block `VditorDOM2Md` fidelity is UNVERIFIED — must be proven before trust).
**Engines:** none (edit/serialize hot path).

## Problem

Incremental serialize (task 69) gates strictly on `mode === 'ir'`
(`media-src/src/edit-sync-tuning.ts:34-39`), so **WYSIWYG** still pays the full super-linear
`VditorDOM2Md` via `getValue()` on every idle serialize (`media-src/src/edit-sync.ts:85-86`) and
band-aids it by widening `undoDelay` (`edit-sync-tuning.ts:50-51`). WYSIWYG is the only mode still
on the slow path.

`createIncrementalMd(serialize)` (`media-src/src/incremental-md.ts:39-41`) is **serializer-agnostic**
(zero IR assumptions), and WYSIWYG mirrors IR's top-level-block shape: `getMarkdown` does
`VditorDOM2Md(wysiwyg.element.innerHTML)` (`node_modules/vditor/src/ts/markdown/getMarkdown.ts:7`)
vs `VditorIRDOM2Md(ir.element.innerHTML)` — so wiring `innerVditor().lute.VditorDOM2Md` over
`wysiwyg.element` children is a direct mirror of `edit-sync.ts:53-87`.

## ⚠️ The risk task 69's proof does NOT cover

Task 69's byte-identical fuzz validated **only `VditorIRDOM2Md`** over IR markers
(`tasks/69-incremental-ir-serialize.md:56-78,125-138`). `VditorDOM2Md` over WYSIWYG **render-node**
DOM (not IR markers) is **unverified** — block isolation / context-sensitivity may differ. Also,
WYSIWYG preview subtrees (diagram/echarts/theme re-renders) mutate a block's `outerHTML` **without**
a markdown change → more spurious per-block re-serializes (correctly handled by range-splice, but it
dilutes the win).

## Plan (gated on the fuzz passing)

1. **First, the fidelity fuzz** (mirror task-69 step 1, in Node — no e2e harness): shim
   `window`/`self = globalThis`, `require` `media-src/vendor/lute/lute.min.js`, `SetVditorWYSIWYG`;
   `Md2VditorDOM` a doc, split into top-level blocks, assert range-splice == full `VditorDOM2Md`
   across paragraph / heading / list / table / blockquote / code / ref-def / footnote, + a 4000-edit
   fuzz. **Only proceed if 0-drift.**
2. Wire `serializeForHost`'s non-IR branch to a second `createIncrementalMd(innerVditor().lute.VditorDOM2Md)`
   over `wysiwyg.element` children.
3. Generalize `useIncrementalSerialize` (`edit-sync-tuning.ts:38`) to accept `wysiwyg`.
4. Drop the WYSIWYG `undoDelay` widening (`edit-sync-tuning.ts:50-51`) once serialize is cheap.

## Constraints
- **Keep serialize synchronous on the main thread** — do NOT move to a Worker (stock ELK/Worker
  rejection precedent; also task 70 is parked for the same reason).
- Preserve the flush-time authoritative `getValue()` drift-check + `invalidate`/`fullReset` self-heal
  (`edit-sync.ts:152-162`, `incremental-md.ts:156-161`) so a bad incremental result is **never**
  saved (memory self-heal only — the file write must stay correct: see the task-58/69 save-correctness
  invariant).
- Injected/preview DOM in WYSIWYG carries `data-render` (Lute round-trip safe) but mutates block
  `outerHTML` without a markdown change — the content-diff must tolerate that (it does: identical
  re-serialize, no caret/scroll impact). No `Date.now`/`Math.random`.

## Verification
- The Node fidelity fuzz (above) — 0 drift, 0 fallbacks — is the gate.
- **Real-VS-Code e2e (MANDATORY)**: mode-switch to WYSIWYG, large doc, output byte-identical to
  `getValue()` across typing / split / merge.
- Keep IR incremental specs green. `tsc` + `biome` + vitest + Playwright, headless. Verify coverage.

## See also
- Task 68 (IR edit/serialize perf), task 69 (incremental IR serialize — the IR-only precedent),
  task 70 (parked Worker serialize — explicitly NOT this approach), `wysiwyg-code-highlight.ts`
  (`wrapLuteFlatten`, the WYSIWYG live-colour path), memory `lute-runs-in-node` (the fuzz recipe).
