import path from 'node:path'
import { defineConfig } from '@playwright/test'
import type {
  VSCodeTestOptions,
  VSCodeWorkerOptions,
} from 'vscode-test-playwright'

// "real-vscode" suite — launches an actual VS Code (downloaded to .vscode-test/) with the
// built vMarkd extension loaded, opens a fixture in the vmarkd.editor custom editor, and
// measures/screenshots the REAL webview (VS Code injects its own default CSS + runs the
// real custom-editor pipeline). This closes the harness↔real gap for the "repro only in the
// real editor" bug class. SLOW + heavy (downloads VS Code) — opt-in, NOT in the CI gate;
// run with `npm run test:vscode`. Requires a prior `node build.mjs` (out/ + media/dist/).
//
// Geometry/computed-style assertions by default — golden screenshots ONLY behind the `@visual` tag
// (skipped unless VMARKD_VISUAL=1, see grepInvert below): linux-electron font rendering is
// machine-dependent, so pixel baselines would make the nightly gate red on a runner with different
// fonts. The one diagram surface that DOES need pixels (diagram-visual.spec.ts — the paint-a-copy
// path, where the harness cannot reach) lives behind that tag and is run locally by hand.
const repoRoot = path.resolve(__dirname, '../..')

// ── The two tiers ───────────────────────────────────────────────────────────────────────────────
// Cost model (task 448 — corrected 2026-07-30, an earlier version of this comment said "per SPEC"
// and got the optimisation advice backwards): the boot is per `test()`, not per spec file.
// vscode-test-playwright's `electronApp` fixture (node_modules/vscode-test-playwright/dist/index.js)
// is declared `{ timeout: 0 }` with NO `scope: 'worker'`, so Playwright's default test-scope applies
// — it launches and `.close()`s a fresh VS Code per `test()`. Only `_vscodeInstall` /
// `_createTempDir` are `scope: 'worker'` (grep both to verify). Consequence: splitting one test into
// four QUADRUPLES the boot cost; merging four `test()`s that share a fixture into one REMOVES three
// boots (see task 450). Trimming what a test asserts barely helps; how many `test()` blocks a spec
// declares is what the wall clock tracks. The full suite is NOT the ~40 min this comment used to
// claim — that estimate came from treating the 145-ish spec FILES as the unit of cost. It is also
// not a single clean number, and deliberately NOT pinned here: re-run `npx playwright test --list`
// for today's exact test count — it moves with every merge (task 450 collapsed 37 tests into 7
// across 3 files alone) and every spec another agent adds, so a number written on one date is stale
// on the next; add VMARKD_PROBES=1 to see the delta task 449 excludes by default. Don't trust either
// endpoint below without re-measuring — per-test cost swings with machine load (see the FAST line
// just below, measured twice a few days apart at nearly 2×). Derivation: current test count × the
// FAST tier's own measured per-test rate (13–29 s, see below) is the bulk of it, and the full
// suite additionally carries ~16 min of static sleeps concentrated in specs FAST doesn't run
// (diagram parity / mode-switch — task 451) plus PlantUML/D2 engine renders FAST never touches —
// so treat "on the order of an hour to two" as the honest range, not a number to cite verbatim.
// That is a gate to run before you hand work over, NOT after every edit. So there are two named
// sets, both defined here rather than as spec lists in package.json, so the reasoning lives with
// them:
//
//   SMOKE — the PR gate (.github/workflows/pr-webview-smoke.yml). Boot/layout parity, every
//           renderer draws, and the change-stability core: save-to-disk fidelity, undo-to-disk,
//           split editing, scroll preservation, clipboard, upload (task 190). ~2 min.
//   FAST  — SMOKE plus the surfaces that break most often when editor behaviour changes at all:
//           host↔webview document sync, mode switching with observers attached, and the two
//           whitespace-fidelity nets (tasks 370/60/369). This is the routine tier. It has grown:
//           33 tests measured 12.8–15.8 min (23–29 s/test) on 2026-07-27; 39 tests measured 8.5 min
//           (~13 s/test) on 2026-07-30, on a less machine-contended run; 58 tests (task 511
//           follow-up, reviewed against this comment's own design intent — see the FAST_SPECS
//           comments below) measured 11.9 min on 2026-08-12 — all three numbers are real, this
//           suite's wall clock is load-sensitive, not just size-sensitive. Budget accordingly — it
//           is no longer an after-every-edit run.
//
// COST NOTE (task 532 step 8, measured 2026-10-08 at load average ~20, i.e. NOT a quiet box):
// parity-matrix.spec.ts full = 10 boots, 6.4 min wall clock (24-51 s per configuration, ~29 s median)
// - this is what the nightly/tag gate pays (it runs the full tier, so the matrix needs no extra
// wiring); the fast tier runs 1 configuration (~27 s). Number moves with load; re-measure, don't cite.
//
// Everything else — diagram engines, themes, parity matrices — only runs in the full suite, because
// it is slow and rarely what a non-diagram change breaks. Whatever tier you pick, also run the
// spec(s) covering the surface you actually touched. (Perf probes are a THIRD population, behind
// `@probe` — task 449 — excluded from every tier including full; `npm --prefix test/vscode-e2e run
// test:probes` opts back in.)
const SMOKE_SPECS = [
  'webview.spec.ts',
  'custom-diagrams-render.spec.ts',
  'undo-dirty-probe.spec.ts',
  'save-fidelity.spec.ts',
  'sv-split.spec.ts',
  'scroll-preserve.spec.ts',
  'copy-clipboard.spec.ts',
  'paste-real.spec.ts',
  'image-upload-wire.spec.ts',
]
const FAST_SPECS = [
  ...SMOKE_SPECS,
  'doc-sync.spec.ts',
  // Task 513 — an image swapped on disk under an unchanged path. Cheap (~8 s) and it guards a
  // host+webview wire (file watcher -> assets-changed -> cache revalidation) nothing else covers.
  'image-swap-refresh.spec.ts',
  // Task 514 — Ctrl+F, typing a matching query, and the find box losing focus (the rest of the
  // query then edits the document). ~13 s, one test, and the only net over it: the find widget is
  // HOST workbench UI driving Electron's findInFrame, neither of which exists in the chromium
  // harness, and the loss is transient — nothing else here would notice it.
  'find-widget-focus.spec.ts',
  'callouts-mode.spec.ts',
  'inline-code-gap.spec.ts',
  'block-fidelity.spec.ts',
  'git-conflict.spec.ts',
  'clipboard-collapsed.spec.ts',
  // Task 387 — cutting a real selection, in the modes clipboard-collapsed.spec.ts doesn't cover
  // (undo, WYSIWYG) plus the sv regression pin (its own file — see the comment there).
  'cut-selection.spec.ts',
  'cut-selection-sv.spec.ts',
  'ir-inline-code-line.spec.ts',
  // The only net that crosses all three edit modes — it is what caught task 240 shipping with the
  // split (sv) path still dropping reference-definition titles, after IR and WYSIWYG were green.
  'mode-roundtrip.spec.ts',
  // The split-preview copy path (task 386) — a whole clipboard mechanism no other spec touches.
  'clipboard-preview.spec.ts',
  // Focus/caret survival across a tab switch (task 389). Costs ~1.5 min of the tier — earned,
  // because a lost caret is invisible to every other spec here (they place the selection
  // programmatically, which works fine on an unfocused editor) and immediately obvious to the user.
  'caret-tab-return.spec.ts',
  // The keyboard escape gesture (task 456). Held out of every tier while its focus-landing leg was
  // failing; added on the round-9 fix (0/26 → 4/4 green, then 3/3 more on the shipped build). One
  // test, ~10 s, and it is the only net over both the WCAG 2.1.2 trap and the caret coming back at
  // the position the user left — a caret restored to the wrong place is invisible to every other
  // spec here and immediately obvious to the user.
  'escape-toolbar.spec.ts',
  // The gap cursor's headline case (task 292): a document that STARTS with a rendered diagram had
  // no caret position above it at all. One test, ~13 s, and the only net over it — the strip you
  // click depends on VS Code's injected webview CSS and on the diagram really being rendered, so
  // the chromium harness cannot stand in for it, and every other spec here opens a document whose
  // first block is text.
  'gap-cursor.spec.ts',
  // Task 486: repeated Enter below a callout/code-block at EOF used to snap the caret back to the
  // last line with text — cleanupGapParagraphs reclaimed each fresh Enter-split as a stale
  // navigation splice. Two tests (~15-30 s of boots), and the ONLY net over it: the bug needs the
  // real webview's native Enter split + MutationObserver-driven cleanup, which the chromium harness
  // cannot reproduce (same real-webview-only class as gap-cursor just above).
  'gap-enter-chain.spec.ts',
  // 2026-08-12 additions (task 511 follow-up) — reviewed with a second model (fable) against this
  // tier's own design intent ("surfaces that break most often when editor behaviour changes":
  // doc-sync, mode-switching-with-observers, whitespace fidelity), not just "seems important".
  // Explicitly considered and left OUT: mode-switch-parity, mode-switch-render-reuse,
  // wysiwyg-parity — each is a diagram/theme PARITY-MATRIX concern wearing a mode-switch trigger,
  // which this tier's own comment already excludes by name, and each carries 40s+ of settle sleeps
  // 451 deliberately did not convert. They stay FULL-only.
  //
  // The host↔webview write race (task 477) — silent data loss if this regresses, and it is the
  // literal doc-sync mechanism this tier already names. One test, cheap.
  'writeback-own-race.spec.ts',
  // isSemanticNoop's whole-doc check off the 250ms edit-sync tick (task 434) — same doc-sync
  // family, different failure mode (spurious dirty/save cycling instead of a lost edit).
  'noop-check-on-save.spec.ts',
  // ADR-0007/task 446 — the caret authority's real-VS-Code acceptance test. This is the mechanism
  // underneath every other caret spec in this tier (caret-tab-return, gap-cursor); a narrower
  // caret-on-open pin was considered and left out as redundant coverage of the same authority.
  'caret-authority-rebuild.spec.ts',
  // Visual↔text editor command round-trip (task 190 P2) — mode-switching at the VS Code COMMAND
  // layer, not just within-webview, which the rest of this tier doesn't cover.
  'commands-lifecycle.spec.ts',
  // The 3 synchronous, before-paint decorators (code-source/callouts/…, task 173/174) — literally
  // "mode switching with observers attached": these re-fire on every mode transition and are what
  // silently breaks when observer wiring changes, invisible to specs that only check the end state.
  'scoped-decoration.spec.ts',
  // A tight list must stay tight while edited (task 391) — directly the "whitespace-fidelity nets"
  // category this tier's own comment names.
  'list-tight.spec.ts',
  // Task 505's "one owner per key" hotkey rewrite (Ctrl+B/I/D/G, list/quote/heading keys,
  // indent/outdent, undo/redo dedupe) — the most central keystroke-routing mechanism in the editor;
  // if this regresses, most editing regresses. The priciest single add here (6 tests, ~26s of its
  // own settle sleeps that CANNOT be poll-converted — see tasks/512, they guard against a DELAYED
  // double-fire, not a positive completion signal, so a poll would mask exactly the bug class this
  // file exists to catch) — included anyway because the mechanism is that central.
  'format-hotkeys.spec.ts',
  // 2026-08-13 (task 516 A1) — clicking a task-list checkbox and having the flip reach disk. The
  // ONLY addition this tier took from that task's ten new journey specs, deliberately: it is a
  // one-click mutation users make constantly, it writes to the DOCUMENT (silent data loss if it
  // regresses, which is this tier's stated bar), and no other spec here clicks a checkbox at all.
  // It also has to be real-VS-Code: a synthetic click loses the caret context and collapses
  // getValue() in the chromium harness — that artefact is precisely why the journey went five
  // weeks unconfirmed. Two tests, ~30 s. Everything else from 516 stays FULL-only.
  'checkbox-toggle.spec.ts',
  // 2026-10-08 (task 532 step 1) — the cross-stage visual-parity gate, ONE boot in this tier: the
  // user's own configuration (`auto` under Default Dark Modern = vscode-dark-2026). Captures the
  // canonical fixture (every element kind) in five stages — held overlay, IR, Preview, WYSIWYG,
  // split pane — and compares them under test/parity/policy.ts. Cost ~1 boot + ~25-40 s of capture
  // (stabilisation polls + mermaid/d2 renders); the full tier runs the 10-configuration matrix
  // (one boot each) from the same file. It belongs here because the drift it guards — list indent,
  // block gap, code leading, overlay decorations — is invisible to every other spec in this tier and
  // is seen on EVERY open and mode switch; the harness twin (media-src/e2e/parity.spec.ts) cannot
  // see VS Code's injected CSS or the custom-editor pipeline.
  'parity-matrix.spec.ts',
  // 2026-10-08 (task 532 step 6/8) — a loose list (blank lines between items) must keep them when
  // edited, in getValue, the saved file and the Preview. Same whitespace-fidelity family as
  // list-tight.spec.ts just above and a silent on-disk rewrite if it regresses. 2 tests (IR +
  // WYSIWYG), ~32 s. Deliberately left FULL-only from the same task: diagram-overlay-height.spec.ts
  // (1 boot, ~21 s) and prerender-open-mode.spec.ts (3 boots, ~44 s) - the overlay-vs-editor drift
  // they guard is already seen in the fast tier by the parity gate's overlay stage, and their
  // specific cases (reserved diagram height, open mode) change rarely.
  'list-loose.spec.ts',
]
const tier = process.env.VMARKD_FAST
  ? FAST_SPECS
  : process.env.VMARKD_SMOKE
    ? SMOKE_SPECS
    : undefined

