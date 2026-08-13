# 524 — real-VS-Code specs leak GLOBAL settings into the shared profile

**Status:** 📋 OPEN — the three specs it actually broke are fixed; the hygiene problem itself is
not · **Impact:** 🟠 order-dependent flakiness across the suite, and failures that look like
timing/product bugs but are not · **Found:** 2026-08-13/14 during
[task 516](516-qa-journey-coverage-plan.md)'s full-suite triage.

## The problem

The real-VS-Code suite runs in ONE worker-scoped VS Code profile. Specs write settings with
`vscode.ConfigurationTarget.Global` and mostly never put them back, so each spec inherits whatever
the previous one left. About **40 spec files write `vmarkd.theme.content` alone**, and a count of
cleanup hooks (`afterEach`/`afterAll`/`finally`) in those same files shows most have none.

This does not read as pollution when it bites. It reads as a race, which is why it cost real time:

| Symptom | Looked like | Actually was |
|---|---|---|
| `d2-render-sweep` token colour never followed a content-theme flip | a re-theme timing race | `caret-empty-typing` leaked `theme.code = 'a11y-light'`; `resolveCodeStyle` honours an explicit code theme verbatim, so EVERY later content-theme flip was a permanent no-op for token colour |
| `outline-explorer` waited 60 s on a hidden `.vditor-wysiwyg` | a hung open path | `editor.defaultMode` defaults to `remember`, so the open inherited a wysiwyg+Preview session an earlier spec left |
| `prerender-style-parity` height 47 vs 56.39 | the overlay genuinely differing from the editor | an inherited content theme: the overlay picks its stylesheet at HTML-build time, the settled editor uses the live theme |

Each was fixed at the consuming spec (pin what you depend on) plus, for the first one, at the
source. The general hygiene gap is untouched: any spec that depends on an unpinned setting is one
reorder away from the same class of failure.

## Why this is worth fixing properly

- Every occurrence costs a full triage cycle, because the failure surfaces far from its cause and
  looks like a product bug. Two of the three above were initially misread as timing.
- It makes the suite order-dependent, which defeats the point of running specs independently.
- It is invisible to the fast/smoke tiers, which run a subset — so it shows up only in the ~50 min
  full run, the most expensive place to discover anything.

## Options

1. **A shared helper** — `withSettings({...}, fn)` or a fixture that snapshots the `vmarkd` config
   before a test and restores it after. Fixes it everywhere at once and is the only option that
   stays fixed as new specs are written.
2. **Per-spec cleanup hooks** — mechanical, ~40 files, and it re-rots the moment someone forgets.
3. **A fresh profile per spec file** — cleanest isolation, but `userDataDir` is worker-scoped in
   `vscode-test-playwright` and per-file profiles would multiply the already-dominant boot cost.

Recommendation: option 1, with the restore in an `afterEach` (NOT a `finally` inside the test — a
red run must not leave the profile poisoned for everything after it), plus a lint/test guard that
fails if a spec calls `.update(..., ConfigurationTarget.Global)` outside the helper.

## Note for whoever picks this up

`process.env.X = undefined` stores the STRING `"undefined"`, which is truthy — that exact mistake
held the prerender overlay open for every later spec in the worker and made `preview-widgets` flaky
until it was fixed with `delete`. Any env-based test hook needs the same care as the settings.
