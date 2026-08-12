# 518 — IME composition corrupts the typed text (CJK input is broken)

**Status:** 📋 OPEN — bug, found by QA probe · **Impact:** 🔴 high for anyone using an IME —
every composed word is silently mangled · **Found:** 2026-08-13 implementing
[task 516](516-qa-journey-coverage-plan.md) journey C5 (= the highest-value dark item in
[task 455](parked/455-dark-journey-probe-backlog.md)).

## Symptom

Compose a word with an IME and commit it (the ordinary CJK henkan flow): the pre-edit string is
**not replaced** by the committed text. Instead its leading characters survive and get glued in
front of the commit. Deterministic, byte-exact, reproduced across dozens of runs:

| Surface | Typed | Expected | **Actual** |
|---|---|---|---|
| IR prose | `Hello ` + compose `にほんご` → commit `日本語` | `Hello日本語` | **`Helloにほ日本語`** (2/4 pre-edit chars kept) |
| WYSIWYG code block | `const a = 1` + same | `const a = 1日本語` | **`const a = 1に日本語`** (1/4 kept) |
| Control: bare `contenteditable`, identical CDP sequence | — | `Hello日本語` | `Hello日本語` ✅ clean |

The control matters: the identical `Input.imeSetComposition` + `Input.insertText` sequence against
a plain contenteditable commits perfectly, so this is **not** a test-harness/CDP fidelity artifact.
It is our editable surface.

Note the corruption is *truncation*, not the duplication usually warned about — see layer 4 for why
that distinction is load-bearing.

## Root cause trace

1. **Symptom**: `getValue()` after compose+commit = truncated pre-edit + full committed text.
2. **Isolation**: bare contenteditable control is clean → specific to Vditor/vmarkd.
3. **Mechanism (vendored Vditor)**: the IR and WYSIWYG `compositionend` listeners synchronously call
   `input(vditor, getSelection().getRangeAt(0).cloneRange())`, re-serializing the block through
   `SpinVditorIRDOM`/Lute by reading DOM+selection *at the instant the listener runs*. The
   deterministic partial retention points at that read racing the browser's own DOM mutation that
   applies the commit. **Not confirmed by patching Vditor** — a probe doesn't fork the engine; this
   is the first thing to verify when fixing.
4. **vmarkd amplification (WYSIWYG only)**: `observeWysiwygCodeHighlight`
   (`media-src/src/editing/wysiwyg-code-highlight.ts`) gates its rAF-scheduled re-highlight behind a
   `composing` flag from the same compositionstart/end pair. Verified live: **disable that gate and
   the corruption flips from truncation to full duplication** (`にほんご日本語`). So the gate is
   load-bearing — it is what keeps this from being outright duplication — but it is not sufficient
   for a clean commit.

## Fix direction (not implemented)

- Confirm layer 3 by instrumenting/patching the vendored `compositionend` path: the re-serialize
  almost certainly needs to be deferred past the commit mutation (a microtask/rAF hop, or driven
  from `input` with `inputType === 'insertCompositionText'`/`insertFromComposition` instead of from
  `compositionend` directly).
- Any fix must hold for BOTH surfaces and must not regress the highlight gate — the WYSIWYG
  duplication above is what happens when the gate stops applying.
- Same-shape risk to check while in there: any other place we re-serialize from a synchronous
  DOM read triggered by an input-adjacent event.

## Regression coverage already in place

`media-src/e2e/ime-composition.spec.ts` (+ `ime-helpers.ts`) pins **today's broken output** with the
exact corrupted strings, plus the clean control. Fixing this bug MUST flip those two probes —
by design: update them to the correct expectation in the same commit as the fix, never delete them.

Caveat recorded in the spec: CDP composition is not a real OS IME (no native IPC, no candidate
window timing), so **real-IME manual verification stays on task 516's manual QA checklist** even
after this is fixed.

## Verification

- Both surfaces commit the composed text cleanly (`Hello日本語`, `const a = 1日本語`).
- Probes rewritten to the fixed contract and green; the bare-contenteditable control unchanged.
- WYSIWYG: no duplication with the highlight gate active, and markdown structure still clean
  (one fence pair, no leaked spans in `getValue()`).
- Manual: a real OS IME (Japanese/Chinese) in the installed extension.
