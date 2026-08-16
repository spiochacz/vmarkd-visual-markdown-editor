# 516 — QA journey coverage plan: untested user journeys

**Status:** ✅ implemented 2026-08-13 on branch `test/516-qa-journeys` — all 31 journeys addressed

**Source:** QA audit (2026-08-13) triggered by the Ctrl+F focus-theft bug (task 514): a whole
user journey (find) had zero behavioural coverage until it broke. This task maps the *other*
journeys in the same position and plans the tests. Audit method: full feature-surface inventory
(package.json contributes, README, CHANGELOG, all `media-src/src` + `src` modules) diffed against
all 199 real-VS-Code specs, 61 chromium-harness specs, and 204 unit files. Gap claims below were
spot-checked by grep over `test/vscode-e2e` before being asserted.

**Goal:** journey-level tests for the highest-risk uncovered flows, so "the features work" is
backed by tests rather than by nobody-hit-it-yet. This task is the plan; implementation is
per-phase, each phase independently shippable.

## Progress (branch `test/516-qa-journeys`)

Every landed spec carries a red-green-red proof: it was watched FAILING with the mechanism it
guards deliberately broken, then passing again after revert. Where a break could not produce a
red, that is recorded in the spec rather than claimed as coverage.

- [x] **A1** task-checkbox toggle → save — `checkbox-toggle.spec.ts`. Journey WORKS; the old
      suspicion from 190 §5 was a harness artefact, not a product bug.
- [x] **A2** autosave × writeback — `autosave-writeback.spec.ts`. No echo storm, no corruption.
      The no-re-dirty assertion has no red proof; what guards it is content equality, not echo
      suppression (recorded in the spec).
- [x] **A3** same document in two panes — `two-pane-editing.spec.ts`. Tab dedup + alternating
      vMarkd/text-editor edits converge. NOTE: the dedup test only exercises our logic with a
      SECOND column active — the same-column shape passes with the mechanism fully broken.
