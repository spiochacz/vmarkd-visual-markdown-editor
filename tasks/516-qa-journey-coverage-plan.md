# 516 — QA journey coverage plan: untested user journeys

**Status:** planned

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
- [x] **C5** IME composition — `ime-composition.spec.ts` + `ime-helpers.ts`. **Found a real bug:
      composition corrupts the text** → [task 518](518-ime-composition-corrupts-text.md). Closes
      the 455 IME item.
- [x] **C7** non-image drag-drop — probe in `dragdrop.spec.ts`. **Found a real bug: the upload
      pipeline crashes silently** → [task 517](517-drop-file-with-text-crashes-upload.md).
- [x] **D11** config interaction pairs — `config-pairs.spec.ts` (harness). Closes the 455 item.
- [ ] **A7** untitled → Save As — journey confirmed working end-to-end; spec landing. Two
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

### Still to do

A5 (wiki chip rewrite on rename) · A6 (file deleted on disk) · B3 (matches in code/diagram/
collapsed regions) · B4 (find × mode switch and save) · C2 (footnotes) · C3 (math) · C4 (emoji) ·
C6 (HTML comments) · D1 (status bar) · D3 (wiki create-missing-page) · D7 (real wheel zoom gate) ·
D8 (webview reload mid-edit) · D9 (large-doc editing) · D10 (keybinding scope release).

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
