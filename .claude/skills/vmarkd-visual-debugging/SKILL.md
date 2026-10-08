---
name: vmarkd-visual-debugging
description: ALWAYS use whenever the task is a LAYOUT / CSS / caret bug in vMarkd — the perceptual "a few px off" / "jumps" / "squished" / "kursor za ```" class where the symptom is visual and the cause is one property buried in a cascade, and many reproduce ONLY in the real VS Code webview (VS Code's injected default CSS, the custom-editor pipeline) not the Playwright harness. Covers the three tools cheapest-first — playwright-cli interactive measure-and-screenshot on the harnesses, @visual golden screenshots (local-only, excluded from CI), and the real-VS-Code webview suite — so you MEASURE instead of guessing. Read it BEFORE chasing a visual/layout regression. For writing/running tests in general (which layer, real-VS-Code e2e, coverage, gates) use vmarkd-testing instead.
---

# vMarkd visual debugging

How to debug LAYOUT / CSS / caret bugs in vMarkd without flying blind. These bugs are the
expensive ones (a few px off, "jumps", "squished", "kursor za ```") because the symptom is
perceptual and the cause is one property buried in a cascade — and many reproduce ONLY in the
real VS Code webview, not the Playwright harness. Three tools, cheapest first.

## 1. playwright-cli — interactive loop on the harnesses (daily driver)

`@playwright/cli` (in `media-src/node_modules/.bin`, also `npm run pw:cli`) drives a PERSISTENT
browser from the shell and writes snapshots/screenshots to `.playwright-cli/` (gitignored) — so
it costs ~0 conversation tokens (read only what you need) and replaces the old "write a throwaway
spec → run → parse logs" loop.

```bash
npm run harness:serve &                 # serves harnesses on :9124 (separate from the :9123 the
                                        # e2e webServer owns — never share the port with a test run)
npm run pw:cli -- open http://localhost:9124/blockbg.html
npm run pw:cli -- eval "() => { const n=[...document.querySelectorAll('.vditor-ir__node')].find(x=>x.querySelector('code.language-js')); return { nodeH:n.getBoundingClientRect().height, previewH:n.querySelector('.vditor-ir__preview').getBoundingClientRect().height } }"
npm run pw:cli -- screenshot --filename /tmp/before.png   # then Read the PNG
# try a fix live, re-measure:
npm run pw:cli -- eval "() => { const s=document.createElement('style'); s.textContent='…candidate CSS…'; document.head.appendChild(s) }"
npm run pw:cli -- screenshot --filename /tmp/after.png
npm run pw:cli -- close
```

The harness loads the SOURCE `media/src/main.css` live, so editing main.css + reloading the page
shows the change without a rebuild. The diagnosis pattern that works: **screenshot says WHERE,
`eval`'d geometry/computed-styles say HOW MUCH, CSS knowledge says WHY** — a screenshot alone
mis-measures pixel distances; numbers alone miss where to look.

Gotcha that recurs (see renderer-theming skill): phantom geometry often comes from things with NO
DOM rect — `::before`/`::after` content, h:0 inline-block markers, line-box struts, unitless
`line-height` inheritance. When `getBoundingClientRect` differences don't add up, dump
`getComputedStyle(el, '::before')` and the node's child line boxes, not just the elements.

## 2. Golden screenshots — catch "a few px" before the user does

`media-src/e2e/visual.spec.ts`, tagged `@visual`. Element-scoped goldens of the surfaces whose
bugs were perceptual (collapsed code block, callout). Baselines in `visual.spec.ts-snapshots/`
(committed, `-linux` suffix). Tolerance (`maxDiffPixelRatio: 0.005` in playwright.config) catches
any ≳3 px shift; a height change fails as a dimension mismatch outright.

```bash
npm run test:visual            # run the goldens (local pre-flight)
npm run test:visual:update     # regenerate AFTER a deliberate visual change — then eyeball the PNGs
```

EXCLUDED from CI / `test:e2e` (`--grep-invert @visual`): goldens only hold in a consistent
environment, and the ubuntu-latest runner's fonts may differ from the dev machine. They are a
LOCAL net — run them before declaring a visual change done. The numeric layout guards
(blockbg/codenav/width specs) are what gate CI. Add a golden only when a NEW visual bug class
appears; keep it element-scoped (full-page shots multiply font drift).

## 3. real-vscode suite — the harness↔real gap (when "repro only in the editor")

`test/vscode-e2e/` (`vscode-test-playwright`). Launches a real VS Code
(downloaded to `.vscode-test/`, gitignored), loads the built extension, opens a fixture in the
`vmarkd.editor` custom editor, and reaches the double-nested webview iframe
(`iframe.webview` → `#active-frame`) to measure the REAL render — with VS Code's injected default
CSS and the real custom-editor pipeline. This is where the "only reproduces in the real editor"
class (VS Code default CSS leak, focus/blur, prerender→live swap) is finally observable by me
instead of only by the user.

- **Run YOUR spec, not the suite.** The whole thing is on the order of an hour to two — the boot is
  per `test()`, not per spec (task 448: `vscode-test-playwright`'s `electronApp` fixture has no
  `scope: 'worker'`), and the test count (moves with every merge/new spec — `npx playwright test
  --list` for today's number, don't trust a figure written on a specific date) adds up. Routine
  work:
  `xvfb-run -a npm --prefix test/vscode-e2e test -- <your>.spec.ts` plus
  `npm run test:vscode:fast` (~39 tests, ~8-16 min — grows over time, re-check with
  `npx playwright test --list`). Keep the full `npm run test:vscode` for handing
  work over. Tiers + their membership: `test/vscode-e2e/playwright.config.ts`, DEVELOPMENT.md.
- One-time setup: `npm --prefix test/vscode-e2e install` (its deps are a SEPARATE, gitignored
  node_modules — see the version-pin note below for why they're isolated from the root manifest).
- Requires a prior `node build.mjs` (it loads `out/` + `media/dist/`). Needs a display: WSLg
  (`DISPLAY=:0`) works; CI/headless would need `xvfb-run`. Open the editor only AFTER
  `extensions.getExtension('spiochacz.vmarkd').activate()` — `openWith` before activation races
  the custom-editor provider registration and the webview stalls.
- Geometry / computed-style assertions by default — goldens ONLY behind the `@visual` tag, skipped
  unless `VMARKD_VISUAL=1` (linux-electron fonts differ; the nightly gate must not go red on a
  runner with different fonts). It's a PARITY smoke; the harness specs remain the primary regression
  net (they're the ones proven to fail when a fix is reverted). `retries: 2` absorbs WSLg cold-boot
  stalls.
- **Diagram pixels — `npm run test:vscode:visual`** (`diagram-visual.spec.ts`, task 375). The one
  surface that needs pixels HERE and not in the harness: both the 373 (arrowheads) and 374 (black
  mermaid) regressions lived in the paint-a-copy path, which the harness has no cross-pane reuse to
  reproduce. Per engine it asserts (a) the Preview render is pixel-equal to the edit-pane render it
  was copied FROM — no baseline, so font-drift-immune and valid anywhere — and (b) a committed
  golden, which catches both panes breaking identically. The comparison tolerates a ONE-PIXEL
  displacement: the two panes place the same SVG at a different sub-pixel phase (measured: 0.9–1.3%
  of pixels differ with a strict diff, all of it edge outlines), and absorbing that is what keeps
  the threshold at a useful 0.5%. Regenerate with `-- --update-snapshots` and LOOK at every changed
  PNG — a baseline refreshed on autopilot bakes in a broken render.
- **Version pin + isolation:** the suite's deps live in their OWN `test/vscode-e2e/package.json`
  (not the root manifest) so the beta tooling's dev-only advisory never reaches the shipped
  extension's `npm audit` gate. `@playwright/test` is pinned EXACTLY to `1.52.0` there because
  `vscode-test-playwright@0.0.1-beta2` calls a Playwright internal (`playwright._toImpl`) that
  newer releases drop (`TypeError: playwright._toImpl is not a function`) — and 1.52 carries a
  high-severity browser-download SSL advisory, which is why it's quarantined in the nested,
  not-in-CI package. Do NOT bump it / do NOT hoist it to root. The media-src e2e Playwright (1.60)
  and `@playwright/cli` are SEPARATE installs and unaffected.

## 4. The parity gate's reports (a stage looks different from another)

For "IR vs Preview vs overlay differ by N px", do not hand-measure first: run the gate with
`VMARKD_PARITY_ALLOW=none VMARKD_PARITY_REPORT=tmp/<x>.json` (harness: `xvfb-run -a npm --prefix
media-src run test:e2e -- parity.spec.ts`; real VS Code: `parity-matrix.spec.ts`). The JSON lists
every difference per theme, stage pair, element kind and property; `scripts/pin-parity-allowlist.mjs`
re-pins the allow-list from those reports (see DEVELOPMENT.md, "Visual parity gate"). Then drill into
the one element with playwright-cli.

## When to reach for which

- Tweaking CSS / diagnosing a harness-reproducible layout bug → **playwright-cli** (interactive).
- About to land a visual change → run **golden screenshots** first; update + eyeball if intended.
- User says "only in the real editor", or the bug touches VS Code default CSS / focus / the
  custom-editor pipeline → **real-vscode suite**, and still verify the final fix WITH THE USER
  (caret/scroll-class bugs especially).
- Always: a NEW numeric guard in the harness spec (blockbg/codenav/width/…) is the durable net —
  the goldens and real-vscode suite are aids, not replacements.