- [x] **C5** IME composition — `ime-composition.spec.ts` + `ime-helpers.ts`. Looked like a bug;
      root-causing it proved the opposite → [task 518](518-ime-composition-corrupts-text.md) is
      closed as a TEST ARTIFACT (the probe's own caret placement, which no real input produces).
      Closes the 455 IME item.
- [x] **C7** non-image drag-drop — probe in `dragdrop.spec.ts`. **Found a real bug: the upload
      pipeline crashes silently** → [task 517](517-drop-file-with-text-crashes-upload.md).
- [x] **D11** config interaction pairs — `config-pairs.spec.ts` (harness). Closes the 455 item.
- [x] **A7** untitled → Save As — `untitled-save-as.spec.ts`. Works end-to-end. Two
      gotchas for the 455 item: the URI path must end in `.md` to match the customEditors
      selector, and `files.simpleDialog.enable` is what makes Save As automatable at all.
- [x] **A4** external change while dirty (+ revert) — `external-change-while-dirty.spec.ts` +
      its probe. Contract is SAFE: no auto-reload of a dirty doc, and the save is REJECTED by
      VS Code's conflict detection rather than overwriting either side. The disk/dirty half is
      VS Code core, so it has no red proof; the revert half is ours and does.
- [x] **A8** dirty-close — `dirty-close.spec.ts`, **half of it only**. The Don't-Save branch is
      covered (and is the harness's unconditional default). The **Save branch is structurally
      unreachable** and moved to the manual checklist: `vscode-test-playwright` always launches
      with `--extensionTestsPath`, and VS Code's `showSaveConfirm` returns "Don't Save" without
      rendering any dialog when `isExtensionDevelopment && extensionTestsLocationURI` — proven
      from the compiled workbench source, not inferred from a timeout. No spec in this repo can
      ever reach it under this runner.
- [x] **C1** table structure editing — `table-structure.spec.ts` (harness). Every panel op
      asserts the full serialized markdown. Undo works; an early "undo is broken" reading was a
      measurement inside the 800 ms debounce window.
- [x] **B1/B2** find beyond IR — `find-widget-modes.spec.ts`, `find-widget-navigation.spec.ts`.
      B2 is narrower than planned, for a measured reason: the widget exposes no match count and
      the scroll proxy does not identify a unique current match, so cycling ORDER and wrap-around
      are not assertable from the DOM. Recorded in the spec rather than faked.
- [x] **D2** Explorer outline tree — `outline-explorer.spec.ts`, both branches.
- [x] **D5/D6** remote-image gate, `defaultModeByGlob` — `settings-live-d-tier.spec.ts`.
      **D5 corrects this plan's own framing**: a plain remote image does NOT unblock live. CSP is
      written once at panel creation and cannot be relaxed after parsing, so it needs a REOPEN;
      only the geojson tiles case is a live JS gate.
- [x] **D4** `css.external` live reload — **found a real bug**, pinned broken →
      [task 520](520-external-css-never-live-reloads.md). Absolute paths are passed to
      `createFileSystemWatcher` as string globs, which VS Code matches workspace-relative, so the
      watcher can never fire. An in-host `workspace.fs.writeFile` also fails to reload, which
      rules out inotify.

- [x] **A6** file deleted on disk — `delete-on-disk.spec.ts`. Safe: the editor survives, the doc
      does not force-dirty, and saving RECREATES the file with the full content. No red lever
      exists (we have no delete handling at all), stated in the spec.
- [x] **A5** wiki chip on target rename — `wiki-rename-stale-chip.spec.ts`, **found a bug**,
      pinned broken → [task 521](521-wiki-chip-stale-after-rename.md). The chip stays stale and
      its offered repair forks a duplicate page at the old path.
- [x] **D9** large-doc editing — `large-doc-editing.spec.ts`. Type/undo/save on a 744k-char
      streamed document.
- [x] **D8** webview reload mid-edit — probe. Content, dirty state, and a post-reload save all
      survive.

- [x] **B3/B4** find in special regions, find × lifecycle · **C2/C3/C6** footnotes, math, HTML
      comments · **C4** emoji insertion · **D1** status bar · **D3** wiki create-missing-page ·
      **D10** keybinding scope release — all landed and verified.
- [~] **D7** real wheel zoom gate — landed as a MEASUREMENT PROBE, not a net. The pane-scrolls
      half is unfalsifiable (nothing in the webview document overflows, so a zero delta proves
      nothing), and a REAL Ctrl+wheel did not move the markmap transform at all, while the
      existing synthetic-event gate specs do see it move. Either the Ctrl-to-interact gate needs
      a real hover/focus a bare `mouse.wheel` does not produce, or Playwright's wheel does not
      carry `ctrlKey` into the webview OOPIF. Recorded rather than asserted either way.
      **Also still missing: the static-SVG half.** D7 splits across two engine families —
      `zoom: 'gated'` (markmap/mindmap/Leaflet, `diagram-zoom-gate.ts`), which the probe covers,
      and `zoom: 'static'` (mermaid/d2/graphviz…, `diagram-zoom.ts`), which does NOT. A spec for
      the static family existed briefly (`diagram-wheel-real.spec.ts`) and I deleted it believing
      it was a duplicate of the gated one — it was the complement, not a copy. Next step for
      whoever picks this up: before assuming a product gap, verify that Playwright's `mouse.wheel`
      reaches content inside the doubly-nested webview iframe AT ALL, with a non-diagram baseline
      scroll test. That control decides whether D7's failures are product or harness.

**All 31 journeys are now addressed** — 30 as nets or pinned contracts, D7 as a documented probe.

## Full-suite progression across nine runs (2026-08-13 → 16)

| Run | passed | failed | flaky | what changed before it |
|---|---|---|---|---|
| 1 | 262 | 4 | 6 | — (baseline, 54.4 min) |
| 2 | 265 | 2 | 5 | the three pre-existing failures + the settle-focus fix |
| 3 | 268 | **0** | 4 | emoji-insert, outline-explorer, keybinding budget |
| 4 | 270 | **0** | 2 | the save race, the theme-code leak, the overlay dblclick |
| 5 | 270 | **0** | 2 | the caret-verification helper (4e33768); 59.1 min, 2 skipped |
| 6 | 268 | 1 | 3 | the `stickySelection` sweep; 1.1 h — the 1 failed + 1 flaky were the sweep's own and are now exempted, the other 2 flaky are untouched specs |
| 7 | 271 | **0** | 1 | the `stickySelection` sweep committed (`53e37fc` render-cache fix, `5d13366` the caret-helper sweep, `a42a8c4` docs); 1.0 h, 2 skipped — the single flaky was `block-fidelity.spec.ts:293` (IR), green in all eight earlier full runs |
| 8 | 272 | **0** | **0** | the block-fidelity caret fix (`4237c8c`), the diff-markers typecheck fix (`c98a1da`), the `stickySelection` log split (`344c2f3`); 1.2 h, 2 skipped |
| 9 | 272 | **0** | **0** | the e2e typecheck sweep (`1587de3`) — 62 spec files re-annotated, no runtime change; 53.5 min, 2 skipped |

Run 8 is the first fully clean full run — zero failures AND zero flakes. The previous best was run
5's 270 passed with 2 flaky; every run between them carried at least one flake. Run 9 confirms run
8 rather than being a fluke — also zero failures, zero flakes — and is the fastest full run
recorded here: 53.5 min, against run 8's 1.2 h and run 5's 59.1 min. Run 9 was a type-only change
(no runtime code touched), so that gap is machine load, not the suite getting cheaper to run.

### Run 5's two flakes — a synthetic `Range` is not caret authority (2026-08-15)

`footnote-editing` and `noop-check-on-save` (deferred-timer test) both went flaky→passed-on-retry.
Same root cause, one fix:

- Both placed the caret by clicking `.vditor-ir` at `{x:4,y:4}` and then writing a `Range` from
  `evaluate()`. A probe showed the write SUCCEEDS (a read inside the same `evaluate` sees the target
  node at the right offset) but in 2 of 4 runs the caret is back at the clicked position (`"# "@0`)
  by the next `evaluate` — Vditor restores its own caret asynchronously after a click. A SECOND
  write is clobbered the same way, so retrying the range write does not converge.
- Keystrokes then landed in the heading: `# xyz123Title` in noop's failure diff, and footnote's
  ` EXTRACONTEXT` prepended to the `# ` line or lost entirely.
- Both failures reported a PRODUCT symptom for a setup miss — "the saved bytes lack EXTRACONTEXT"
  (save fidelity) and "undo never cleared the marker after 40 presses" (undo stack). noop's undo
  loop never even ran: its residue check is anchored to "newline", and the marker was in the heading.
- Fix: `placeCaretAtEndOf` in `webview-helpers.ts` — click the target element, press `End`, verify
  the selection is collapsed at the end of a text node containing the anchor, retry, else throw as
  itself. Goes through the editor's own caret machinery instead of fighting it.

Measured both sides: `footnote-editing` 5 failed / 10 solo before → 10/10 after;
`noop-check-on-save` deferred-timer 10/10 solo (needs load to reproduce) → 4 failed / 10 under
8×`yes` before → 10/10 under the same load after; both specs together 18/18 under load.

### The sweep — 63 more call sites moved onto a verified write (2026-08-15)

The same latent race sat in ~64 other specs that place a caret with `addRange` after a click. They
were green on run 5 by the luck of the race, so they were swept too, via a second helper:

- `stickySelection(frame, applyFn, arg)` runs the spec's OWN in-page write, then snapshots the
  selection as a structural PATH and re-applies if it drifted. A path, not text+offset: expanding an
  IR node inserts marker text and shifts every offset after it, and a spin rebuilds the block, so an
  exact comparison reports "moved" for a caret that never left. It returns the callback's value, so
  the 19 sites that use the result are unaffected.
- The snapshot is taken AFTER the write in a second round trip, so a clobber landing in between
  would be read back as success — measured, 2 of 8 probe runs returned with the caret at the click
  position that way. Comparing against a `before` snapshot and retrying when the selection did not
  MOVE closes that. With it: 8 of 8 land on target, against 3 of 6 clobbered for the raw write.
- Applied by codemod to 89 sites, then **28 were reverted** — the exemption class is **a caret whose
  very NEXT act is a keystroke on the same dual-node region**. The helper's ~200ms verification wait
  is enough for that region to re-render around the caret, and the key then acts on a different node.
  Two shapes hit it: an EXPANDED IR SOURCE (`.vditor-ir__marker--pre` / `--expand`, 23 sites) and a
  LIST ITEM about to take Backspace/Enter (`list-backspace`, `list-autoformat-space`). Causally
  proven on `diagram-edit-monitor` (2/2 green on the baseline, both tests red through the helper).
  Every reverted site carries a comment saying why.
- Verification, in two rounds. The 78 rewritten specs as one batch: **98 passed, 4 failed** — all
  four the IR-source shape; 6/6 after the revert. Then the FULL suite: **268 passed, 1 failed, 3
  flaky, 1.1 h**, against a 270/0/2 baseline. Attribution: `list-backspace` (hard, failed its retry
  too) and `list-autoformat-space` were the sweep's, and are now exempted (6/6 on a 3× repeat);
  `mode-switch-render-reuse` is untouched by this work and `diagram-edit-monitor` carries only a
  comment change, so both are pre-existing flakes. The run's own good news: the two flakes this task
  started from, `footnote-editing` and `noop-check-on-save`, both passed clean.
- Final state: 61 sites across 51 specs on `stickySelection`, 2 on `placeCaretAtEndOf`.

### Run 6's two remaining flakes — one fixed, one still unexplained (2026-08-15)

**`diagram-edit-monitor` (graphviz) — FIXED.** Measured 3 of 8 under 8×`yes` load. The probe that
settled it logged the graphviz SOURCE and the whole document after typing the deliberate garbage:
on every failure the document HELD `@@@bad` while the block's own source stayed pristine — the
keystrokes were editing another block, so no error render could ever appear and the spec spent its
30s wait on one that was never coming. The caret cannot be checked BEFORE typing here (reading the
selection back is a second round trip, and by then the expanded node has re-collapsed — that check
failed 7 of 8 runs that would have typed fine). So `typeIntoSource` checks the OUTCOME instead:
type, confirm the source changed, and on a miss undo with Ctrl+Z until the document is clean and
retry. **16/16 under the same load** after, against 3/8 before.

**`mode-switch-render-reuse` — NOT fixed, and honestly so.** 20/20 solo, 16/16 under 8×`yes`, and a
replay of its real 11-spec predecessor chain came back clean, so it is neither order-dependent nor
plainly load-sensitive; n=1 from the suite. What the investigation DID find is that its failure
message lied: the diff position and excerpt were computed on the RAW markup while the pass/fail
decision uses the `stripIdNs`-normalised strings, so the message pointed at a `-vmN` paint-namespace
suffix that had already been normalised away — a difference that cannot be the cause — and hid the
real one. That is fixed; the next occurrence will name the actual difference. The underlying cause
remains unidentified.

**Not swept:** 5 sites in the `wiki-*` specs write the range through the chip element's own locator
and use the element parameter, so they do not fit either helper's shape.

The two still-flaky after run 4 — `flip-skip` and `prerender-style-parity` — both pass 12/12 in
isolation; the parity one was then pinned against inherited themes (see [524](524-e2e-specs-leak-global-settings.md)).
`two-pane-editing` failed run 3 on `Timed out waiting for VSCodeTestServer address`, i.e. VS Code
did not boot — harness under load, not a test defect.

### Run 7's flake — a click at the corner beats a Range at the target (2026-08-16)

`block-fidelity.spec.ts:293` ("IR preserves fragile blocks and stays stable across a second edit")
failed with `Error: the keystroke reached the saved TextDocument (expected "...TYPE-HERE anchor
paragraph.Z")`, a 20 s poll timeout — the typed `Z` never reached the document.

The spec was green in all eight earlier full runs (2026-08-13 to 15, logs
`tmp/full-suite-516*.log`); it first flaked in the run immediately after the sweep converted its
`typeElsewhere` helper to `stickySelection`, so it is attributable to the sweep rather than a
pre-existing flake.

Root cause: `typeElsewhere` clicked the editor container at `{x: 4, y: 4}`, planting the editor's
own declarative caret intent in whatever block sits at that corner, then wrote a `Range` into a
DIFFERENT block (the paragraph containing `TYPE-HERE`). Vditor re-resolves that intent every
animation frame and reverted the caret to the corner block, so the keystroke landed there.
`stickySelection` structurally cannot catch this: it verifies BEFORE the keystroke, and the revert
happens after it returns.

Fix: `placeCaretAtEndOf(frame, workbox, `${mode} p`, 'TYPE-HERE')` — it clicks the TARGET
paragraph, so the editor's intent and the test's target are the same block, then presses `End` and
re-verifies. `typeElsewhereSv` keeps `stickySelection`: split mode's source view is a flat span
soup with no `<p>` to target.

Measured on the real predecessor chain, from the run log — `abc-edit-collapse`, `abc-edit-jump`,
`abc-flip-cache-hit`, `anchor-links`, `auto-theme-pairing`, `autosave-writeback`, then
`block-fidelity` — run in ONE command with `--retries=0`: **1 failure in 5 runs** before, **0 in
10** after. Solo runs do not reproduce it at all. This is the sixth time in this task that the
chain replay reproduced something a solo run would not have, reinforcing the method already
documented in the testing skill.

Commit: `4237c8c`.

### Two other defects found on the way (2026-08-16)

**A typecheck regression the branch was carrying.** `npm run typecheck` was RED on
`test/516-qa-journeys` and clean on `main`:
`media-src/src/chrome/diff-markers.ts(142,55): error TS2339: Property 'textContent' does not exist
on type 'never'`. Introduced by branch commit `9392c10` (the git-gutter list-block fix).
`renderDiffMarkers` reads a block's text via `innerText` — which renders block-level children on
separate lines the way `blockLineRange` needs — and falls back to `textContent` where `innerText`
does not exist (jsdom). The guard was written `'innerText' in child`, but the DOM lib types
declare `innerText` as always present on `HTMLElement`, so tsc narrowed the else branch to `never`
and rejected the fallback. Fixed by reading `innerText` through an alias that types it optional,
preserving the runtime check and identical semantics in all three cases (present, empty, absent).
Commit `c98a1da`. Process point: `npm run quality` does not include `typecheck`, which is why this
sat unnoticed on the branch.

**`stickySelection`'s retry log described two outcomes as one.** The line `[stickySelection] held
after N attempts` was reached by two different situations: a write that MOVED the selection and
then stuck (the editor was clobbering it and stopped — the message is accurate), and a write that
never moved the selection on any attempt, where the accepted selection is whatever was already
there. The second is legitimate when the caller re-asserts a caret already at its target, but is
indistinguishable from a write that silently found nothing — and it fired six times in run 7, all
in passing specs, so it must NOT become an error. Now logged as its own line, unconditionally,
naming what to check. Control flow unchanged: the last attempt still falls through to the settle
and the stability re-check, so nothing returns unverified. Commit `344c2f3`.

Not done: the alternative fix — running `apply` and the snapshot in ONE `evaluate` so `want` is by
construction what `apply` produced — was attempted and abandoned as impossible. `locator.evaluate`
does not invoke a string as a function even though its TypeScript type permits a string; it
evaluates the string as an expression and serialises the resulting function object back as
`undefined`. Measured on plain chromium: all four syntactic forms (sync arrow, async arrow,
parenthesised async arrow, async function expression) returned `undefined`, and the five specs
built on it failed with `TypeError: Cannot destructure property 'result' of '(intermediate value)'
as it is undefined`. The gotcha is recorded in the `vmarkd-testing` skill. Consequence: the
two-round-trip ambiguity in `stickySelection` is a KNOWN, ACCEPTED limitation, not something still
to be fixed.

**Open follow-up — "selection stayed in the same node" hits in passing specs.** The original
wording of this log line ("selection never moved") claimed more than `SELECTION_SNAPSHOT` can see.
That snapshot compares only the structural PATH of the anchor/focus nodes, deliberately ignoring
offset (see its comment in `webview-helpers.ts`), so what the line actually reports is narrower:
the write left the selection in the same NODE it was in before, which the check cannot distinguish
from a no-op. A large share of the hits are benign BY CONSTRUCTION rather than by luck: any call
site whose `apply` places the caret inside a node the selection already occupies — `list-enter-start`
placing it at offset 0 of a list item it is already inside is the concrete example — will always
report this, and the write did land, just within the node rather than across a node boundary.
Observed in a targeted run of `cross-diagram-edit`, `cross-diagram-edit-ir`, `list-enter-start`,
`prose-fast-edit`, `sv-split` (5 occurrences across those specs; exact per-spec attribution still
to be done, because console output in a full-suite log interleaves and cannot be attributed
reliably). The residual question is narrower than the first framing of this entry suggested, and
is still open: distinguishing the benign within-node case from a write that was genuinely reverted
needs a probe that records the anchor OFFSET alongside the path at these call sites, which has not
been run.

### The other typecheck gate — also red, and not wired into `quality` either (2026-08-16)

`npm run typecheck:vscode-e2e` was red, and had been for a long time. It is a SECOND typecheck
script (`tsc -p test/vscode-e2e/tsconfig.json`), separate from `npm run typecheck` (`tsc -p
media-src/tsconfig.typecheck.json`, the one the diff-markers fix above addressed). Neither is part
of `npm run quality`.

Measured: **12 errors on this branch, 9 on `main`** — so it was already red before this task
started, and this branch added 4 (while incidentally removing 1 from `d2-render-sweep`).

Per-file, branch vs main:

| file | main | branch |
|---|---|---|
| `d2-render-sweep.spec.ts` | 6 | 5 |
| `preview-widgets.spec.ts` | 2 | 2 |
| `prerender-style-parity.spec.ts` | 1 | 1 |
| `footnote-editing.spec.ts` | — | 1 |
| `html-comment-edit.spec.ts` | — | 1 |
| `keybinding-scope-release.spec.ts` | — | 1 |
| `math-editing.spec.ts` | — | 1 |

The 4 new ones landed in specs touched by the caret work (the `stickySelection` sweep and
`4e33768`).

**Cause of 11 of the 12.** `evaluateInVSCode` genuinely has two overloads, with and without an
argument. A spec that passes the fixture into its own local helper must re-annotate it, because the
overloaded type does not survive being destructured into a plain parameter. Those hand-written
annotations pinned the second parameter as required and typed it `[string]`. A call site that
genuinely needed no argument was then forced to write `[] as [string]` — a cast that lies (TS2352)
— and one that correctly omitted the argument failed with TS2554.

**Fix.** Export the shape once as `EvaluateInVSCode` from `webview-helpers.ts`, argument optional
and untyped, and use it everywhere the annotation had been hand-copied — across all of
`test/vscode-e2e/`, not only the seven files that happened to error, so the next spec to drop an
argument does not resurrect it. 62 files, annotations only.

**The twelfth.** `prerender-style-parity`'s snapshot builder used `Object.fromEntries`, whose
typing always widens to a `{ [k: string]: V }` index signature — a shape that can never satisfy
`Snapshot`'s named keys, so the whole call carried an unsound `as Promise<Snapshot>`. Rebuilt with a
typed `reduce` keyed by the actual probe names, so `evaluate` infers `Snapshot` directly and the
cast is gone. Identical keys, values and runtime behaviour.

Commit `1587de3`. Verified by full suite run 9 afterwards, since the change touched 62 spec files.

**The process point, stated plainly:** two of the three defects found today (`diff-markers`'
TS2339 and these twelve) were sitting behind typecheck scripts that `npm run quality` does not run.
A green `quality` is currently not evidence that the tree typechecks. This is an open decision, not
a done thing: wiring both typecheck scripts into `scripts/quality.mjs` has not been done, and needs
a call on whether `typecheck:vscode-e2e` should gate at zero — it would have to be fixed on `main`
too, which it now effectively is via this branch, once merged.

## Full real-VS-Code suite — result and triage (2026-08-13)

`xvfb-run -a npm run test:vscode`: **262 passed, 4 failed, 6 flaky, 2 skipped, 54.4 min.**

Each failure was rerun in isolation, and every spec the branch does not own was rerun against a
clean `main` build in a throwaway worktree, so "ours" and "pre-existing" are separated by
measurement rather than by assumption:

| Spec | In the suite | Alone | On clean `main` | Verdict |
|---|---|---|---|---|
| `diff-gutter` | fail | fail | **fail, same symptom** | pre-existing |
| `plantuml-theme-flip` | fail | fail | **fail, same symptom** (`#3b3b3b` expected, `#202020` seen) | pre-existing |
| `prerender-style-parity` | fail | fail | **fail, same symptom** (`release` undefined) | pre-existing |
| `keybinding-scope-release` | fail | **pass** | n/a (new here) | ours — fixed below |

The three pre-existing ones are NOT regressions from this task and are deliberately left alone
here; they need their own task rather than a drive-by fix inside a QA-coverage branch.

The six flaky ones (`d2-render-sweep`, `emoji-insert`, `find-widget-focus`, `find-widget-modes`,
`heading-space-drop`, `large-doc-editing`) all passed on retry.

### The three pre-existing failures — all fixed here after all (2026-08-13)

Left alone at first, then fixed on request. Each had a different cause and none was a regression:

- **`plantuml-theme-flip`** — stale expectation. PlantUML bakes the CONTENT foreground
  (`getComputedStyle(body).color`: `#202020` light, `#bbbebf` dark); the spec hardcoded
  `--vscode-editor-foreground` (`#3b3b3b`/`#cccccc`). Now derived from the live theme, plus a second
  assert that the flip actually CHANGED the colour — matching the current theme alone would also
  pass for a renderer that never re-themed.
- **`diff-gutter`** — two layers. The spec asserted a feature it never enabled: the test instance
  opens a `/tmp/pwtest-*` workspace where the git extension reports ZERO repositories, so
  `getHeadContent` returned null and no bar could ever render. It now builds its own temp git repo.
  With that fixed the host posted a correct `diff-info` and the webview still drew nothing — a REAL
  product bug: `blockLineRange` looked up a block's whole `textContent` in the markdown, and a
  `<ul>` concatenates its items with no `- ` markers and no newlines, so no list ever got a bar.
  Fixed by mapping on the first/last rendered LINE and feeding `innerText`. Tables remain broken by
  the same mechanism — [task 523](523-diff-gutter-misses-tables.md).
- **`prerender-style-parity`** — the instant-paint overlay is removed as soon as the live editor is
  themed, and the hold that keeps it for the comparison is gated on `VMARKD_PRERENDER_PARITY_HOLD`,
  which nothing set. Set per-file via `beforeAll`/`afterAll`, deliberately NOT in
  `playwright.config.ts`: the harness copies `process.env` into VS Code at launch and each test boots
  its own instance, so a config-level export would hold an overlay that covers the editor across
  every spec in the suite. Verified the assertion is not merely green — perturbing an
  overlay-scoped `h1` font-size fails it (`41px` vs `24.5px`), and it passes again with `main.css`
  restored byte-identical.

### `find-widget-modes` is not flaky — it reproduces task 514's bug

Investigated on request. It fails ~1 run in 2 with `focus left the find box … host:"IFRAME.webview"`
— the ORIGINAL reported symptom. Root-caused with wrapped `HTMLElement.prototype.focus` /
`Selection.prototype.addRange` and captured stacks: `caret.ts`'s rAF loop re-asserts the caret on
every frame with no `document.hasFocus()` gate, and Electron's find handshake hands the frame brief
real focus, during which `addRange()` into the contenteditable takes the keystrokes. Full evidence
and the fix options: [task 522](522-caret-raf-loop-steals-find-focus.md). Note the measurement
explicitly refutes the tempting "IR is safe" reading — IR shows the same arming and the same focus
flip at the same call volumes.

### `settle()` steals focus into the webview — the real cause of D10's failure

`settle(frame, ms)` (`test/vscode-e2e/webview-helpers.ts`) waits by running `evaluate` INSIDE the
webview iframe, and touching the iframe pulls DOM keyboard focus into the panel.
`keybinding-scope-release` settled between its key presses, so Ctrl+L/Ctrl+H were delivered to the
FOCUSED webview and fired `format.list`/`format.strike` exactly as designed — the `* ~~~~` in the
failure output was the product working correctly, reported as a `when`-clause leak. The test was
asserting the opposite of what had happened.

Measured with a throwaway focus probe (deleted): opening the plain text editor beside the panel
gives it focus within 200 ms and keeps it indefinitely, across `evaluateInVSCode` round-trips too;
every observed focus loss traced back to a webview-side evaluate. An earlier guess of mine — that
`.monaco-editor:visible.last()` clicked the wrong editor — was wrong, and so was a second guess
that the host query dropped the `.focused` class; both are recorded here because the wrong
explanation is what makes this class of failure expensive.

Fix, in the spec only (no product change): page-level `workbox.waitForTimeout` instead of `settle`
after focus matters, focus forced through `showTextDocument({preserveFocus: false})` with a click
fallback and a poll (opening beside wins focus only ~1-in-2 with a live webview beside it), a
precondition assert that fails as "we never got focus" rather than degrading into a false leak, and
a per-key focus trail in the log. Re-proved RED by widening the three `when` clauses to `"true"`:
fails on the CONTENT assert with `focusTrail=Control+d:text-editor,…`, i.e. the first key demonstrably
went to the text editor. `package.json` restored byte-identical (md5 verified), green 3/3 after.

**Generalises:** any spec that needs focus OUTSIDE the webview must not use `settle`. Specs that
type INTO the editor are unaffected — there the focus pull is harmless. `find-widget-focus` and
`find-widget-modes` are flaky and assert focus in workbench chrome, so they are the first place to
look for the same trap.

## Bugs this task has found

| Task | Bug | Status |
|---|---|---|
| [517](517-drop-file-with-text-crashes-upload.md) | dropping a file alongside `text/plain` silently crashed the upload pipeline | ✅ fixed |
| [518](518-ime-composition-corrupts-text.md) | IME composition appeared to truncate the committed text | ❌ NOT a bug — a test artifact (coarse caret placement); closed |
| [519](519-heading-typing-drops-a-space.md) | typing a heading drops the space after the first word | ✅ fixed |
| [520](520-external-css-never-live-reloads.md) | `css.external` never live-reloaded — the watcher could not fire | ✅ fixed |
| [521](521-wiki-chip-stale-after-rename.md) | wiki chips go stale on rename and offer to fork a duplicate | open (design decision) |
| — | the git gutter never rendered for LIST blocks (`blockLineRange` could not map them to source lines) | ✅ fixed here |
| [522](522-caret-raf-loop-steals-find-focus.md) | the caret rAF loop steals focus from the find box — task 514's bug, second route | open (diagnosed, fix is a design call) |
| [523](523-diff-gutter-misses-tables.md) | the git gutter still misses TABLES (same mechanism as the list gap) | open |
| — | a save immediately after a revert-to-baseline left the tab DIRTY with no backstop able to clean it (an in-flight sync tick landing after the willSave correction; `applyEdit` always dirties) | ✅ fixed here |
| [524](524-e2e-specs-leak-global-settings.md) | e2e specs leak GLOBAL settings into the shared profile — the real cause behind three "timing" flakes | open (the three victims are fixed) |

**Open thread — the space drop.** Typing `# Untitled journey` character-by-character into a blank
document produced `# Untitledjourney` during A7 (real VS Code, untitled doc). Investigated at the
harness layer: **does NOT reproduce in plain IR** — 10 cells (heading vs plain text × empty vs
non-empty document, plus slower delays, the space as a separate keypress, the exact reported
phrase, and typing with zero settle after boot). Every space survived. That refutes the obvious
theory (the marker-promotion/spin pass eating it when `# ` promotes a paragraph to a heading) —
promotion into an empty document types cleanly.

So it is either specific to the real webview (boot timing / untitled init / injected CSS) or an
artefact of that spec's typing method. Remaining leg: the same typing in REAL VS Code on an
ordinary `file:` document. If it reproduces there it affects anyone typing a heading into a fresh
document and needs its own task; if it is untitled-only, it is narrow; if it does not reproduce at
all, close the thread.

Remaining journeys below are unstarted.

## Relationship to tasks 190 and 455 (read first)

[Task 190](done/190-user-journey-test-coverage-plan.md) (closed 2026-07-30) was the previous
journey-coverage sweep; its still-open exploratory probes were rehomed into
[task 455](parked/455-dark-journey-probe-backlog.md). This plan is the 2026-08 successor audit.
Three consequences:

- **Journeys below that mirror a 455 item say so** — implementing them here ticks the 455 item
  (one source of truth per item; don't run the same probe twice).
- **Two 190 §5 deferrals fell out during the 190→455 rehoming** and appear in no open task until
  now: the real-click checkbox confirmation (A1) and the external-modify-*while-dirty* conflict
  (A4). This plan readopts them.
- **Already answered/covered since** — do NOT re-plan: 455's "does Ctrl+F open at all" probe is
  answered by task 514 (it opens; the focus bug it found is fixed + pinned by
  `find-widget-focus.spec.ts`); **copy-as-HTML** is covered by `copy-clipboard.spec.ts` (455's
  strike-off list); **rename-while-open** was deliberately triaged in 190 P2 — unit-covered by
  `extension.test.ts` "rename tracking" (incl. save-to-new-path), an L3 attempt was dropped as
  fragile-by-construction (VS Code recreates the iframe on rename). Not re-proposed here.

---

## How to read the journey tables

- **Risk** = what breaks silently if the journey regresses (data loss > broken editing > annoyance).
- **Layer** = where the test belongs (real-VS-Code e2e unless the behaviour is reproducible in the
  chromium harness; unit only for pure logic). Boot cost is **per `test()`**, not per spec file
  (task 448), so the plan counts *tests*, not files — and merges related assertions into one
  `test()` sharing a boot where they share fixture+state (the `diagram-render-sweep` /
  `plantuml-render-sweep` pattern, task 511).
- **Tier**: new journey specs default to **FULL**. Only regression nets for previously-broken or
  data-integrity behaviour go to FAST (budget: FAST is ~34 specs / ~12 min today — keep additions
  minimal).
- **Probe-first** items follow 190/455 discipline: cheap throwaway probe, record the finding,
  promote to a permanent net only what protects behaviour someone depends on (that discipline is
  how the suite is kept from regrowing to 2 h — task 447/448).

---

## Phase 1 — data integrity & document lifecycle (highest risk)

The class where a regression corrupts or silently loses user content.

| # | Journey | Evidence of gap | Layer / shape |
|---|---------|-----------------|---------------|
| A1 | **Task-checkbox toggle → save.** Real mouse click on a `- [ ]` checkbox in IR and in WYSIWYG; saved markdown flips `[ ]`↔`[x]`; one undo reverts it. | Zero real-VS-Code coverage. `list-ops.spec.ts` header: a synthetic checkbox `.click()` collapses `getValue()` in the harness (caret-context artifact) and defers the real-click confirmation to a 190 §5 probe — **that probe never made it into 455's rehomed list**. The one spot we *know* synthetic ≠ real, unconfirmed either way. | real-VS-Code, L3 real click. 2 tests (IR, WYSIWYG). Probe-first (may find a product bug); the pinned net is a FAST-tier candidate (data-integrity). |
| A2 | **Autosave interplay.** `files.autoSave: afterDelay` (short delay): type prose, wait for autosave; disk matches, no dirty-flag flicker, no echo loop with the writeback no-op timer (`noop-check-on-save` covers the *manual*-save race only). | `grep -ri autoSave test/vscode-e2e` = 0 hits. | real-VS-Code. 1–2 tests. |
| A3 | **Same doc, two panes.** (a) "Open with vMarkd" when a vMarkd tab for the file already exists in another group → reveals, never duplicates (tab-targeting is unit-mocked only). (b) `openSourceToSide`: edit in the text editor AND in vMarkd alternately → both converge, no feedback loop, save is byte-sane. | No spec opens the same document in two groups. | real-VS-Code. 2 tests. |
| A4 | **External change while dirty.** Unsaved webview edit + on-disk write (simulated `git pull`) → no silent loss; also the `files.revert` sub-case. | 190 explicitly deferred "conflict + `files.revert` sub-cases" to §5 — **lost in the 455 rehoming**. `doc-sync` covers external-edit-on-clean only. | real-VS-Code. 1 probe → 1 regression test. |
| A5 | **Wiki chip rewrite on target rename.** Rename `b.md` while `a.md` (open in vMarkd) holds a `[[b]]` chip → does the doc text update or go stale? | = 455 open item ("no spec matches `renameFile`"). Implementing here ticks it there. | real-VS-Code. 1 probe. |
| A6 | **Delete on disk while open.** File removed externally → editor survives (no crash/blank), save behaviour is deliberate (re-create or clear error). | Zero hits. | real-VS-Code. 1 test (probe-first if behaviour undefined). |
| A7 | **Untitled document.** New untitled markdown → open with vMarkd (`untitled` scheme is declared in `contributes.customEditors`) → type → Save As → correct file content. | = 455 open item ("untitled → save-as"; `block-fidelity` mentions untitled only re: link-reference titles). | real-VS-Code. 1 test; ticks the 455 item. |
| A8 | **Dirty-close choice.** Close a dirty vMarkd tab → workbench dialog; both Save and Don't-Save paths do what they say. | Zero hits. VS Code's dialog is DOM-rendered, so clickable from the workbox page. | real-VS-Code. 2 tests; if the dialog proves flaky under xvfb, demote to the manual checklist rather than shipping a flaky gate. |

Phase-1 budget: ~10–12 `test()` = ~10–12 boots ≈ +4–8 min on the FULL tier; only A1 lands in FAST.

## Phase 2 — the find journey, finished

Task 514 fixed and pinned focus retention in IR. The rest of the find surface (task 514's own
audit + this one):

| # | Journey | Notes |
|---|---------|-------|
| B1 | **Find in each mode.** Same query in WYSIWYG, sv, preview (IR covered by `find-widget-focus`): widget opens, focus retained, activation scrolls the match into view. Match *counts* are known to differ per mode (native find searches rendered DOM incl. IR markers — task 196 note); assert focus/scroll/no-crash, not counts. | 3 tests, one per mode (each needs its own boot anyway). |
| B2 | **Multi-match navigation.** Doc with several matches: Enter cycles, Shift+Enter reverses, wraparound works, Escape closes AND returns focus to the editor, second Ctrl+F reopens cleanly. | 1 test, single boot. |
| B3 | **Matches in special regions.** Query hitting: fenced-code content, a diagram's source (collapsed IR dual-node), a collapsed callout (`display:none` source). *Probe first* — whether Electron's `findInFrame` reaches hidden text is unverified; measure, then pin the observed contract. | 1 probe → 1 test. |
| B4 | **Find × lifecycle.** With the widget open: mode switch, then Ctrl+S while the find input is focused → nothing leaks into the doc, save is clean. | 1 test. |
| B5 | **Armed-caret residual.** A gesture arming `caret.ts`'s ~5 s re-assert intent just before Ctrl+F can still steal focus once — documented as unfixed in task 514, now tracked as **task 515**. The regression test belongs to 515's fix, not here; listed so it isn't lost. | deferred to 515. |

Phase-2 budget: ~7 tests. All FULL tier (`find-widget-focus` already guards the FAST tier).
**Focus/keyboard specs are flaky by nature here** — verify each new one with `--repeat-each=4`
and only then trust it (measured 1/4 pass on identical runs for this class).

## Phase 3 — uncovered editing interactions

| # | Journey | Evidence / notes |
|---|---------|------------------|
| C1 | **Table structure editing.** Via the table panel: insert/delete row, insert/delete column, change alignment → saved markdown correct, undo works. 190's matrix scored this "dispatch pinned, md never asserted" and deferred the panel ops; still true — no spec anywhere performs a structural table edit and checks the file. | real-VS-Code, 1–2 tests (one boot, several ops on one fixture). |
| C2 | **Footnote editing.** Create `[^1]` ref + definition, edit both, round-trip byte-fidelity. (Harness `stream.spec.ts` covers only cross-chunk footnote *resolution* — rendering, not editing.) | real-VS-Code, 1 test. |
| C3 | **Math editing.** Caret into inline `$x$` and block `$$…$$`, edit, leave → re-render; backspace across the math boundary doesn't corrupt. Today only render+cost is covered. | real-VS-Code, 1 test. |
| C4 | **Emoji picker insertion.** Open the toolbar emoji submenu, insert one, saved doc contains it. (Submenu ARIA is covered; insertion isn't.) | real-VS-Code, 1 test — can share a boot with C1's fixture if convenient. |
| C5 | **IME composition.** CDP `Input.imeSetComposition` in IR prose AND inside a WYSIWYG-highlighted code block — duplication/caret check. The `wrapLuteFlatten` + caret-as-char-offset machinery is exactly what composition events break. | = 455 open item, its own highest-value pick. real-VS-Code (CDP), 1–2 probes → nets; ticks the 455 item. Real-OS IME stays on the manual checklist. |
| C6 | **HTML-comment editing.** Caret-in reveals raw `<!-- -->`, edit, save fidelity (unit/harness cover decoration; no real-VS-Code journey). | real-VS-Code, 1 test — low priority, can merge assertions into C2's boot. |
| C7 | **Drag-drop text / non-image file → link.** Synthetic drop carrying `text/plain` + a file item — only images are handled today (`image-upload-wire` covers the image path). | = 455 open item. Harness layer, 1 test; ticks the 455 item. OS-native drag stays manual. |

## Phase 4 — chrome, settings, robustness

| # | Journey | Notes |
|---|---------|-------|
| D1 | **Status bar truth.** Word count updates while typing; mode indicator tracks a mode switch; "Large md" marker appears on a streamed doc. Unit-only today. | 1 test (+ assert inside an existing large-file boot for the marker). |
| D2 | **Outline Explorer tree.** Click a tree item with the editor open → scrolls it; with no editor open → opens source at the heading's line. Unit-only today. | 1 test. |
| D3 | **Wiki create-missing-page.** Ctrl+Enter on a missing `[[Page]]` → file created under `wiki.root`, opens. Chip UX is harness-covered; the *filesystem* half was deferred by 190 as set-up-heavy ("wiki-follow" §5). | 1 test (two-file wiki workspace fixture). |
| D4 | **`css.external` live reload.** Edit the external CSS file on disk → webview restyles without reopen (`settings-live-apply` covers `css.custom` only). | 1 test. |
| D5 | **Remote-image gate flip.** Doc with an `https:` image: blocked by default, appears after `image.allowRemote` flips live. (Tiles variant covered by `geojson-tiles`; the plain-image variant isn't.) | 1 test. |
| D6 | **`defaultModeByGlob`.** A glob-matched path opens in the configured mode (plain `defaultMode` is covered; the glob override is unit-only). | 1 test. |
| D7 | **Real-wheel zoom gate.** Plain wheel over an interactive diagram scrolls the page; Ctrl+wheel zooms — with a REAL wheel event (today's gate specs are synthetic-event driven). | 1 test, L3 `mouse.wheel`. |
| D8 | **Webview reload mid-edit.** "Developer: Reload Webviews" with unsaved changes → content + dirty state survive. (455's cousin "tab-restore" is since largely covered by `caret-tab-return.spec.ts` — verify at execution and tick if so.) | 1 test (probe-first). |
| D9 | **Large-doc editing.** On a >700 k streamed doc: type, undo, save (only *open* is covered today). | 1 test, reuse `stream-large-file`'s fixture/boot if possible. |
| D10 | **Keybinding scope release.** With a plain text editor focused, Ctrl+D / Ctrl+L / Ctrl+H behave as stock VS Code (the `when` clause releases). Cheap sanity net for the 16-binding surface. | 1 test. |
| D11 | **Config interaction pairs.** `fullWidth`×`outline`, `fontSize`×`codeLineNumbers` — parametrized boots at the **chromium-harness** layer (task 450's lesson: per-parameter real-VS-Code boots are the expensive mistake). | = 455 open item. Harness, 1 parametrized spec; ticks the 455 item. |

## Manual QA checklist (not automatable / poor automation ROI)

Journeys the user should verify by hand per release — kept here so they're not silently dropped:

- [ ] **Hot exit**: dirty vMarkd editor → close the VS Code window → relaunch → content restored from backup.
- [ ] **"Save" in the close-confirmation dialog** — close a dirty tab and choose Save; the file
      must contain the edit. UNAUTOMATABLE here by construction (see A8 above): the test runner
      makes VS Code skip the dialog and always answer Don't Save. The Don't-Save branch IS
      automated; only this one needs a human.
- [ ] **Real OS-level IME** (CJK) and AltGr Polish input (xvfb/CDP composition covers the synthetic half — C5).
- [ ] **OS-shell drag-and-drop** of a file from Explorer/Finder into the editor (Playwright can't originate OS-native drags; C7 covers the synthetic path).
- [ ] **Workspace trust**: untrusted window → editor opens, image paste defers, no feature crashes. (= 455 open probe "untrusted/virtual workspace" — automate there if `vscode-test` restricted-mode launch proves workable; has a security edge via task 359's link allowlist.)
- [ ] **Screen reader** (NVDA/Orca) pass over toolbar + outline (ARIA is asserted structurally; SR behaviour isn't).
- [ ] **Window zoom levels** (Ctrl+=/-) don't break layout/caret.

## Explicitly out of scope

- **Find & Replace** — the feature doesn't exist (task 196, planned/design-first). Journeys here pin
  *current* behaviour only, including that Ctrl+H fires Format: Headings (the accepted collision).
  Replace tests come with task 196.
- **Copy-as-HTML** — already covered (`copy-clipboard.spec.ts`, per 455's strike-off list); no work here.
- **Rename-while-open L3** — deliberately not re-proposed; unit-covered, L3 known-fragile (190 P2 triage).
- **Line-targeted vMarkd open** (global-search result → open at line) — stays a 455 item; overlaps
  tasks 52/229, probe belongs there before either implements a second path.
- **Performance gates** — the @probe fleet measures; converting probes into regression gates is its
  own decision, not part of this plan.
- **Fixing the task-514 residual** — that's task 515 (in progress in a parallel session).
- **Screen-reader automation.**

## Execution notes

- Implementation per standing convention: delegate spec-writing to Sonnet subagents; lead model
  keeps the journey definitions, red-then-green verification, and flake screening.
- `node build.mjs` before any real-VS-Code run; never run the FULL suite unprompted — per-spec runs
  + FAST while iterating.
- Probe-first items (A1, A4, A5, A6, B3, C5, D8): land the @probe spec, read the measurement, agree
  the contract, then write the pinning test — `@probe` tier conventions per
  `test/backend/probe-tier-convention.test.ts`.
- Any focus/keyboard-driven spec: `--repeat-each=4` before declaring it stable.
- When a journey here mirrors a 455 item (A5, A7, C5, C7, D11, manual-trust), tick the 455 entry on
  completion and record the probe finding there or here — never leave a ran-probe unrecorded (455's
  own rule). 455's "Ctrl+F opens at all" item can be struck now (answered by 514).
- Fixtures: prefer extending `all-renderers.md` / existing fixtures over new ones where the journey
  allows; new fixtures live in `test/vscode-e2e/fixtures/`.

## Appendix — modules with no dedicated unit test (supporting data, not journeys)

From the unit-layer sweep; e2e-covered ones noted:

- `media-src/src/editing/caret-scroll.ts` (49 L) — no test at any layer found by name.
- `media-src/src/chrome/toolbar-dismiss.ts` (27 L) — click-outside close; no test found.
- `media-src/src/diagram-kit/svg-recolor.ts` (22 L) — shared recolor; no direct test.
- `media-src/src/nav/outline-keyboard.ts` (281 L) — e2e-covered (`outline.spec.ts`), no unit file.
- `media-src/src/editing/table-hotkey.ts` (55 L) — e2e-covered (harness), no unit file.
- `media-src/src/diagrams/d2/d2-style.ts` / `d2-svg-paths.ts` / `d2-svg-shapes.ts` (~1.7 k L total)
  — exercised only indirectly through `d2-render.test.ts`'s `toSVG` assertions.
- `media-src/src/boot/main.ts`, `boot/preload.ts` — entry points, e2e-exercised only.

Also: two `test.skip`s in `plantuml-stdlib-more.spec.ts` are tied to the disabled
`PUML_POST_RENDER_THEMING` flag (task 355) — re-enable together with the flag, not before.
