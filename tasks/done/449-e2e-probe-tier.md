# 449 — `@probe` tier: get the non-asserting measurements out of the default e2e run

**Status:** ✅ DONE (2026-07-30)
**Parent:** [447 — suite cost analysis](../447-vscode-e2e-suite-cost-analysis.md)
**Estimated saving:** ~29 VS Code boots ⇒ **−12 to −20 min** of the full suite, **zero coverage loss**

## Why

`*spike*` specs are already excluded from the default run (audit 185/1c) because investigative
measurements are not regression tests. A second population never got the same treatment: specs whose
own headers say *"pure measurement: nothing is asserted pass/fail — the console output IS the
deliverable"*, *"MEASUREMENT (not a gate)"*, *"THROWAWAY probe"*, *"prints; asserts nothing"*,
*"the assertion is trivial so it never blocks CI"*. They cost a full VS Code boot each (task 448:
the cost is per `test()`), on every nightly/tag run, to assert nothing.

## The 29 tests (18 files)

`d2-edit-perf` (6) · `caret-focused-open-probe` (3) · `caret-on-open-probe` (2) ·
`caret-first-click-probe` (2) · `perf-observer-fleet` (2) · `probe-cloudogu` (2) ·
`perf-prose-typing` (1) · `perf-timeline` (1) · `katex-open-cost` (1) · `diagram-sizing-audit` (1) ·
`list-typing-probe` (1) · `list-editing-probe` (1) · `probe-pumlmode` (1) ·
`native-preview-probe` (1) · `webview-message-origin-probe` (1) · `prerender-first-open` (1) ·
`diagram-edit-scroll` (1, a before/after timing comparison — inherently noisy) ·
`mermaid-markers` (1, a one-assert "SVG marker probe"; `media-src/e2e/mermaid.spec.ts` covers markers)

## The guard (added after review — the actual durable deliverable)

Team-lead flagged, correctly, that the tag-and-filename conventions above can drift apart the moment
either is touched without the other — and that this already happened twice before the guard existed:
`caret-empty-typing-probe.spec.ts` carried real regression assertions under a probe NAME (renamed off
the convention once found), and `undo-dirty-probe.spec.ts` is a real SMOKE-tier spec with a
historical probe name that was never a measurement-only probe. Both are "someone reads the filename
and silently drops a real gate."

Added `test/backend/probe-tier-convention.test.ts` (vitest, no VS Code boot — parses spec SOURCE with
a regex over `test(`/`test.describe(` title strings, does not `import()` the specs, which pull in
`vscode-test-playwright`). Two directions, each with its own declared-exception list so a mismatch is
either fixed or explicitly justified, never silently ignored:
- **Direction A** — every `*-probe.spec.ts` file must have every test title `@probe`-tagged, unless
  listed in `PROBE_NAME_EXCEPTIONS` with a reason. Seeded with `undo-dirty-probe.spec.ts` (team-lead's
  own example).
- **Direction B** — every `@probe`-tagged test must live in a `*-probe.spec.ts` file, unless listed in
  `TAG_ONLY_PROBES` with a reason. Seeded with the 10 files this task itself tagged before the
  filename convention existed (tag-only, following the pre-existing `@visual` precedent), plus
  `probe-cloudogu.spec.ts` / `probe-pumlmode.spec.ts` (probe as a PREFIX, doesn't match the suffix
  glob). Renaming those files to satisfy the suffix was considered and rejected — several mix a
  probe-tagged test with other content, so a blanket rename would misdescribe the file.
- A third check asserts every allowlist entry names a file that still exists, so a deleted file can't
  leave a stale exemption that silently covers a future file with the same name.

**Verified it actually catches something, twice:**
- Real, not synthetic: Direction A is currently RED — `local-link-open-probe.spec.ts` (another
  agent's file, the links agent's task-359 probe) matches the `-probe.spec.ts` suffix, has zero
  `expect()` calls (confirmed by reading it — pure `console.log` measurement, header says "PROBE...
  no fix lives here"), but carries no `@probe` tag, so it's paying a full VS Code boot in the default
  run for nothing. **Not fixed here** — it isn't my file (team-lead's ownership split: only edit specs
  that existed before this session), and it isn't put on `PROBE_NAME_EXCEPTIONS` either, since that
  would falsely declare it an intentional real-assertion exception when it's actually a probe missing
  its tag. Reported to team-lead so the links agent can tag it or declare why not.
