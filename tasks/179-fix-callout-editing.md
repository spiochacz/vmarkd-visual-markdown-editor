# Task 179 — Fix callout editing: typing ejects the caret / text disappears (IR dual-node)

**Status:** ✅ DONE (2026-06-29). Callouts are now editable in place — typing keeps the text + caret.

## Outcome (what shipped)

Root cause confirmed (hypotheses 1 + 2): every keystroke runs `SpinVditorIRDOM`, which rebuilds the
blockquote (dropping `vditor-ir__node--expand`) and fires `observeCallouts` **synchronously** — before
Vditor's keyup re-adds `--expand`. The old IR sync ran `syncPreview` (`replaceWith`) unconditionally on
the node being typed in, and nothing re-asserted `--expand`, so CSS hid the source (`display:none`,
text "disappeared") and the caret fell out.

Fix — drive the dual-node's expand/collapse off the **live selection**, not Vditor's keyup timing
(`media-src/src/callouts.ts`):
- **(a) + (b)** `decorateCallout` IR branch: when the caret is inside this callout's editable source
  (`calloutSourceHasAnchor`, gated to the `.vditor-ir` edit surface) → re-assert `vditor-ir__node--expand`
  + flag `data-callout-editing` and **SKIP** the preview rebuild (never restructure the node being typed
  in); else → collapse + `syncPreview` from the current source.
- **Caret-leave re-sync:** `observeCallouts` adds a `selectionchange` handler — keeps the focused
  callout expanded straight off the selection, and re-syncs (collapse + rebuild preview) any
  `data-callout-editing` callout the caret has left (the MutationObserver never fires on a bare caret
  move out). Self-correcting off the DOM flag (no cross-event state).

Constraints held: round-trip byte-identical (preview stays Lute-ignored, source untouched), caret
preserved, observer stays synchronous + idempotent, callout-nav entry + WYSIWYG mode-switch colouring
unaffected (regression specs green).

## Tests (regression-proof)
- **Unit** (`callouts.test.ts`, +6): `calloutSourceHasAnchor`, the editing-skip branch (caret-safe, no
  restructure), Preview-pane gate (not editable → no expand), and the `selectionchange` leave-resync /
  focus-expand / still-editing-skip. New code regions 100% unit-covered.
- **Harness e2e** (`callout-ir.spec.ts`, +2): REAL keystrokes in real Vditor IR — text persists, caret
  stays inside, source visible, round-trips; leave re-syncs the preview. **RED-check: both FAIL on the
  pre-fix code** (preview showed stale `"Note…note A"`).
- **Real-VS-Code e2e** (`callout-edit.spec.ts`, NEW + `fixtures/callout-edit.md`): the mandate — type in
  a callout in the real custom-editor webview → text persists, caret inside, `getValue()` round-trips;
  click out → preview re-syncs. Regression `callouts-mode.spec.ts` still green.

---

**Reported:** 2026-06-29. High value — callouts were effectively **uneditable** before this fix.
**Source:** user report — "edycja callout('tooltipa') powoduje znikanie tekstu, wpisywanie powoduje wyskoczenie z calloutu" (editing a callout makes the text disappear; typing kicks the caret out of the callout).
**Value / Risk:** 🟥 high (the callout feature, task 106, is unusable for editing) / 🟠 medium (touches the IR dual-node + the per-keystroke `SpinVditorIRDOM` re-spin + caret preservation).
**Engines:** none — callouts (`> [!NOTE]` GitHub/Obsidian alerts).

## Symptom (user repro)

Put the caret inside a rendered callout and type: the callout's text **disappears** and the caret
**jumps out** of the callout. So you can't actually edit a callout's body/title in place.

## How callout editing is wired (grounded)

The IR callout is a hand-rolled **dual-node** (`callouts.ts:4-14`): the `> [!TYPE]` blockquote is tagged
`vditor-ir__node`; an injected `.vditor-ir__preview` + `contenteditable=false` render
(`syncPreview`, `callouts.ts:119-147`) is the "rendered" half, the raw blockquote the editable
"source" half. CSS keys off `vditor-ir__node--expand`: collapsed → show the injected preview, hide the
source; expanded → show the source, hide the preview. `observeCallouts` (`callouts.ts:390`, a
**synchronous** MutationObserver on the editor) re-runs `applyCallouts` → `decorateCallout`
(`callouts.ts:338`) on every DOM change.