// Mark every run as the e2e harness. vscode-test-playwright copies process.env into the launched VS
// Code (minus VSCODE_*), so the extension host sees this — the DiagramCache wipes its worker-shared
// disk store per test (freshStart), isolating the render cache. Without it, a diagram cached by one
// spec HITS in a later spec and breaks fresh-render specs (d2-lazy-load, etc.) order-dependently —
// the dominant cause of the suite's "passes solo, fails in the full run" flakiness.
process.env.VMARKD_E2E = '1'

// task 449 — `@probe` tags the ~32 tests whose own headers say they assert nothing (pure
// measurements/throwaway probes — see the tagged files for the `@probe` header note). Excluded by
// default, same idea as `@visual` below, opt back in with `VMARKD_PROBES=1` (`npm run test:probes`).
// Composed into ONE regex from an array of active exclusion patterns rather than the old
// `cond ? undefined : /@visual/` ternary shape: that shape does not compose — a second independent
// tag flipped on/off by its OWN env var needs its own OR branch, not a second ternary that would
// silently stop excluding `@probe` whenever `VMARKD_VISUAL=1` was set (and vice versa). Verify all
// four on/off combinations with `npx playwright test --list` (± VMARKD_VISUAL, ± VMARKD_PROBES).
//
// Excluded from the default run does NOT mean "run never" — probes pin behaviour that has no
// contract yet, and several real task-516 bugs surfaced through them. Run `VMARKD_PROBES=1` on a
// schedule (not as a blocking gate), and take a probe failure as real signal about drifted
// behaviour, not noise to silence. Evidence an unrun probe rots (2026-08-16 audit): three of them
// were asserting they knew something while actually knowing nothing —
// `webview-message-origin-probe` had been measuring ZERO messages ever since
// `vmarkd.editor.fullWidth` defaulted to `true`, making its own trigger a no-op, and it kept
// "passing" the whole time because nothing checked what it was actually measuring.
const grepExcludePatterns: string[] = []
if (!process.env.VMARKD_VISUAL) grepExcludePatterns.push('@visual')
if (!process.env.VMARKD_PROBES) grepExcludePatterns.push('@probe')
const grepInvert = grepExcludePatterns.length
  ? new RegExp(grepExcludePatterns.join('|'))
  : undefined

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: __dirname,
  // ONE worker — a deliberate choice as of 2026-08-12, no longer the untested default this comment
  // used to assert ("VS Code single-instances; never parallelise"). Task 452 measured it: the suite
  // DOES parallelise (`--workers=3` → 3 concurrent VS Code processes on distinct workerIndex,
  // per-worker installs under `.vscode-test/worker-N`, per-worker `--user-data-dir`; the render-cache
  // trio `diagram-cache`/`d2-lazy-load`/`abc-flip-cache-hit` stayed isolated, 5/5). SMOKE measured
  // 140.5 s → 88.2 s, i.e. only ~1.6×, because per-test cost inflates ~1.7× under the contention of
  // 3 Electron instances. What blocks it: `xvfb-run -a` gives every worker ONE X display, so the
  // CLIPBOARD/PRIMARY selection and the focus stack are shared globals — 5 clipboard specs at
  // `--workers=3 --retries=0` lost 2 of 7 tests to empty-clipboard reads and dropped selections
  // (16 spec files touch the clipboard). Enabling it therefore needs a display per worker or a
  // serial lane for those specs; 1.6× was not judged worth that machinery. Full data + both fix
  // shapes: tasks/452-e2e-sharding-investigation.md. Do not "fix" this back to a bare `workers: 1`
  // with no reason attached.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Cold VS Code boot + webview render under WSLg/CI is occasionally slow and racy; this is an
  // opt-in PARITY smoke (the harness specs are the real guard), so retry transient boot stalls
  // rather than fail the ad-hoc run. Split 2026-08-12 (task 452): the CI gate keeps 2 because a
  // flake there costs a whole pipeline re-run, but LOCAL runs drop to 1 — a retry is a full VS Code
  // boot (the cost unit here, task 448), so on a genuinely red local run `retries: 2` tripled the
  // wall clock of exactly the feedback loop you are waiting on. Free on green runs, which is why
  // this was never noticed.
  retries: process.env.CI ? 2 : 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // Investigative *spike* specs (perf probes, feasibility studies) are not regression tests —
  // exclude them from the default run, which the release-blocking nightly/tag gate executes
  // (audit 185/1c). Run them on demand via `npm run test:spikes` (sets VMARKD_SPIKES=1).
  //
  // Treat this population as an ARCHIVE, not as tests to keep green: a spike answers a design
  // question once, at a point in time, and what's checked in afterward is the record of that
  // answer. Its red today is not a signal that the product regressed — it is not maintained
  // against later changes, and is not expected to pass. Don't "fix" a failing spike to make it
  // green; that would misrepresent what it is.
  testIgnore: process.env.VMARKD_SPIKES ? [] : ['**/*spike*'],
  // Tier selection (see SMOKE_SPECS / FAST_SPECS above). Unset ⇒ the full suite, which is what the
  // nightly/tag gate runs — do not make either tier the default here, or that gate silently shrinks.
  testMatch: tier,
  // Pixel goldens are opt-in for the font-drift reason above — `npm run test:vscode:visual`. Probes
  // (task 449) are opt-in for the reason above `grepExcludePatterns`. Both compose into one regex.
  grepInvert,
  reporter: [['list']],
  use: {
    extensionDevelopmentPath: repoRoot,
    // PINNED, and the pin is load-bearing — do not change it back to 'stable' without re-testing.
    // VS Code 1.130.0 breaks `electronApp.close()` in vscode-test-playwright@0.0.1-beta2: the test
    // BODY completes normally, but the `electronApp` fixture teardown never returns (the VS Code
    // process stays alive), and that fixture is declared `{ timeout: 0 }` — so the runner blocks
    // forever and NEVER emits a pass/fail verdict. Every spec in this suite becomes unreportable;
    // it looks like a hang in whatever spec you happen to be running. Verified 2026-07-23: the same
    // spec on 1.130.0 must be killed externally with no verdict, on 1.129.0 it reports `1 passed`
    // in 40s. The nightly job (task 150 item 1b) overrides this via VMARKD_VSCODE_VERSION.
    // Re-test 'stable' when a newer VS Code (or a vscode-test-playwright release) lands.
    vscodeVersion: process.env.VMARKD_VSCODE_VERSION || '1.129.0',
  },
})
