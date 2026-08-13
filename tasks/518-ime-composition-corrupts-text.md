# 518 — IME composition corrupts the typed text (CJK input is broken)

**Status:** ✅ NOT A BUG — closed as a test artifact, 2026-08-13. Found by QA probe implementing
[task 516](516-qa-journey-coverage-plan.md) journey C5 (= the highest-value dark item in
[task 455](parked/455-dark-journey-probe-backlog.md)); root-caused during the same-day fix attempt
and reclassified. No product code changed.

## Original symptom (as filed)

Compose a word with an IME and commit it (the ordinary CJK henkan flow): the pre-edit string
appeared **not to be replaced** by the committed text — its leading characters survived and got
glued in front of the commit. Deterministic, byte-exact, reproduced across dozens of runs:

| Surface | Typed | Expected | **Actual (as originally filed)** |
|---|---|---|---|
| IR prose | `Hello ` + compose `にほんご` → commit `日本語` | `Hello日本語` | **`Helloにほ日本語`** (2/4 pre-edit chars kept) |
| WYSIWYG code block | `const a = 1` + same | `const a = 1日本語` | **`const a = 1に日本語`** (1/4 kept) |
| Control: bare `contenteditable`, identical CDP sequence | — | `Hello日本語` | `Hello日本語` ✅ clean |

The control was read at the time as ruling out a CDP-fidelity artifact and pointing at "our
editable surface". That reading was wrong — see below.

## What actually causes it — a harness artifact, not a product bug

Root-causing this for the fix found that the corruption is **already present in the browser's own
native DOM mutation** for the `input` event carrying the composition commit — before Vditor's
`compositionend` handler (what the original trace blamed) ever runs. A patch deferring that
handler by one animation frame (the originally-planned fix direction below) changed nothing:
the broken string was byte-identical before and after.

Bisecting what actually flips the result found **one variable: how the caret was placed before
composing started**, not anything about Vditor's compositionend/input pipeline:

- The probe's own caret-placement code — `caretToEnd()` in
  `media-src/e2e/mouseops-helpers.ts` (IR), and the equivalent inline
  `selectNodeContents(code).collapse(false)` in the WYSIWYG probe's old `focusCodeBlockEnd()` —
  does `range.selectNodeContents(modeEl); range.collapse(false)` where `modeEl` is the **whole
  editable root**. That's a coarse, container-level collapsed range that lands *between* top-level
  block children, not adjacent to actual text.
- Re-doing the identical operation scoped to the actual paragraph/code element, or placing the
  caret via genuine `page.keyboard` input (the native browser caret a real user's typing/click
  produces), commits cleanly — both surfaces, every run.
- A bare `<pre><p>Hello</p></pre>` with **no Vditor loaded**, given the same coarse placement,
  stays clean — so Vditor's own live listeners are a necessary co-factor for turning the coarse
  anchor into visible corruption (the exact listener wasn't pinned down further; not needed for
  the conclusion below). But nothing in vmarkd's real caret code (`caret.ts`, ADR-0007) or
  Vditor's own internal caret restoration (`setRangeByWbr`) ever produces that coarse
  container-level shape — those are always text-node/character-offset precise, by design (task
  439). Real typing, real clicks, and every programmatic caret write vmarkd ships are precise.
- The original control (`bare contenteditable`) used a **flat, single-text-child `<div>`**, where
  a coarse `selectNodeContents(container)` happens to be geometrically *identical* to a precise
  position (the container's only child already is the text). So the control validated CDP
  fidelity but never controlled for caret coarseness — it couldn't have caught this, and its clean
  result created the false impression that the corruption was Vditor-specific.

**Conclusion:** no real user — real IME, real keyboard, real mouse click, or any of vmarkd's own
caret-placement code — can reach the state that triggers this. It is not reachable via any actual
product code path, so it is not a product bug.

## Fix direction (superseded — kept for history)

~~Confirm layer 3 by instrumenting/patching the vendored `compositionend` path: the re-serialize
almost certainly needs to be deferred past the commit mutation (a microtask/rAF hop, or driven
from `input` with `inputType === 'insertCompositionText'`/`insertFromComposition` instead of from
`compositionend` directly).~~ Tried and disproven — see above. No Vditor source patch was kept.

## Regression coverage

`media-src/e2e/ime-composition.spec.ts` (+ `ime-helpers.ts`) is the guard against this ever
regressing back into a real bug:

- The control (`bare contenteditable`) is unchanged.
- `PROBE-C5-IR` / `PROBE-C5-WYSIWYG` now place the caret via genuine `page.keyboard` input (real
  typing / `End`) instead of the coarse placement, and assert the **clean** commit
  (`Hello日本語`, `const a = 1日本語`).
- `PROBE-C5-HARNESS-ARTIFACT` keeps the old coarse-placement repro alive on purpose, pinned to the
  truncated string, so the gotcha (and why it isn't a product bug) stays documented instead of
  silently vanishing. If this one ever starts failing clean instead, that's a real signal
  something changed — re-investigate rather than assume it's fine.
- `caretToEnd()` in `mouseops-helpers.ts` now carries a warning comment pointing here: it produces
  a container-level collapsed range that is not equivalent to a real caret for
  composition/IME-adjacent testing.

Caveat recorded in the spec: CDP composition is not a real OS IME (no native IPC, no candidate
window timing), so **real-IME manual verification stays on task 516's manual QA checklist**
regardless of this closure — it was never contingent on this bug being real.

## Verification

- Both surfaces commit composed text cleanly with a genuinely-placed caret (`Hello日本語`,
  `const a = 1日本語`) — confirmed, `media-src/e2e/ime-composition.spec.ts` green.
- WYSIWYG: no duplication, markdown structure clean (one fence pair, no leaked spans in
  `getValue()`) — confirmed, same spec.
- Regression set (`wysiwyg-highlight`, `keybugs`, `gap`, `list` e2e + `npm test`) green — no
  product code changed, so this was a sanity check rather than an expected-to-fail run.
- Manual real-OS-IME check: still open on task 516's checklist, unrelated to this closure.
