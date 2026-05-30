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

## Package manager

**npm only.** Do not reintroduce `yarn.lock` / `pnpm-lock.yaml` or a
`packageManager` field — CI installs with `npm ci`. There are two lockfiles:
`package-lock.json` (root) and `media-src/package-lock.json`.

## First-time setup

```bash
npm ci                       # root deps (extension host + vitest)
npm --prefix media-src ci    # webview deps (esbuild, vditor, playwright, monocart)
npm exec foy build           # compile both + sync Vditor assets into media/vditor
npm --prefix media-src exec -- playwright install chromium   # e2e browser (once)
```

`foy build` is required before e2e: the table harness serves real Vditor assets
from `media/vditor/`. (The unit suite does not need it.)

---

## Test layers

| Layer | Runner | Location | What it covers |
|---|---|---|---|
| **Unit / backend** | vitest | `test/backend/*.test.ts`, `media-src/src/*.test.ts` | Extension host logic + pure webview helpers |
| **E2e** | Playwright (chromium) | `media-src/e2e/*.spec.ts` | Webview behaviour in a real browser with Vditor |

The two are **disjoint** — different runners, different layers, separate coverage
reports. Neither instruments the other.

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

### Two harnesses

- **`e2e/harness.ts` (`/index.html`)** — instantiates a real Vditor in IR mode
  with a table. Used by `table-hotkey.spec.ts` (table editing: hotkeys + panel).
- **`e2e/behaviors-harness.ts` (`/behaviors.html`)** — exposes the webview
  helpers as globals, **no full Vditor**. Used by `webview-behaviors.spec.ts`
  (message contract + DOM utils).

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

- Table / Vditor-rendering behaviour → extend `harness.ts` (expose globals in
  `after()`), add to `table-hotkey.spec.ts` or a new spec.
- Helper that posts a message or mutates the DOM → use the behaviours harness:
  set a minimal DOM fixture in `page.evaluate`, call the helper via
  `window.__utils` / `window.__createToolbar`, assert `window.__posted` or the
  DOM. Import `test`/`expect` from `./coverage-fixture` (not `@playwright/test`)
  so coverage is collected.
- Hidden elements (e.g. `.vditor-panel` is `display:none`): dispatch a synthetic
  bubbling event in-page instead of a Playwright actionable `.click()`.

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
- `coverage-options.ts` — shared config: keeps the `harness`/`behaviors` bundle
  entries, filters sources to `media-src/src/**` (drops vditor/node_modules and
  the harness files). V8 coverage is mapped back to the original TypeScript via
  the inline source map esbuild embeds.

All four `coverage-*.ts` files are no-ops unless `E2E_COVERAGE` is set.

---

## CI

`.github/workflows/main.yml` (manual deploy) runs the full gate:
`npm ci` (root + `media-src`) → `npm exec foy build` → `npm test`.
`publish.yml` (on `v*` tags) installs the same way and publishes.

E2e is not wired into CI yet (needs a browser install step) — run it locally.

---

## Quick reference

```bash
# unit
npm test
npm run test:coverage          # -> coverage/index.html

# e2e (from media-src, after `npm exec foy build`)
npm --prefix media-src run test:e2e
npm --prefix media-src run test:e2e:coverage   # -> media-src/coverage/e2e/index.html
```
