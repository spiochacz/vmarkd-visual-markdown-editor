# Task 179 — Fix callout editing: typing ejects the caret / text disappears (IR dual-node)

**Status:** TODO (bug, reported 2026-06-29). High value — callouts are effectively **uneditable** today.
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
