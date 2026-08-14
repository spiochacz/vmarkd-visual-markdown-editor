---
name: vmarkd-testing
description: ALWAYS use for vMarkd tests — BOTH writing them AND debugging them, and for the RED-GREEN-RED discipline every test change owes (see it fail, fix, break the fix and see it fail the same way, restore). Writing: picking the test layer (vitest unit / chromium harness e2e / REAL-VS-Code e2e / @visual golden), writing a real-VS-Code webview spec (test/vscode-e2e), booting the compile-only WASM in a vitest vm-context, verifying coverage, running the lint/typecheck/test gates headless. DEBUGGING (use it here too, before touching the spec): any FLAKY, intermittent or order-dependent test, a spec that passes alone but fails in the full suite, a suite failure you are about to explain as "a race" or "a timing issue", or one you are tempted to fix with a longer sleep/timeout — in this repo that reading was wrong five times out of five; the skill has the replay-the-real-order + bisect method, the cross-spec state leaks that cause it, and the sample sizes a flake claim needs. Also covers the MANDATE (every webview/renderer feature MUST ship a real-VS-Code e2e you WRITE and RUN), the exact headless commands (xvfb IS installed), spec patterns (frame locators, evaluateInVSCode, defaultPrevented, data: URIs, fixtures), unit/WASM recipes, and the gotchas (settle() steals webview focus; theme flips need scrollIntoView). Read it BEFORE calling a feature done, and BEFORE diagnosing a flaky spec.
---

# vMarkd testing

How to test a vMarkd change properly — which layer, how to write it, how to RUN it headless, how to
prove coverage. The companion doc is `DEVELOPMENT.md` (build layout + all commands); the mandate lives
in `AGENTS.md` (always loaded). This skill is the on-demand HOW.