- Synthetic red-check for Direction B (no natural violation existed): temporarily appended ` @probe`
  to one title in `clipboard-elements.spec.ts` (a file I own, not `-probe`-suffixed) — both directions
  failed with the exact expected file name and reason in the message, reverted immediately.
- `caret-empty-typing.spec.ts` looked like a hit on first grep (`grep -l @probe` matched it) — turned
  out to be a false positive: the match was the word "@probe" inside a HEADER COMMENT
  ("...not the `@probe` tier..."), not an actual tag on a `test()` title. This is exactly why the
  guard parses title strings via a `test(`/`test.describe(` regex rather than raw file text — a
  naive file-level grep would have produced a false "mismatch" against a file that's actually fine.

## Do NOT tag these — real nets with probe-ish names

- `undo-dirty-probe.spec.ts` — task 61 v2 regression net, **in the SMOKE tier**
- `undo-redo-steps.spec.ts` — the only redo-direction coverage
- `diagram-cache-reply-source.spec.ts` — its header says *"STANDING NET — do not delete it as scratch"*
- `hljs-colour-timing.spec.ts` — started as a probe, is now the regression net for tasks 427/431
- `caret-on-open.spec.ts` — the task-439 **fix** verification (only the `-probe` sibling is a probe)

**This is why the gate must be a tag, not a filename glob** (`**/*probe*` would swallow the first
three).

## Steps

- [x] Tagged each of the 18 files' test title(s) with ` @probe` (same convention as `@visual`). The
      title count had drifted since this task was written (working-tree churn — see below): actual
      is **32 tests**, not 29 (`d2-edit-perf` 6, `caret-focused-open-probe` **5** not 3,
      `perf-prose-typing` **2** not 1, the rest unchanged) — tagged what actually exists today, not
      the stale count.
- [x] `test/vscode-e2e/playwright.config.ts`: `grepInvert` now composed from a
      `grepExcludePatterns: string[]` array (`@visual` pushed unless `VMARKD_VISUAL`, `@probe` pushed
      unless `VMARKD_PROBES`) joined into ONE `RegExp`, replacing the old
      `cond ? undefined : /@visual/` ternary — that shape does not compose (a second tag's own env
      var would silently stop excluding the FIRST tag). Verified all **four** on/off combinations by
      `--list` count, not just the two named in this task's own Verification section (see below).
- [x] `test/vscode-e2e/package.json`: added `"test:probes": "VMARKD_PROBES=1 playwright test"` next
      to `test:spikes` / `test:visual`. Did **not** add a root `package.json` `test:vscode:probes`
      alias — `test:spikes` has no root alias either, so this follows the existing "on-demand,
      sub-package only" precedent rather than inventing a new one.
