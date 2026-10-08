# Developing

How to build, test, and measure coverage for this extension. Read this first
before adding tests.

## Layout

This repo has **two compilation units**, each with its own `package.json`:

| Path | What | Build | Module system |
|---|---|---|---|
| `src/` | Extension host (runs in VS Code / Node) | `tsc` | CommonJS |
| `media-src/` | Webview UI (runs in the browser, uses Vditor) | esbuild | ESM/browser |

Built artifacts (`out/`, `media/dist/`, `media/vditor/dist/`) are generated and
git-ignored. The Vditor assets the webview needs are synced from
`media-src/node_modules/vditor` into `media/vditor/` by the build.

**Maintenance tooling — `media-src/scripts/`** (run by hand, not shipped; outside the
app's lint/typecheck/test surface): `fetch-*.mjs` vendor + sha-pin upstream assets
(lute, mermaid, echarts); `d2-fixtures/` regenerates the d2-quality CI fixture from its
`sources/*.d2` (run after `layoutElk`/ELK-config changes — see its header); `d2-render-harness/`
renders `.d2` through the three layout engines (dagre / raw ELK / vmarkd) to a PNG grid or
zoomable HTML for by-eye layout/feature checks (`--engine all` to compare). Both d2 tools need
`node build.mjs` first (they drive a headless browser for the WASM + vendored ELK).

**GitHub rendering themes (task 82):** `media/markdown-themes/github-markdown-light.css`
and `github-markdown-dark.css` are the **unmodified** upstream files from
[github-markdown-css](https://github.com/sindresorhus/github-markdown-css) (MIT),
vendored verbatim (only a provenance comment is prepended). The webview ships ALL
content-theme stylesheets as `<link>` tags and enables one via `link.disabled` + the
`markdown-body` class the CSS targets (`CONTENT_THEME_FILES` in `html-builder.ts` +
`applyContentTheme` in `live-config.ts`). To update github, copy the newer upstream
files over these — no transform or build step.

**Adding a content theme (task 84):** the theme metadata is single-sourced in
`src/theme-registry.ts` (`CONTENT_THEMES`). Add **one row** — `value`, `file`, `mode`
(dark/light), `code` (paired hljs style), `fontDefaultPx` (16 for a GitHub-style
reading size, else `null` = follow the VS Code editor size) — then add the value to
the `vmarkd.theme.content` enum in `package.json` (a manifest↔registry test enforces
they match). Everything else derives from the registry: `CONTENT_THEME_FILES`,
`effectiveThemeKind`, `codeHljsStyle`, `resolveFontSize`. Drop the CSS file under
`media/markdown-themes/` and keep the README acknowledgement. The `material-dark`
theme (adapted from [raycon/vscode-markdown-style](https://github.com/raycon/vscode-markdown-style),
MIT) is the worked example.

### How content themes control the palette (tasks 84/85)

Markdown renders inside Vditor's `.vditor-reset`, and Vditor ships a **full github-ish
palette of its own** (`hr`/`blockquote`/`table`/inline-code colours) in two
always-present layers — its base `vditor/dist/index.css` (bundled into
`media/dist/main.css`) and `content-theme/{light,dark}.css` (the `vditorContentTheme`
`<link>`). To stop themes from having to out-rank those with `!important`/specificity
tricks, the build (`build.mjs` → `varifyVditorPalette`) rewrites those few Vditor
declarations to **`var(--vmarkd-*, <Vditor default>)`** (and `main.css` does the same
for its blockquote-bg neutraliser + dark inline-code rule). So:

- **`auto`** (follow VS Code) sets the `--vmarkd-*` on `body[data-use-vscode-theme-color="1"]`
  to the theme-aware `--vscode-*` vars (e.g. `--vmarkd-code-bg: var(--vscode-textCodeBlock-background)`),
  so content follows the editor through the SAME mechanism as named themes — no separate
  `!important` block. A few non-mappable bits stay explicit (wrapper bg, blockquote
  overlay, code-block bg, cell borders, checkbox). Unset vars fall back to Vditor's
  default, so anything not driven still looks as Vditor intends.
- A **named theme** just sets the variables on `body.markdown-body` — they inherit into
  `.vditor-reset` and Vditor's own rule resolves to the theme's colour. **No
  `!important`, no `.vditor-reset` specificity matching.**

The variables a theme can set (see any `media/markdown-themes/*.css` for the worked
form):

| Variable | Element |
|---|---|
| `--vmarkd-heading-border` | h1/h2 underline colour |
| `--vmarkd-hr-bg` | `hr` (Vditor draws it as a `background-color` bar, not a border) |
| `--vmarkd-blockquote-fg` / `--vmarkd-blockquote-border` | blockquote text / left bar |
| `--vmarkd-blockquote-bg` | blockquote panel background (unset → transparent) |
| `--vmarkd-table-border` | table cell / row borders |
| `--vmarkd-table-row-bg` / `--vmarkd-table-stripe` | table rows / even-row striping |
| `--vmarkd-code-bg` | inline-code background |

Properties **not** in the table are set directly on `.markdown-body` by the theme (and
win ties because the theme `<link>` is emitted **after** Vditor's in `html-builder.ts`;
`setContentTheme` no-ops at runtime so that order holds): canvas `background`, base
`color` (also on `.vditor-reset`, since Vditor sets the reset's colour directly), link
colour, heading colours, inline-code **colour**, the `.hljs` code-block background
(`!important`, to override the paired hljs `theme.code` stylesheet), and
**`color-scheme: light|dark`** (native form controls). Note `color-scheme` does **not**
fix scrollbars — VS Code drives the webview's native scrollbars from the editor theme, so
`main.css` sets the inherited `scrollbar-color` (+ `scrollbar-width: thin`) on
`body.markdown-body` (`!important`) for every named theme; being inherited it recolours
every content scroller incl. nested code blocks (tunable via `--vmarkd-scrollbar-thumb`).
Font-**size** is never set in theme files — it flows through `--me-font-size` (the
registry default + the `fontSize` setting).

> Why not just strip Vditor's palette? Disabling the `vditorContentTheme` link doesn't
> remove it — the base `index.css` carries it too (structural/bundled). Var-ifying both
> layers in the build is the clean equivalent. See `tasks/85-theme-completeness-contract.md`.

**Webview bundle (task 20):** `media-src/build.mjs` (the `start`/`build` scripts)
imports Vditor from **source** (`vditor/src/index`) so esbuild can tree-shake it.
The source-import specifics live in `media-src/esbuild-shared.mjs` — `define
VDITOR_VERSION`, `useDefineForClassFields:false`, a `.less`→empty loader, a plugin
stubbing 4 unused toolbar buttons (`src/stubs/`), and a `diff-match-patch`
interop rewrite (Vditor's `undo` needs a default import or `new DiffMatchPatch()`
throws — guarded by `e2e/undo-interop.spec.ts`). `e2e/serve.mjs` reuses the same
config so the harnesses bundle Vditor identically.

Beyond that interop fix, `esbuild-shared.mjs` carries a set of **anchored source
patches** to Vditor applied at bundle time (link-open policy gate, list-toggle
null-guard, outline-current highlight, KaTeX resilience, content-based paste-as-code,
IR-input serialize hand-off, English About dialog, …). Each patch throws at build
time if its anchor string drifts on a Vditor bump, so a version upgrade fails loudly
instead of silently no-op'ing; they're unit-covered by
`test/backend/vditor-source-patches.test.ts`. When bumping the vendored Vditor
version, work through **[the Vditor bump checklist](docs/vditor-patch-checklist.md)** —
every `patchXxx` function, its anchor, how fragile that anchor is, what it guards, and
whether it fails loud or (in two documented cases) silently.

## Package manager

**npm only — minimal tooling.** npm installs deps and `node build.mjs` drives the
build directly (no `foy`, no `ts-node`, no Bun — the build script is plain Node
ESM). Do not reintroduce `yarn.lock` / `pnpm-lock.yaml` / `bun.lock` or a
`packageManager` field — CI installs with `npm ci`. There are two lockfiles:
`package-lock.json` (root) and `media-src/package-lock.json`. The extension ships
as plain Node-targeted JS (`tsc` output) and VS Code runs it in its own Node
runtime; the build toolchain is dev-time only.

## First-time setup

```bash
npm ci                       # root deps (extension host + vitest)
npm --prefix media-src ci    # webview deps (esbuild, vditor, playwright, monocart)
node build.mjs               # compile both + sync Vditor assets into media/vditor
npm --prefix media-src exec -- playwright install chromium   # e2e browser (once)
```

`node build.mjs` is required before e2e: the table harness serves real Vditor
assets from `media/vditor/`. (The unit suite does not need it.)

---

## Lint, format & types

Biome handles both lint and format; type-checking is a separate `tsc` pass.

```bash
npm run lint:ci     # Biome check, no writes — the exact CI gate (whole tree)
npm run lint:fix    # Biome check --write — apply safe lint + format fixes
npm run format      # Biome format --write — formatting only
npm run typecheck   # tsc -p media-src/tsconfig.typecheck.json (no emit, webview)
```

`lint:ci` runs over the **whole tree**, so a clean local run must pass before you
push — drift in files you didn't touch will still fail CI. `node build.mjs`
type-checks the host (`tsc -p ./`) as part of the build; `npm run typecheck`
covers the webview side.

---

## Test layers

| Layer | Runner | Location | What it covers |
|---|---|---|---|
| **Unit / backend** | vitest | `test/backend/*.test.ts`, `media-src/src/*.test.ts` | Extension host logic + pure webview helpers |
| **E2e** | Playwright (chromium) | `media-src/e2e/*.spec.ts` | Webview behaviour in a real browser with Vditor |

The first two are the **gate** (run in CI), and are **disjoint** — different runners,
different layers, separate coverage reports. Neither instruments the other.

Two extra **visual-debugging** layers (NOT in the CI gate — see the `vmarkd-visual-debugging`
skill) catch the perceptual "a few px / repro only in the real editor" bugs:

| Layer | Runner | Command | What it covers |
|---|---|---|---|
| **Golden screenshots** | Playwright (`@visual` tag) | `npm run test:visual` | Element-scoped pixel baselines (`media-src/e2e/visual.spec.ts`); a local pre-flight, excluded from `test:e2e` (`--grep-invert @visual`) because goldens only hold in a consistent environment |
| **Real-vscode** | `vscode-test-playwright` | `npm run test:vscode:fast` (routine) / `npm run test:vscode` (all) | Geometry/computed-styles in a real VS Code webview (`test/vscode-e2e/`); the harness↔real parity smoke for VS-Code-default-CSS / custom-editor-pipeline bugs. **Three tiers — see below** |
| **Diagram pixels** | `vscode-test-playwright` (`@visual`) | `npm run test:vscode:visual` | Per-engine pixel goldens + edit-pane↔Preview pixel equality for the 8 reusable diagram engines (`diagram-visual.spec.ts`); the paint-a-copy path the harness cannot reproduce. Opt-in (`VMARKD_VISUAL=1`), out of the nightly gate — see task 375 |

Two more tags exist purely to keep non-regression-test specs out of the default `test/vscode-e2e`
run (each is a full VS Code boot per `test()`, task 448, so they are not free to leave in):

| Tag | Command | What it covers |
|---|---|---|
| `*spike*` (filename glob) | `npm --prefix test/vscode-e2e run test:spikes` (`VMARKD_SPIKES=1`) | Investigative/feasibility specs — excluded via `testIgnore` (audit 185/1c) |
| `@probe` (title tag) | `npm --prefix test/vscode-e2e run test:probes` (`VMARKD_PROBES=1`) | ~32 tests whose own headers say they assert nothing — pure measurements/throwaway probes (task 449). A TAG, not a filename glob, because some real regression nets have "probe" in their name (`undo-dirty-probe.spec.ts`, `caret-on-open.spec.ts` — the fix verification, not its `-probe` sibling) — see `playwright.config.ts`'s `grepExcludePatterns` for how `@visual`/`@probe` compose into one `grepInvert` regex without silently un-excluding one when the other's env var flips |

For interactive measure-and-screenshot debugging on the harnesses, `playwright-cli`
(`npm run harness:serve` + `npm run pw:cli`). All three are documented in the skill.

### Real-VS-Code tiers — which one, when

The boot is **per `test()`, not per spec file** (task 448): `vscode-test-playwright`'s
`electronApp` fixture (`test/vscode-e2e/node_modules/vscode-test-playwright/dist/index.js`) is
declared `{ timeout: 0 }` with no `scope: 'worker'`, so it launches and `.close()`s a fresh VS Code
for every `test()` — only `_vscodeInstall` / `_createTempDir` are worker-scoped. A spec with N
`test()` blocks therefore costs N boots; splitting or merging tests moves the wall clock directly.
The full run is **on the order of an hour to two** — grew well past the "~40 minutes / 164 tests"
this table used to say, an estimate that came from counting spec FILES, not `test()` blocks. Running
it after every edit is not viable. The exact test count is NOT pinned here on purpose: it moves with
every merge (task 450 collapsed 37 tests into 7 across 3 files) and every new spec another agent
adds — run `npx playwright test --list` (from `test/vscode-e2e`) for today's number rather than
trusting a figure written on a specific date; `VMARKD_PROBES=1` adds back the non-asserting probes
task 449 excluded by default (`npx playwright test --list` with and without the flag shows the
delta). The `~1-2h` range is a derivation, not a measurement (nobody should run the full suite just
to time it): the FAST tier's own measured per-test rate (13–29 s, see below — it swings almost 2×
with machine load) times the current full-suite count, plus the full suite's ~16 min of static
sleeps concentrated in specs FAST doesn't run (diagram parity / mode-switch — task 451) plus
PlantUML/D2 engine renders FAST never touches. The visual parity matrix (`parity-matrix.spec.ts`, task 532) is 1 boot in the fast tier and 10 boots
(~6.4 min measured on 2026-10-08 at load average ~20; 24-51 s per configuration) in the full tier,
which is what the nightly/tag workflow runs (no separate wiring). `diagram-overlay-height`,
`prerender-open-mode` (3 boots) and `list-loose` (2 boots) were costed at ~21 s, ~44 s and ~32 s;
only `list-loose` is in the fast tier. Pick a tier:

| Tier | Command | Size | When |
|---|---|---|---|
| **smoke** | `npm run test:vscode:smoke` | 10 tests, **~2 min** | The PR gate (`pr-webview-smoke.yml`). Boot/layout parity, every renderer draws, and the change-stability core: save-to-disk fidelity, undo-to-disk, split editing, scroll preservation, clipboard, upload |
| **fast** | `npm run test:vscode:fast` | ~39 tests, **8.5–16 min** | **The routine tier — use this while working.** Includes 1 boot of the visual parity gate and `list-loose` (task 532). smoke + document sync, mode switching with observers attached, and the whitespace-fidelity nets. Grew from ~20 tests (33 measured 12.8–15.8 min on 2026-07-27) to ~39 (measured 8.5 min on 2026-07-30, a less-contended run) — both numbers are real, keep growing and budget accordingly, it is no longer an after-every-edit run |
| **full** | `npm run test:vscode` | count moves — `npx playwright test --list`, **~1–2 h** | Before handing work over, and in the nightly/tag gate. Diagram engines, themes, parity matrices — **not** perf probes, task 449 moved those behind `@probe` / `npm --prefix test/vscode-e2e run test:probes` (excluded from every tier including full, by default) |

**Only ONE real-VS-Code run at a time — the tiers refuse to start a second one.** Every script in
`test/vscode-e2e/package.json` goes through `scripts/e2e-lock.mjs`, which takes a PID lock
(`tmp/vscode-e2e.lock`) and **fails loudly and immediately** if a run is already going, rather than
queueing behind it (a silent hour-long wait is indistinguishable from a hang). A lock left by a
killed process is detected as stale via `process.kill(pid, 0)` and cleared, so nothing wedges.

This is not fussiness — two concurrent runs were measured corrupting each other on 2026-07-31, and
**directory isolation would not have been enough**, because two independent mechanisms break:

1. **Shared render cache.** `diagram-cache-host.ts` backs the diagram cache with
   `context.globalStorageUri`, and the suite reuses ONE worker-scoped globalStorage across every
   test. Two runs on `.vscode-test/worker-0` share it, so `plantuml-cache`,
   `diagram-cache-mermaid` and `abc-flip-cache-hit` assert against a cache the other run populated.
2. **CPU contention.** Several specs assert *relative* timings — `plantuml-phase-timing` compares
   cold vs engine-warm vs cache-hit on one fixture. No amount of per-run directory isolation makes
   that meaningful while a second VS Code fights for the machine.

Mechanism 2 is why this is a lock and not an isolation scheme: two timing-sensitive suites cannot
coexist on one box, so the fix is to not try. Note `playwright.config.ts` already sets `workers: 1`
/ `fullyParallel: false`, so there is no *intra*-run parallelism — the only hazard was a second
invocation.

Cheapest possible real-VS-Code test measured ~5 s (boot + open + one assert, `webview.spec.ts`); the
chromium harness (`media-src/e2e`) runs a comparable test in ~1 s — call it an order of magnitude
per test, more for heavier assertions. **Re-measuring these numbers:** `npx playwright test --list`
(from `test/vscode-e2e`) for the current test/file count, optionally with `--reporter=json` to get
machine-readable output (each entry's file/line, useful for verifying tier membership); the same
flag on an actual run (`playwright test --reporter=json`) records each test's `results[].duration`
and `results[].workerIndex`, which is how the "one VS Code per test()" claim above was confirmed
empirically (all tests reporting `workerIndex: 0` under `workers: 1`, and wall clock scaling with
test count, not file count).

Whichever tier you pick, **also run the spec(s) for the surface you actually touched** — the tiers
are a safety net against collateral damage, not a substitute for testing your own change:

```bash
xvfb-run -a npm --prefix test/vscode-e2e test -- <your>.spec.ts   # one spec, ~15-60 s
```

The two membership lists live in `test/vscode-e2e/playwright.config.ts` (`SMOKE_SPECS` /
`FAST_SPECS`) with the reasoning next to them; the tier is selected by `VMARKD_SMOKE` /
`VMARKD_FAST`. Leaving both unset runs everything — the nightly gate depends on that, so never make
a tier the default.

### Visual parity gate (task 532, ADR-0009)

The same document is drawn by five stages (instant-paint overlay, IR, WYSIWYG, full Preview, split
pane). `test/parity/` is THE net for "does it look the same on every stage": it snapshots every
element kind (computed style, block rects, decoration markers, DOM shape) in each stage and compares
the stages pairwise, per theme configuration, never across configurations. Two layers share the
capture sequence, comparator and allow-list: `media-src/e2e/parity.spec.ts` (chromium harness, whole
matrix, in the CI gate) and `test/vscode-e2e/parity-matrix.spec.ts` (real VS Code: fast tier = 1
boot, `auto` under Default Dark Modern; full tier and nightly = the whole 10-configuration matrix,
one boot each, see `test/parity/configs.ts`). Anything not intended must be listed in
`test/parity/allowed-differences.json`.

**Allow-list workflow.** Entries are value-pinned (`delta` / `values`) and carry a `reason` and
`task`; an intended-by-the-user difference is tagged `accepted (user, YYYY-MM-DD)` in the reason. An
entry that no longer suppresses anything is stale and FAILS the run, so the list only shrinks. To
(re)pin after an intended change, judge against an empty list on both layers, then pin the union:

```bash
VMARKD_PARITY_ALLOW=none VMARKD_PARITY_REPORT=tmp/532/red.json xvfb-run -a npm --prefix media-src run test:e2e -- parity.spec.ts
VMARKD_PARITY_ALLOW=none VMARKD_PARITY_REPORT=tmp/532/red-vs.json xvfb-run -a npm --prefix test/vscode-e2e test -- parity-matrix.spec.ts
node scripts/pin-parity-allowlist.mjs tmp/532/red.json tmp/532/red-vs.json   # exits 1 on a stale entry
```

`VMARKD_PARITY_ALLOW=none` is also the RED proof for a new gate rule. Never widen a pin to make a
run green without asking: a new difference is a bug until the user accepts it.

**New content theme.** Register it in `CONTENT_THEMES` (it joins the matrix automatically), and in
its CSS file declare the whole `--vmarkd-geo-*` token set (or `@profile: default`) plus
`--vmarkd-link`, on the body class only, never naming a surface. `test/backend/parity-geometry-lint.test.ts`
enforces all three. Then run the harness gate and pin or fix what it reports.

**New element kind.** Add a row to `test/parity/elements.ts` (snippet plus probe), run
`node scripts/gen-parity-fixture.mjs` to regenerate `test/vscode-e2e/fixtures/parity-canon.md`
(`test/backend/parity-registry.test.ts` fails if it is stale), then run the gate and resolve every
reported difference (fix, or allow-list with a reason).

### Running tests headless (xvfb)

Always use `xvfb-run` for e2e and VS Code tests so they run headless (no GUI
windows popping up). This is required on WSL and CI environments without a display:

```bash
# Playwright e2e (harness-based)
xvfb-run -a npm --prefix media-src run test:e2e

# Real VS Code webview tests
xvfb-run -a npm run test:vscode

# Golden screenshots (update baselines)
xvfb-run -a npm --prefix media-src run test:visual:update

# Diagram pixel goldens in the real webview (opt-in; add -- --update-snapshots to regenerate)
xvfb-run -a npm run test:vscode:visual
```

`-a` auto-picks a free display number. On WSLg with `DISPLAY=:0` already set,
`xvfb-run` is still preferred (avoids fighting the existing X server). If
`xvfb-run` fails with "Xvfb failed to start", kill stale Xvfb processes first:
`pkill Xvfb; sleep 1`.

> **Every new piece of functionality must ship with both layers** — a unit test
> for the host/pure-logic side and an e2e test for the webview behaviour — and you
> must **verify the new code is exercised** in the coverage report (see below). A
> feature is not done until its tests pass and cover the new behaviour.
>
> **Where the new code lives decides the layer.** Pure / host logic → unit
> (vitest). DOM- or Vditor-dependent code → e2e (Playwright). To keep webview code
> e2e-testable, put real logic in a **small importable module** (e.g.
> `media-src/src/outline.ts`) and keep `main.ts` a thin wiring entry — `main.ts`
> is excluded from coverage and is not loaded by any test.

---

## Unit tests (vitest)

Run from the **repo root**:

```bash
npm test                # run once
npm run test:watch      # watch mode
npm run test:coverage   # with coverage (v8) -> coverage/  (text + html)
```

Config: `test/vitest.config.ts`. It aliases the bare `vscode` import to an
in-memory mock so `src/extension.ts` can be tested without an Extension Host:

```ts
resolve: { alias: { vscode: '.../test/backend/vscode-mock.ts' } }
```

- **`test/backend/vscode-mock.ts`** — mock of the `vscode` API surface the
  provider touches (`Uri`/`Range`/`WorkspaceEdit`, `window`/`workspace`/`commands`,
  events, file watcher, webview panel), plus a `mock` control surface to drive
  events and inspect calls. **Extend this file** (don't rewrite it) when a test
  needs API the provider newly uses.
- The migrated `media-src/src/*.test.ts` files are pure-logic unit tests
  (debounce, deep-merge, format-timestamp) and run under the same vitest config.

Coverage HTML report: open `coverage/index.html`.

### Adding a backend test

1. Import what you need from `../../src/extension` (the provider class is
   exported) and `./vscode-mock`.
2. `mock.reset()` in `beforeEach`.
3. Build fixtures with `mock.createExtensionContext()`,
   `mock.createTextDocument(path, text)`, `mock.createWebviewPanel()`.
4. Drive the webview message protocol with `panel._receiveMessage({...})` and
   assert via `mock.calls.*` (postMessage, appliedEdits, executeCommand, …).
5. If the provider calls vscode API the mock lacks, add it to `vscode-mock.ts`.

---

## E2e tests (Playwright)

Run from `media-src/`:

```bash
npm --prefix media-src run test:e2e            # run (no coverage)
npm --prefix media-src run test:e2e:coverage   # run + collect coverage
```

A local server (`e2e/serve.mjs`) bundles the harnesses in-memory with esbuild
(inline source maps) and serves Vditor assets; Playwright starts/stops it.

### Harnesses

Each harness is an esbuild entry in `serve.mjs` with its own HTML page; a spec
drives it. Two kinds: **real-Vditor** harnesses (instantiate Vditor, wire the
feature in `after()`, expose globals) and the **behaviours** harness (helpers
only, no Vditor).

- **`e2e/harness.ts` (`/index.html`)** — real Vditor (IR) with a table. Used by
  `table-hotkey.spec.ts` (table editing: hotkeys + panel).
- **`e2e/outline-harness.ts` (`/outline.html`)** — real Vditor (IR) with headings
  and the outline panel + `setupOutlineFlash`. Used by `outline.spec.ts` (outline
  render/position, click-to-flash, heading-highlight CSS). A good template for a
  new feature that needs a real editor.
- **`e2e/behaviors-harness.ts` (`/behaviors.html`)** — exposes the webview
  helpers as globals, **no full Vditor**. Used by `webview-behaviors.spec.ts`
  (message contract + DOM utils).
- **`e2e/bench-harness.ts` (`/bench.html`)** — init-perf benchmark (`init-bench.spec.ts`,
  opt-in via `BENCH=1`). **Excluded from coverage** (a measurement, not a behaviour test).

### The `window.vscode` stub

In a real webview, `acquireVsCodeApi()` is injected by VS Code. In the browser
harness it does not exist, so message-posting code would crash. The behaviour
spec installs a recording stub **before the bundle runs**:

```ts
await page.addInitScript(() => {
  window.__posted = []
  window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), getState(){}, setState(){} })
})
```

`utils.ts` picks it up via `acquireVsCodeApi()`, and tests assert against
`window.__posted`. This mirrors the host side covered by the backend tests, so
together they verify both ends of the same message contract.

### Adding an e2e test

- Helper that posts a message or mutates the DOM → use the **behaviours** harness:
  set a minimal DOM fixture in `page.evaluate`, call the helper via
  `window.__utils` / `window.__createToolbar`, assert `window.__posted` or the
  DOM.
- Behaviour that needs a **real editor** → reuse `harness.ts` (table) or
  `outline-harness.ts` (headings/outline), or add a **new harness** for a distinct
  feature. To add one:
  1. `e2e/<feature>-harness.ts` — `new Vditor(...)`, wire the feature, expose
     globals + `window.__ready = true` in `after()`.
  2. `e2e/<feature>.html` — load `/vditor/dist/index.css`, `/main.css`, and
     `/<feature>.js`.
  3. `serve.mjs` — add the entry to `entryPoints`, read the html, add a route.
  4. **`coverage-options.ts` — add the bundle name to the `entryFilter` regex**,
     or its coverage is silently dropped (this is easy to miss).
- Always import `test`/`expect` from **`./coverage-fixture`** (not
  `@playwright/test`) so V8 coverage is collected.
- Hidden elements (e.g. `.vditor-panel` is `display:none`): dispatch a synthetic
  bubbling event in-page instead of a Playwright actionable `.click()`.

After writing the test, run `npm --prefix media-src run test:e2e:coverage` and
confirm your new source file appears in the report with real coverage.

---

## E2e coverage (opt-in)

E2e coverage is **off by default** (so the normal run stays fast and unchanged)
and gated behind `E2E_COVERAGE`:

```bash
npm --prefix media-src run test:e2e:coverage
# -> media-src/coverage/e2e/index.html   (open in a browser)
```

How it works (`monocart-coverage-reports`):

- `coverage-fixture.ts` — auto fixture; `page.coverage.start/stopJSCoverage`
  per test (chromium V8), feeds entries to monocart.
- `coverage-setup.ts` / `coverage-teardown.ts` — Playwright global setup/teardown
  clean the cache and generate the final report.
- `coverage-options.ts` — shared config: the `entryFilter` is now **derived from
  the harness registry** (`harness-entries.mjs`), so it can't drift from the served
  bundles — **add a new harness to `harness-entries.mjs`, not here** (that single
  list also drives `serve.mjs`'s esbuild entryPoints + HTML routes). It drops vditor
  scripts + the `bench` benchmark; the `sourceFilter` keeps sources under
  `media-src/src/**`. V8 coverage maps back to the original TypeScript via the inline
  source map esbuild embeds. A meta-test (`test/backend/harness-registry.test.ts`)
  asserts every coverage-counted bundle is matched (task 150 item 2).

All four `coverage-*.ts` files are no-ops unless `E2E_COVERAGE` is set.

**Unit coverage is gated** (task 150 item 3): `test/vitest.config.ts` sets
non-regression `thresholds`, and CI runs `npm run test:coverage` so a coverage drop
fails the build. Raise the thresholds as coverage grows; never lower them to go green.

---

## CI

Four GitHub Actions workflows (`.github/workflows/`):

- **`ci.yml`** — the gate, on every PR and push to `main`. Installs root +
  `media-src`, then in order: `npm audit --audit-level=moderate` (both trees) →
  `npm run lint:ci` (Biome, whole tree) → `node build.mjs` (compiles the host with
  `tsc` + bundles the webview) → `npm run test:coverage` (unit + the coverage
  threshold gate) → `npm --prefix media-src run test:e2e` (Playwright chromium,
  browser binaries cached — the e2e suite includes the per-renderer **render gate**
  in `custom-diagrams.spec.ts`). **E2e now runs in CI** — keep it green locally.
- **`nightly.yml`** ("Nightly (real-VS-Code render gate)", task 150 item 1b) — the
  full **real-VS-Code** suite (`test/vscode-e2e/`, incl. `d2-elk` +
  `custom-diagrams-render`) under xvfb, on a nightly schedule + `workflow_dispatch` +
  any `v*` tag. Catches webview-only classes the harness can't (e.g. ELK's
  worker-rejection → silent dagre fallback). Downloads VS Code (pinned via
  `VMARKD_VSCODE_VERSION`, cached). Treat a red nightly as **release-blocking**.
- **`release.yml`** ("Release") — the one-click cut button: a manual *Run workflow*
  with a `patch` / `minor` / `major` choice. Bumps `package.json` + lock, commits and
  tags `vX.Y.Z` on `main`, then calls `publish.yml`. Use this for 1.0.1 onward.
- **`publish.yml`** ("Publish") — the actual build + ship, on `v*` tags, a manual run
  (pick a tag), or a `workflow_call` from `release.yml`. Builds, tests, packages the
  `.vsix`, **creates a GitHub Release with the `.vsix`**, then publishes to the VS
  Marketplace (`VSCE_PAT` / `VS_MARKETPLACE_TOKEN`) and Open VSX (`OPEN_VSX_TOKEN`) —
  each only if its token secret is set. See [Releasing](#releasing).

`ci.yml` enforces lint + audit on the whole tree, so run `npm run lint:ci` and a
clean `npm audit` locally before pushing — pre-existing drift in untouched files
still fails the gate.

---

## Releasing

Publisher `spiochacz`; Marketplace id `spiochacz.vmarkd`. Releases are **CI-driven**:
`publish.yml` builds, runs the unit tests, packages the `.vsix`, and **creates a
GitHub Release with the `.vsix` attached**. It then publishes to a registry — each
only if its token is set as a repo secret:

- `VSCE_PAT` (or `VS_MARKETPLACE_TOKEN`) — VS Marketplace. Azure DevOps PAT, scope
  *Marketplace → Manage*.
- `OPEN_VSX_TOKEN` — Open VSX.

With no token the run still produces the GitHub Release — so you can ship the `.vsix`
first, add a token later, and **re-run** publishing for that tag (Actions → **Publish**
→ *Run workflow* → enter the tag) to push it to a registry. The release step is
idempotent (create-or-update), so re-runs are safe.

**Before you tag (release checklist):**

- The latest **`nightly.yml`** run is green (the real-VS-Code render gate — pushing a
  `v*` tag also triggers it; don't publish over a red one).
- `npm run test:coverage` is green locally (the threshold gate) and you've eyeballed
  the **e2e coverage** report (`npm --prefix media-src run test:e2e:coverage` →
  `media-src/coverage/e2e/index.html`) — e2e coverage is intentionally **out of the
  CI gate**, so this is the manual check that keeps it honest (task 150 item 3).
- `CHANGELOG.md`'s top heading is set to the version you're shipping.

**Routine releases (1.0.1+) — one click, no local steps:** Actions → **Release** →
*Run workflow* → pick `patch` / `minor` / `major`. It bumps the version, commits and
tags on `main`, then runs `publish.yml` for that tag. Edit `CHANGELOG.md`'s top
heading to the version you're shipping (and push it) **before** clicking.

**The first release / tagging from local** still works too — `publish.yml` fires on
any pushed `v*` tag:

```bash
# version already set in package.json (e.g. the initial 1.0.0)
npm run pub           # tag current version + push  (CI does build/release/publish)
```

`npm run pub` (= `scripts/release-marketplace.sh`) only tags the current
`package.json` version and pushes — CI owns the build, GitHub Release, and
publishing. To build a local `.vsix` without releasing:
`npx @vscode/vsce package --out vmarkd-<ver>.vsix`, then
`code --install-extension vmarkd-<ver>.vsix`.

---

## Quick reference

```bash
# lint + types
npm run lint:ci                # Biome gate (whole tree)
npm run lint:fix               # apply safe lint + format fixes
npm run typecheck              # webview tsc (no emit)

# unit
npm test
npm run test:coverage          # -> coverage/index.html

# e2e (from media-src, after `node build.mjs`)
npm --prefix media-src run test:e2e
npm --prefix media-src run test:e2e:coverage   # -> media-src/coverage/e2e/index.html

# release (needs VSCE_PAT in .env; from a clean main)
npm run pub                    # version bump -> build -> package -> publish -> push tags
```
