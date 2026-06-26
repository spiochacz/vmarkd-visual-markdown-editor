---
name: vmarkd-testing
description: ALWAYS use whenever the task adds or changes vMarkd functionality and needs tests — picking the test layer (vitest unit / chromium harness e2e / REAL-VS-Code e2e / @visual golden), writing a real-VS-Code webview spec (test/vscode-e2e), booting the compile-only WASM in a vitest vm-context, verifying coverage, or running the lint/typecheck/test gates headless. Covers the MANDATE (every webview/renderer feature MUST ship a real-VS-Code e2e you WRITE and RUN), the exact headless commands (xvfb IS installed), the spec patterns (frame locators, evaluateInVSCode, interaction via defaultPrevented, data: URIs, fixtures), unit/WASM recipes, and the gotchas. Read it BEFORE calling a feature done so you never defer real-webview verification to the user.
---

# vMarkd testing

How to test a vMarkd change properly — which layer, how to write it, how to RUN it headless, how to
prove coverage. The companion doc is `DEVELOPMENT.md` (build layout + all commands); the mandate lives
in `AGENTS.md` (always loaded). This skill is the on-demand HOW.

## ⭐ THE RULE (non-negotiable)

- Every new piece of functionality ships **unit tests AND e2e tests**, and you **verify coverage**
  (run the report, confirm the new lines are exercised). Not done until tests pass + cover the behaviour.
- **Any webview / renderer feature** (anything that renders or behaves in the editor surface — diagrams,
  themes, caret, links, decorations) **MUST ship a real-VS-Code e2e in `test/vscode-e2e/`, and you MUST
  WRITE IT AND RUN IT yourself before calling the work done.** Do NOT defer real-webview verification to
  the user.
- **`xvfb` IS installed** (`/usr/bin/xvfb-run`, DISPLAY=:0) → the real-VS-Code suite runs headless.
  There is no "can't run headless / no display" excuse. If you doubt it, run `which xvfb-run` — do NOT
  trust a memory that says otherwise (environment memories go stale; this one did).

## The four layers (pick by what you're proving)

| layer | command | use for | can't do |
|---|---|---|---|
| **vitest unit** | `npm test` | pure logic + DOM-string output (e.g. `toSVG` markup), WASM marshalling via a vm-context | no real DOM/CSS/webview |
| **chromium harness e2e** (`media-src/e2e`) | `xvfb-run -a npm --prefix media-src run test:e2e` | fast real-browser net: Vditor IR/WYSIWYG, most renderers, caret in an iframe | real-VS-Code-only behaviour (injected CSS, custom-editor pipeline, SVG-anchor routing); d2 is `test.fixme` here (harness DOM lacks `.language-d2`) |
| **real-VS-Code e2e** (`test/vscode-e2e`) | `xvfb-run -a npm --prefix test/vscode-e2e test -- <spec>.spec.ts` | the MANDATE: prove a webview/renderer feature in actual VS Code (resource URIs, CSP, injected CSS, link routing) | slow first run (downloads VS Code ~270 MB, then cached) |
| **@visual golden** | `npm run test:visual` (media-src) | pixel regressions; **local-only, excluded from CI** | not a logic check |

Coverage: `npm run test:coverage`. Lint gate: `npm run lint:ci`. Typecheck: `npm run typecheck`.

## Real-VS-Code e2e — the recipe

`extensionDevelopmentPath: repoRoot` (see `test/vscode-e2e/playwright.config.ts`) → the suite loads
`out/` + `media/`, **NOT** the installed `.vsix`. So **`node build.mjs` FIRST**, every time. Config:
`workers:1`, `retries:2`, `timeout:90s`. VS Code downloads once into `test/vscode-e2e/.vscode-test/`.

```ts
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
// the custom-editor webview is a nested iframe:
const wf = (workbox: import('@playwright/test').Page) =>
  workbox.frameLocator('iframe.webview').frameLocator('iframe[title="vMarkd"], #active-frame')

test('my feature renders in the real VS Code webview', async ({ workbox, evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode, [uri]) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(uri), 'vmarkd.editor')
  }, [FIXTURE] as [string])

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 }) // wait for async render
  await frame.locator('body').evaluate(() => new Promise((r) => setTimeout(r, 4000))) // settle

  // Query the real DOM inside evaluate(); return a plain object and assert outside.
  const info = await frame.locator('body').evaluate(() => {
    const html = [...document.querySelectorAll('.language-d2 svg')].map((s) => s.outerHTML).join('\n')
    return { hasFeature: /something/.test(html) }
  })
  expect(info.hasFeature).toBe(true)
})
```

Patterns that matter:
- **Drive a real fixture**, don't inject markup. Add a block to `test/vscode-e2e/fixtures/all-renderers.md`
  (the canonical all-renderer fixture; §18 = D2) and assert against the rendered output. This also
  documents the feature.