- [x] Added the header line to all 18 tagged files (wording adapted per-file where the file already
      names why it's non-migratable, e.g. `mermaid-markers.spec.ts` also notes the harness already
      covers markers, `diagram-edit-scroll.spec.ts` notes it's a noisy before/after comparison).
- [x] Documented the tier in `DEVELOPMENT.md`'s "Test layers" section, in a new table right after the
      `@visual` row (`*spike*` and `@probe` together — `*spike*` was previously undocumented in
      prose anywhere, only mentioned in `playwright.config.ts` and the package.json description, so
      this is also the first prose home for it). Also corrected the "full" tier's row in the tier
      table, which said "…perf probes" — after this task, `@probe` is excluded from *every* tier
      including full/default, so that was now wrong and is fixed to say so explicitly.
- [x] Caught + fixed my own miss: `perf-timeline.spec.ts` got its header note but I forgot to tag its
      actual `test()` title on the first pass — caught by counting `test(...@probe` occurrences per
      file (18 expected, 17 found) rather than trusting the edit had landed everywhere.

## Verification

- [x] `npx playwright test --list` (default, no env): **257 tests in 134 files** right now. **Did
      not** try to reconcile this against the task's predicted "270 → ~241" or the 273/146 figure
      measured earlier in task 448 — `test/vscode-e2e/` had OTHER agents actively adding their own
      untracked spec files throughout this session (flagged to the team lead separately), so the
      total test count moved for reasons that have nothing to do with this task. The number that
      actually isolates this task's effect is the same-moment before/after: with vs without the tag,
      taken back-to-back so nothing else could have changed in between —
      `VMARKD_PROBES=1 --list` (289 tests/152 files) minus default `--list` (257 tests/134 files) =
      **32 tests, 18 files**, exactly the tagged set. That is the number to trust.
      All 5 keep-list specs (`undo-dirty-probe`, `undo-redo-steps`, `diagram-cache-reply-source`,
      `hljs-colour-timing`, `caret-on-open.spec.ts`) confirmed present in the default list and NOT
      matching `grep -l @probe` in their source.
- [x] `VMARKD_PROBES=1 npx playwright test --list` → 289 tests/152 files, all 32 tagged tests present.
- [x] Went beyond the task's "verify 2 combinations" ask and verified all **four** `VMARKD_VISUAL` ×
      `VMARKD_PROBES` on/off states (the actual risk the ternary→array rewrite was fixing):
      neither=257/134, probes-only=289/152, visual-only=263/136, both=294/153 — every combination
      composes additively, confirming the two tags don't clobber each other.
- [x] `VMARKD_SMOKE=1` / `VMARKD_FAST=1` tier counts re-run, unchanged: smoke 10/9, fast 39/21 (same
      as pre-449 in this session).
- [x] Ran two of the newly-tagged probes for real (not just `--list`) with `VMARKD_PROBES=1`:
      `mermaid-markers.spec.ts` and `perf-timeline.spec.ts` — both executed and passed, confirming
      the tag insertion didn't break the test syntax or the fixture paths.
- [x] `npx tsc --noEmit -p test/vscode-e2e` — "No errors found".
- [x] `./node_modules/.bin/biome check` on all 19 touched files (18 specs + `playwright.config.ts`) —
      clean. Also fixed two PRE-EXISTING lint warnings in `caret-first-click-probe.spec.ts`
      (optional-chain suggestion, one unused parameter) while in the file for the `@probe` tag — safe
      autofixes, no behaviour change, and that file was one of the ones flagging `npm run lint:ci`
      red at the start of this session (see task 448's notes) for reasons unrelated to me.
- [x] The guard (`test/backend/probe-tier-convention.test.ts`): `biome check --write` clean,
      `npx vitest run --config test/vitest.config.ts test/backend/probe-tier-convention.test.ts` run
      directly multiple times across the red-check cycle above (synthetic violation → correct failure
      → revert → clean except the one real, un-owned finding). Currently **`npm test` has 1 known
      failing assertion from this new guard** (`local-link-open-probe.spec.ts`, Direction A, not my
      file to fix — see above) — this is the guard doing its job, not a bug in the guard; flagged to
      team-lead rather than papered over with an allowlist entry.

## Follow-up (2026-08-16/17) — `@probe` vs `*spike*` get different treatment

A 2026-08-16 audit of both opt-in exclusions (`@probe` here, `*spike*` from audit 185/1c) found both
had rotted silently, exactly because neither runs in any routine command or the release gate:
`local-link-open-probe` failed on both sides of history; `webview-message-origin-probe` had been
measuring ZERO messages ever since `vmarkd.editor.fullWidth` defaulted to `true`, making its own
trigger a no-op; `mermaid-pipeline-breakdown-spike` was measuring nothing because its keystroke never
reached the document. Three probes asserting they knew something while knowing nothing.

Decision: the two populations are not the same kind of thing, so they don't get the same expectation.
- **`@probe` — keep, and run it periodically.** It pins behaviour with no contract yet, and real
  task-516 bugs surfaced through it. A probe failure is real signal about drifted behaviour, not
  noise to silence. Still excluded from every default tier — the schedule is deliberately NOT the
  blocking gate.
- **`*spike*` — treat as an archive, not as tests to keep green.** A spike answers a design question
  once and is then a record; its red says nothing about the product today, and it is not maintained.

No exclusion mechanism, env var, npm script, or CI wiring changed — this is a documentation update
only. Recorded in `test/vscode-e2e/playwright.config.ts` (both comment blocks) and
`.claude/skills/vmarkd-testing/SKILL.md`.