Per the `vmarkd-lute-features` skill, **every keystroke** runs `SpinVditorIRDOM`, which rebuilds the
block's DOM → fires `observeCallouts` → `decorateCallout` → (IR branch, `:359-366`) `syncPreview`.
`syncPreview` has a source-signature guard (`:125-127`), but while you TYPE the signature changes each
keystroke → it rebuilds the preview via `existing.replaceWith(preview)` (`:145`) and re-clones the
source children (`:141`) — **on the node you're typing in, every keystroke**.

## Root-cause hypotheses (to confirm while fixing)

1. **`--expand` editing state isn't preserved across the re-spin.** Vditor's `expandMarker` owns the
   nodes IT created (real `data-type` markers); our hand-tagged blockquote may not be re-expanded after
   `SpinVditorIRDOM` + the `observeCallouts` re-decoration. If `--expand` is lost, CSS hides the source
   and shows the (now stale) preview → the typed text "disappears", and the caret ends up in/after the
   `contenteditable=false` preview → "jumps out".
2. **No "skip while the caret is inside" guard on the IR sync path.** `decorateCallout`/`syncPreview`
   run **unconditionally** on every observer fire — task 106 claimed "the wrap mutation is skipped
   while the caret is inside", but that guard does **not** cover the IR `syncPreview` rebuild. Replacing
   the preview (`replaceWith`) + re-decorating the node being typed in mid-keystroke can eject the
   caret.
3. **Caret not restored into the editable source after the re-spin** (`caret-preserve.ts` may not
   re-derive the caret into the callout's source half).

## Investigation pointers
- `media-src/src/callouts.ts`: `decorateCallout:338` (IR branch `:359-366`), `syncPreview:119-147`
  (the `:141` clone + `:145` replaceWith + `:125-127` sig guard), `observeCallouts:390`.
- `media-src/src/callout-nav.ts` (entry into collapsed callouts via `expandMarker` — entry works; the
  bug is editing AFTER entry).
- `media-src/src/caret-preserve.ts`; the `vditor-ir__node--expand` CSS in `media-src/src/main.css`;
  vditor `ir/expandMarker.ts`.
- Memory `editable-ir-styling-attribute-only` (`:focus-within` FAILS in the IR — must drive editing
  state from the live selection/`selectionchange`); `callouts-observe-app-mount`; the
  `vmarkd-lute-features` skill (the per-keystroke block-scoped `SpinVditorIRDOM` that triggers this).

## Plan (pick while implementing)
- **(a)** Guard the IR sync: skip `decorateCallout`/`syncPreview` for the callout that currently holds
  the caret (selection-driven `data-callout-editing`) — never restructure the node being typed in;
  re-sync on caret-leave/blur. (This is the task-106 intent, applied to the IR sync path it missed.)
- **(b)** Re-assert the editing state from the live selection after each re-spin (don't rely on
  Vditor's `expandMarker` owning our blockquote) so the source stays visible + the caret stays in it.
- **(c)** Ensure `caret-preserve` re-derives the caret into the callout source across the re-spin.

## Constraints
- Round-trip **byte-identical** — the preview stays `contenteditable=false` / Lute-ignored; never
  mutate the source markdown.
- Caret/scroll preserved across the per-keystroke rebuild (the whole point of the fix).
- `observeCallouts` must stay synchronous-before-paint (no raw `[!TYPE]` flash) and idempotent
  (signature guard — no observer loop).
- Don't regress callout-nav entry (`callout-nav.ts`) or live colouring (`callouts-observe-app-mount`).

## Verification (per AGENTS.md — real-VS-Code e2e MANDATORY)
- **Real-VS-Code e2e** (`test/vscode-e2e/`, headless `xvfb-run -a`): place the caret inside a callout,
  type N characters, then assert: (a) the typed text **persists** and stays visible in the editable
  source (not replaced by a stale preview), (b) the caret **stays inside** the callout (no eject), (c)
  `getValue()`/save round-trips with the new text. Add a "type then blur → preview re-syncs" case.
- Keep `callout-ir.spec.ts` / `callouts.spec.ts` green; unit-cover the skip-while-editing guard where
  feasible.
- `lint:ci` (7 parity) + `typecheck` + vitest + Playwright green. Verify coverage.

## See also
- Task 106 (callouts / GitHub Alerts — the dual-node feature this fixes the editing of).
- The same per-keystroke-rebuild + observer-re-decoration class is mapped in tasks 173/174 (scope/
  de-amplify the sync observers) — a callout-editing fix should be compatible with that work.
