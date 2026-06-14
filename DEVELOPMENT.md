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
`test/backend/vditor-source-patches.test.ts`.

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
| **Real-vscode** | `vscode-test-playwright` | `npm run test:vscode` | Geometry/computed-styles in a real VS Code webview (`test/vscode-e2e/`); the harness↔real parity smoke for VS-Code-default-CSS / custom-editor-pipeline bugs |

For interactive measure-and-screenshot debugging on the harnesses, `playwright-cli`
(`npm run harness:serve` + `npm run pw:cli`). All three are documented in the skill.

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
- `coverage-options.ts` — shared config: the `entryFilter` keeps the behavioural
  bundles (`harness`/`behaviors`/`outline`; **add new harness bundles here**) and
  drops vditor scripts + the `bench` benchmark; the `sourceFilter` keeps sources
  under `media-src/src/**` (drops node_modules and the harness files). V8 coverage
  is mapped back to the original TypeScript via the inline source map esbuild
  embeds.

All four `coverage-*.ts` files are no-ops unless `E2E_COVERAGE` is set.

---

## CI

Three GitHub Actions workflows (`.github/workflows/`):

- **`ci.yml`** — the gate, on every PR and push to `main`. Installs root +
  `media-src`, then in order: `npm audit --audit-level=moderate` (both trees) →
  `npm run lint:ci` (Biome, whole tree) → `node build.mjs` (compiles the host with
  `tsc` + bundles the webview) → `npm test` (unit) → `npm --prefix media-src run
  test:e2e` (Playwright chromium, browser binaries cached). **E2e now runs in CI**
  — keep it green locally.
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