- **Interaction** (clicks, keys): dispatch inside `evaluate` and assert the effect. For "is this link
  intercepted?", dispatch a `MouseEvent('click',{bubbles,cancelable})` on the element and check
  `ev.defaultPrevented` — `fixLinkClick` preventDefaults when it catches an `a[href]` (this is how the
  SVG-`<a>` routing fix was verified without mocking the host).
- **Images**: CSP allows `data:`/`blob:` always, `https:` only with `image.allowRemoteImages` — use
  `data:` URIs in fixtures so they load offline.
- Console errors: attach `page().on('console', …)` and log them; structural asserts beat screenshots here.

## Unit recipes

- **Pure render output** (`d2-render.test.ts`): build a hand-made `Layout`/`D2Graph` literal, call
  `toSVG`/`renderD2Graph(graph, sizer)` with a deterministic `Sizer`, assert on the SVG string
  (`toContain('<tspan')`, regex counts). No browser.
- **Compile-only WASM** (`d2-wasm.test.ts`): boot in a Node `vm` context — read `wasm_exec.js` + the
  `.wasm`, `vm.createContext({…, globalThis: ctx})`, **also set `ctx.global = ctx`** (TinyGo's
  `wasm_exec.js` exports `Go` onto `global`/`window`/`self`, not `globalThis` like stock Go — without it
  the loader throws "cannot export Go"), `new ctx.Go()`, `WebAssembly.instantiate`, `go.run(instance)`,
  then **poll** for the registered global (TinyGo registers it asynchronously under asyncify).
- **D2 visual sanity** (not a test, a tool): `media-src/scripts/d2-render-harness/render.mjs` renders
  `.d2` through dagre/elk/vmarkd to a PNG — bundles the SOURCE `d2-render.ts`, so no rebuild needed; use
  it to eyeball layout/routing (the user steers D2 by eye). Output under `tmp/` (gitignored).

## Coverage

```bash
COLUMNS=2000 npx vitest run --config test/vitest.config.ts --coverage \
  --coverage.include='media-src/src/FILE.ts' --coverage.reporter=text FILE.test.ts
```
Confirm your new line numbers are NOT in the "Uncovered Line #s" ranges (`COLUMNS=2000` stops the table
truncating the list). Whole-file % is dominated by unrelated branches — check YOUR lines, not the %.

## Gates before "done"

1. `npm test` (all green) · 2. `npm run typecheck` (clean) · 3. `npm run lint:ci` (biome whole tree —
**7 pre-existing warnings in `parity.spec.ts` are expected**; anything else is yours). 4. The real-VS-Code
e2e for the feature. Run `npx biome format --write <changed files>` BEFORE lint — biome's
"File content differs from formatting output" is an **error**, not a warning, and fails the gate.

## Gotchas

- **`rtk proxy <cmd>`** for raw `grep`/`vitest`/`sed` output — the rtk hook mangles them otherwise.
- **`node build.mjs` before any e2e** (and after any source change you want the real-VS-Code suite to
  see) — the suite uses `out/`+`media/`, not the `.vsix`.
- First real-VS-Code run is slow (downloads VS Code); subsequent runs are fast (cached in
  `.vscode-test/`). Budget for it; run a single `-- <spec>.spec.ts` while iterating.
- The chromium harness is the fast first net but is **not a substitute** for real-VS-Code on
  webview-only behaviour. Don't claim real-webview coverage from a harness pass.
- Vendored WASM rebuild (when a feature needs new compiled fields): `build-d2-wasm.sh` (TinyGo); set
  `GOCACHE_DIR=<persistent dir>` for fast iterative rebuilds, then update `source.json` sha + `build.mjs`.

## File map

- Unit config + suite: `test/vitest.config.ts`; `media-src/src/*.test.ts`, `test/backend/*.test.ts`.
- Chromium harness: `media-src/e2e/*.spec.ts` (+ `*-harness.ts`); `media-src/playwright.config.ts`.
- Real-VS-Code: `test/vscode-e2e/*.spec.ts`, `test/vscode-e2e/playwright.config.ts`,
  `test/vscode-e2e/fixtures/all-renderers.md`. Reference specs: `custom-diagrams-render.spec.ts`,
  `d2-feature-parity.spec.ts` (full pattern + the link-click `defaultPrevented` check).
- @visual goldens: `media-src/e2e/*` tagged `@visual`.
- Commands: root `package.json` (`test`, `test:coverage`, `test:vscode`, `test:visual`),
  `media-src/package.json` (`test:e2e`, `test:visual`). Details: `DEVELOPMENT.md`.

## Related

Skills: `vmarkd-visual-debugging` (the perceptual layout/CSS/caret debugging loop — overlaps on the
real-VS-Code suite but for *debugging pixels*, not *writing feature tests*). Memories:
`[[e2e-prefer-headless-chrome]]` (xvfb now installed; real-VS-Code runs headless), `[[rtk-proxy-for-raw-output]]`,
`[[biome-ci-checks-whole-tree]]`, `[[e2e-harness-mandatory]]`, `[[scratch-under-repo-tmp]]`.