**Debugging an existing test counts as "testing".** If a spec is flaky, order-dependent, or you are
about to describe a failure as a race, jump to
[A spec that passes alone and fails in the full run](#a-spec-that-passes-alone-and-fails-in-the-full-run--do-this-first)
BEFORE editing the spec — that section exists because the intuitive fix (a longer wait) was the wrong
call in every measured case so far.

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
- **RED-GREEN-RED. Always. A green test proves nothing until you have seen it go red.**
  1. **RED** — before the fix, run the test and watch it FAIL, with the symptom you set out to fix.
     A new test that has never failed may be asserting nothing: several in this repo passed against
     a deliberately broken build until the assertion itself was fixed.
  2. **GREEN** — apply the fix, rerun, it passes.
  3. **RED again** — deliberately break the fix (revert the one line, disarm the CSS selector, widen
     the `when` clause), confirm the test fails with the SAME signature, then restore and confirm
     green. This is the step that proves the test is watching the fix and not something incidental.
     Restore EXACTLY: verify with `md5sum`/`git diff`, not by eye — the vendored Vditor source is
     compiled from a gitignored tree, so `git status` can look clean while a patch is still applied.
  Announce a deliberate break before making it, and confirm the revert afterwards. If a fix cannot
  be red-proved, say so explicitly rather than shipping it on a hunch — one caret-focus gate this
  session looked correct, could not be red-proved, measured identical to baseline over 10+10 runs,
  and was reverted. For an INTERMITTENT bug, "red" means a measured failure RATE on both sides, not
  one red run (see the flaky section below).

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

  // Poll for the CONDITION the assertion itself reads, don't add a fixed sleep on top of the
  // waitFor above (task 451 — a blind settle after "the element exists" was how ~16 min of
  // hardcoded sleep spread across the suite; this file is where the pattern started).
  await expect
    .poll(() =>
      frame.locator('body').evaluate(() => {
        const html = [...document.querySelectorAll('.language-d2 svg')].map((s) => s.outerHTML).join('\n')
        return /something/.test(html)
      }),
    )
    .toBe(true)

  // Query the real DOM inside evaluate(); return a plain object and assert outside.
  const info = await frame.locator('body').evaluate(() => {
    const html = [...document.querySelectorAll('.language-d2 svg')].map((s) => s.outerHTML).join('\n')
    return { hasFeature: /something/.test(html) }
  })
  expect(info.hasFeature).toBe(true)
})
```

**A fixed sleep is still correct in three shapes** (task 451) — don't force a poll onto these:
- **Negative assertions** ("nothing re-renders in the next N ms", "no second render fires") — there
  is no condition to poll for. Comment it as a negative-assertion wait so the next reader doesn't
  retry the conversion.
- **Geometry/position quiescence across several engines** (a cross-pane drift or bounding-box
  comparison on a document with many diagrams still settling) — a poll can declare "stable" on a
  transient plateau mid-reflow, which is a **false pass**, worse than a slow test. Leave the sleep,
  comment why (see `wysiwyg-parity.spec.ts`, `mode-switch-parity.spec.ts`).
- **A genuine engine floor with no observable marker** (e.g. a cold PlantUML/D2 compile where the
  DOM gives no signal until the whole render lands) — poll for the render's own marker
  (`.language-d2 svg`, a `data-*` attribute, a specific element) rather than shortening the timeout
  blindly; if truly no marker exists, keep the sleep and say so.

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

## A spec that passes alone and fails in the full run — DO THIS FIRST

The default reading of an intermittent real-VS-Code failure is "a race, add a wait". In this repo
that reading has been **wrong five times out of five** (task 516's triage, 2026-08-13/14). Every one
was a *precondition the spec never pinned*, left in a state by a spec that ran earlier. The suite
shares ONE worker-scoped VS Code profile, and `ConfigurationTarget.Global` writes persist across
tests, so whatever ran before decides your test's configuration.

**The method — replay the real order, then bisect. Do not start with sleeps.**

1. Get the ACTUAL predecessor chain from a full-run log (the suite runs alphabetically, but read the
   log rather than trusting that):

   ```bash
   grep -oE "[0-9]+ [a-z0-9-]+\.spec\.ts" tmp/full-suite.log | uniq   # order as it really ran
   ```

2. Replay ~10 predecessors plus the victim in ONE command (one worker, one profile — that is what
   makes the state carry over):

   ```bash
   cd test/vscode-e2e && xvfb-run -a npx playwright test <pred1>.spec.ts … <pred10>.spec.ts <victim>.spec.ts
   ```

3. Bisect the chain by halves until one pair reproduces. Each step is a normal run, so it is minutes,
   not guesswork.

4. Fix by **pinning what the assertion depends on** in the victim, and resetting it in an `afterEach`
   so the victim does not become the next polluter. `afterEach`, never a `finally` inside the test —
   a RED run must not leave the profile poisoned for everything after it.

5. Red-green-red still applies, using the reproducing ORDER as the red: the pair/chain must fail
   before the pin and pass after it. `<polluter>.spec.ts <victim>.spec.ts` in one command is the
   cheapest red you will get — keep using it as the proof, not a solo run of the victim.

**Single predecessors and stress loops are not a substitute for the chain.** An investigation that
tried individual predecessors, CPU stress (10×`yes`) and forced theme changes measured **0/20** and
reported "not determined"; replaying the real 11-spec chain reproduced it on the **first** attempt,
and a two-step bisect pinned it to one pair.

### What "state" actually means here

| Leak | Bites as | Real example |
|---|---|---|
| `vmarkd.theme.content` (~40 specs set it, most never reset) | a re-theme "race" | `echarts-theme` → `flip-skip`: with an explicit content theme inherited, a workbench flip changes nothing the renderers key off, so the spec's own CONTROL ("the first flip re-renders") fails |
| `vmarkd.theme.code` | flips silently doing nothing | `caret-empty-typing` → `d2-render-sweep`: `resolveCodeStyle` honours an explicit code theme verbatim, so every later content-theme flip is a permanent no-op for token colour |
| `workbench.colorTheme` | an unrelated spec's geometry | `plantuml-theme-flip` → `preview-spacing`: `theme.content: 'auto'` RESOLVES to `vscode-*-2026` under a VS Code default theme, `markdown-body` lands on the body, and the edit surface inherits `line-height: 1.6` instead of Vditor's 1.5 |
| `vmarkd.editor.defaultMode` (defaults to `remember`) | a hung open | `outline-explorer` waited 60 s on a `.vditor-wysiwyg` that a previous spec's Preview overlay had left hidden |
| `process.env` test hooks | an overlay/flag stuck ON for the rest of the worker | `process.env.X = undefined` stores the STRING `"undefined"` — truthy. Use `delete process.env.X` |

Standing gap: task 524 (a shared pin/restore helper). Until it exists, pin per spec.

### When it really is timing

Only after the chain replay comes back clean. Then: poll the actual condition, never `sleep` longer.
And measure both sides — at a ~1-in-10 failure rate, **anything under ~10 repeats per side proves
nothing**. A gate change once looked like it improved 1/2 → 1/10 at `--repeat-each=5`; at
`--repeat-each=10` both sides measured an identical 8/1/1 and the change was reverted.

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

- **`settle(frame, ms)` STEALS DOM focus into the webview** (task 516). It waits by running
  `evaluate` INSIDE the webview iframe, and touching the iframe moves keyboard focus there. Harmless
  when the test types INTO the editor — fatal when the test needs focus somewhere else (a workbench
  editor, the find box, a panel): use page-level `workbox.waitForTimeout()` there instead. This
  inverted a whole diagnosis once: `keybinding-scope-release` settled between key presses, so
  Ctrl+L/Ctrl+H were delivered to the now-focused webview and fired `format.list`/`format.strike`
  exactly as designed — and the resulting `* ~~~~` in the panel was reported as a `when`-clause leak,
  i.e. the product working correctly was scored as the bug. When a spec's outcome depends on WHO has
  focus, assert the precondition (`.editor-group-container.active .monaco-editor.focused` plus
  `activeTextEditor`) BEFORE the keys, so a focus mishap fails as "we never got focus" instead of
  silently becoming the opposite conclusion.
- **A theme-flip spec must scroll its target into view — the failure mode is silent** (task 412/475).
  Task 412's viewport gate (`diagram-retheme.ts`'s `gateAndRender`) defers a diagram's re-render —
  ECharts/mindmap, the mono SVG group (plantuml/graphviz/abc/wavedrom/nomnoml), geo, and D2 — for
  anything more than ~200px outside the window, queuing it on a shared `IntersectionObserver` instead
  of rendering it immediately. A spec that flips the theme and reads a diagram's post-flip state
  WITHOUT scrolling it into view gets the STALE pre-flip render if that diagram sits below the fold —
  nothing errors, no timeout fires, the assertion just reads a value that never updated.
  `all-renderers.md` is long enough that everything past its first couple of sections sits outside a
  ~786px window at document-top, so this bites any flip spec built on it that doesn't scroll. Fix:
  `scrollIntoView({ block: 'center' })` on every target AFTER the flip (before the flip it's too
  early — the gate partitions candidates at flip time). If scrolling MULTIPLE diagram instances, do it
  ONE AT A TIME with a short pause (~100-200ms) between each — a bulk pass of back-to-back
  `scrollIntoView` calls does not give the observer time to fire on the earlier elements before the
  viewport moves past them (measured: a bulk pass got a 12-block D2 fixture's compile counter to only
  4, the per-element loop got it to 14). See `retheme-preview-surface.spec.ts` (the original pattern),
  `echarts-theme.spec.ts`, `d2-content-theme-flip.spec.ts`, `retheme-flip-matrix.spec.ts` for the shape.
- **Test a REALISTIC multi-item document, not just isolated blocks** (learned the hard way, task 136 →
  347). A renderer can pass in isolation yet FLAKE in a doc with several of them: PlantUML's shared
  TeaVM engine carries sticky diagram-TYPE state across renders, so with 4-5 C4/AWS/Azure diagrams in ONE
  doc a *random* block errors "Assumed diagram type: sequence" (the class↔non-class reset doesn't fire
  between non-class icon diagrams). A per-block/per-lib isolated fixture HID it; a 5-block fixture caught
  it. When a feature renders N things, add a fixture with several together.
- **A text-only assertion can FALSE-PASS on a renderer.** PlantUML (and others) render an ERROR as an
  `<svg>` that ECHOES the source text — so `expect(svg.textContent).toMatch(/MyLabel/)` passes even when
  the block *errored*, because the label is in the echoed source. Always ALSO assert "no error render":
  match `/Fatal parsing error|Syntax Error|Assumed diagram type/`, not just `/Fatal/`. Prefer asserting a
  rendered-shape signal (element counts, geometry) over label text alone.
- **Actually render the demo/artifact you hand the user.** A demo shipped with an *unverified* icon name
  (`AzureSQLDatabase` vs the real `AzureSqlDatabase` — case matters) broke its block; a stdlib-path/name
  check + a real render would have caught it. Verify generated example files, don't assume.
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
- Commands: root `package.json` (`test`, `test:coverage`, `test:vscode{,:fast,:smoke,:visual}`, `test:visual`),
  `media-src/package.json` (`test:e2e`, `test:visual`). Details: `DEVELOPMENT.md`.

## Related

Skills: `vmarkd-visual-debugging` (the perceptual layout/CSS/caret debugging loop — overlaps on the
real-VS-Code suite but for *debugging pixels*, not *writing feature tests*). Memories:
`[[e2e-prefer-headless-chrome]]` (xvfb now installed; real-VS-Code runs headless), `[[rtk-proxy-for-raw-output]]`,
`[[biome-ci-checks-whole-tree]]`, `[[e2e-harness-mandatory]]`, `[[scratch-under-repo-tmp]]`.
