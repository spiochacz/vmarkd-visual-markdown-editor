# Task 150 — Automated render gate for the offline diagram renderers + coverage tooling

> **Status:** ✅ DONE (2026-06-27 — all three items; see the completion note below).
> Created 2026-06-24 from a multi-agent whole-system architecture review.
> **The render-gate gap is ship-class for this branch.**
> **Source:** architecture review (2026-06-24), test-arch lane, adversarially verified.
> **Value / Risk:** 🔴 the flagship feature can silently stop rendering with green CI / medium —
> harness-fidelity work + a nightly job; no product code change.
>
> **🟢 DONE 2026-06-27 — all three items:**
> - **1a (render gate):** the 8 `test.fixme()` in `media-src/e2e/custom-diagrams.spec.ts` are now real
>   CI assertions. The "WYSIWYG harness doesn't expose `.language-*`" premise was STALE — empirically it
>   does, so no Preview-mode harness was needed. All 10 pass (3× repeat, stable), INCLUDING stl (chromium
>   has a swiftshader WebGL ctx) and d2 (the WASM boots) — so the headless harness covers MORE than the
>   real-VS-Code suite here. Fixed the one genuinely-wrong assertion (nomnoml text fill: nomnoml paints
>   via an inherited parent `<g>`, so assert "no baked palette colour survives + currentColor present").
> - **1b (nightly):** `.github/workflows/nightly.yml` runs the full real-VS-Code suite (`test/vscode-e2e/`,
>   incl. d2-elk + custom-diagrams-render) under xvfb on schedule + `workflow_dispatch` + `v*` tags, with
>   the VS Code download cached + pinned via `VMARKD_VSCODE_VERSION` (`playwright.config.ts` now reads it).
>   Documented release-blocking in DEVELOPMENT.md.
> - **2 (coverage allowlist drift):** one SSOT `media-src/e2e/harness-entries.mjs` now drives serve.mjs's
>   esbuild entryPoints + HTML routes (293→99 LOC, was 4 parallel ~31-item lists) AND coverage-options.ts's
>   entryFilter. Meta-test `test/backend/harness-registry.test.ts` locks it. The 9 dropped bundles are
>   back — `custom-diagrams.ts` now reports **88%** coverage (was 0/uncovered). The registry bug it caught:
>   the entry's default ts was `custom-diagrams-harness-harness.ts`.
> - **3 (coverage thresholds):** `test/vitest.config.ts` has non-regression `thresholds` (56/51/54/56,
>   baseline ~59/55/57/60); `ci.yml` runs `npm run test:coverage` so a drop fails the build; e2e coverage
>   documented as intentionally out-of-CI with a manual release-checklist check in DEVELOPMENT.md.
> Gates: typecheck + 934 unit (+ thresholds) + lint + full e2e (339 pass; 1 pre-existing local-xvfb
> auto-scroll flake that also fails at pre-session HEAD~2) all green.

## Why this exists
The fork's headline feature is the **offline diagram renderers**. The whole-system pass found they
have **no automated render gate** — green CI overstates safety along exactly the axis this branch
(`feat/offline-diagram-renderers`) is judged on.

## Findings → work items

### 1. 🔴 CI render assertions are all `test.fixme()`; real proof is a manual-only suite
`media-src/e2e/custom-diagrams.spec.ts:32-196` has **8 `test.fixme()`** (wavedrom, nomnoml ×2,
geojson, topojson, stl ×2, d2); only geojson-offline + vega-lite actually run in CI. Real per-renderer
verification lives in `test/vscode-e2e/custom-diagrams-render.spec.ts` whose `package.json` says **"Not
run in CI"**; `test/vscode-e2e/d2-elk.spec.ts:8-9` notes the elk worker-rejection→**silent-dagre-
fallback** bug class "does not reproduce in the Playwright harness"; `playwright.config.ts:10-13` keeps
the 23-spec real-VS-Code suite out of the CI gate and **no workflow runs `test:vscode`**. So any
renderer can stop emitting an SVG/canvas and CI stays green.
- **Fix (a):** close the harness-fidelity gap — drive the harness through Vditor **Preview mode**,
  where `.language-*` IS emitted for unknown langs (per the spec's own TODO), then convert the 8
  `fixme`'d assertions into real CI tests asserting an SVG/canvas is produced.
- **Fix (b):** promote the real-VS-Code suite to a **scheduled/nightly + pre-release-tag** job that
  caches the VS Code download and pins `vscodeVersion`; treat `d2-elk` + `custom-diagrams-render` as
  **release-blocking** so the worker-rejection→silent-dagre class has a signal. (a) and (b) are
  complementary — (a) for fast CI, (b) for the webview-only bug classes (e2e-harness-mandatory + the
  "some webview-only bugs can't be headless-reproduced" reality).

### 2. 🟠 E2e coverage allowlist drifted; 9 harness bundles silently dropped
`media-src/e2e/serve.mjs:20-58` registers 31 entryPoints but `coverage-options.ts:20-23` lists only
21 → the 9 dropped (wysiwyg-highlight, echarts, blockbg, gap, codenav, callout-ir, callouts,
preview-scroll, **custom-diagrams-harness**) read as 0%/uncovered though their harness ran — hiding the
active branch's hot module `custom-diagrams.ts`. `serve.mjs` keeps three parallel ~31-item lists
(entryPoints, readFileSync, route handlers) + this allowlist; `DEVELOPMENT.md:304-308` warns the drift
"is easy to miss".
- **Fix:** derive `entryFilter` from the `serve.mjs` entryPoints keys (or invert to a tiny denylist),
  and generate the route table + html map from those keys so four edit sites collapse to one source of
  truth; add a meta-test asserting every `serve.mjs` entry (minus bench) is matched.

### 3. 🟡 No coverage thresholds anywhere; "verify coverage" DoD is unenforced
`test/vitest.config.ts:25-37` configures v8 + reporters but has **no `thresholds`**; e2e coverage is
gated behind `E2E_COVERAGE` and referenced by zero workflows; `ci.yml` runs tests with no coverage
flag. `AGENTS.md` makes coverage a definition-of-done, but nothing computes/gates it.
- **Fix:** a non-regressing global threshold in `vitest.config.ts` + a `--coverage` unit run in
  `ci.yml`; document e2e coverage as intentionally out of CI but add a report check to a **release
  checklist** so the rule has teeth. (Coverage-% gating is contested — keep it non-regressing, not
  aspirational.)

## Tests (per AGENTS)
- This task IS test infrastructure: the deliverable is the converted render assertions (item 1a), the
  nightly job (1b), the coverage-allowlist meta-test (2), and the CI coverage run (3).

## See also
- `media-src/e2e/{custom-diagrams.spec.ts,serve.mjs,coverage-options.ts}`, `test/vscode-e2e/*`,
  `.github/workflows/ci.yml`, `playwright.config.ts`, `DEVELOPMENT.md` (running tests headless).
- Tasks 142 (renderer parity hub — the verify-first items become real tests here), 144–148 (each
  review's "verification" section lands its e2e here). Memory: e2e-harness-mandatory,
  webview-focus-scroll-not-in-harness, e2e-prefer-headless-chrome.
