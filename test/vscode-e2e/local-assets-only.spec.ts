import { wf } from './webview-helpers'
// Task 39 step 2 — the standing proof that opening a document fetches NOTHING remote.
//
// Why this is a real-VS-Code spec and not a harness one: the claim is about the custom-editor
// RESOURCE pipeline (`asWebviewUri` → `https://file+.vscode-resource.vscode-cdn.net/…`) and the
// CSP the host builds, neither of which the chromium harness reproduces. It is also the one
// assertion in task 39 that stays valuable over time: Vditor derives most of its asset paths from
// `Constants.CDN` (= `https://unpkg.com/vditor@<version>`) and only rewrites them to ours when
// `options.cdn` is set (vditor/src/ts/util/Options.ts `merge()`), so a single dropped `cdn`
// argument silently turns a local asset into a remote fetch — invisible in the UI (the CSP blocks
// it, the renderer just never appears) and impossible to notice offline until a user reports it.
//
// The fixture is all-renderers.md deliberately: every engine renders, so every lazily-loaded
// renderer script/style is pulled during the run and shows up in Resource Timing.
//
// Both halves were confirmed to bind, by dropping `cdn` from the host's init payloads (2026-07-28):
// the CONFIG-PATH check fires first (`cdn=https://unpkg.com/vditor@3.11.3`), and the Resource-Timing
// check is NOT tautological either — CSP-blocked remote requests still produce entries
// (`remote=8, local=1, renderer=0` in that run), so a leaked remote asset is visible here.
//
// Not in SMOKE/FAST (full-suite only, ~15 s) — and it must NOT be renamed to anything containing
// "spike", or playwright.config.ts's `testIgnore` would silently drop it from the release gate.
//
// Scope note: geojson/topojson basemap TILES are the one legitimate remote fetch in the webview,
// and they are gated behind `vmarkd.image.allowRemote` (default false, task 99) — so with
// default settings, as here, "zero remote entries" is the correct expectation.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const ALL = path.join(__dirname, 'fixtures', 'all-renderers.md')

test('opening a document loads every asset locally — no unpkg, no MathJax, no remote host (task 39 step 2)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [ALL] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  // Give the lazy renderers time to actually have run (mermaid is the slowest of the always-on
  // ones) — a remote fetch that only happens late would otherwise escape the sample. Deliberately
  // NON-fatal: when the asset base regresses, nothing renders at all, and failing here would
  // reduce this spec to a 90 s timeout on a locator instead of the readable probe assertions
  // below (`rendererAssets` covers "the renderers really ran", with a message that says so).
  await frame
    .locator('.vditor-ir .language-mermaid svg')
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => {
      /* deliberately non-fatal — see comment above */
    })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 8000)))

  const probe = await frame.locator('body').evaluate(() => {
    const opts = (window as any).vditor?.vditor?.options ?? {}
    const cdn: string = opts.cdn ?? ''
    let cdnOrigin = ''
    try {
      cdnOrigin = new URL(cdn).origin
    } catch {
      /* cdn empty/relative — reported as-is below, the assertion catches it */
    }
    const names = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => !n.startsWith('blob:') && !n.startsWith('data:'))
    const isLocal = (n: string) => {
      try {
        const o = new URL(n).origin
        return o === location.origin || (!!cdnOrigin && o === cdnOrigin)
      } catch {
        // A relative/opaque name resolves against the frame itself — local by definition.
        return true
      }
    }
    return {
      cdn,
      remote: names.filter((n) => !isLocal(n)),
      mathjax: names.filter((n) => /mathjax/i.test(n)),
      localCount: names.filter(isLocal).length,
      // Sanity anchors: these prove the sample is not vacuous (the renderers really did fetch).
      rendererAssets: names.filter((n) =>
        /(katex|mermaid|echarts|abcjs|viz|graphviz|d2-main)/i.test(n),
      ).length,
      // The two paths Vditor derives from `Constants.CDN` unless `options.cdn` overrides them.
      emojiPath: opts.hint?.emojiPath ?? '',
      contentThemePath: opts.preview?.theme?.path ?? '',
    }
  })

  // Printed so a run leaves the actual sample size behind (a shrinking `localCount`/
  // `rendererAssets` is how this net would rot into passing vacuously).
  console.log(
    `[task 39] cdn=${probe.cdn} local=${probe.localCount} renderer=${probe.rendererAssets} remote=${probe.remote.length}`,
  )
  expect(probe.cdn, 'the webview got a local asWebviewUri asset base').toMatch(
    /^https?:\/\//,
  )
  expect(probe.cdn, 'the asset base is NOT the unpkg default').not.toContain(
    'unpkg.com',
  )
  expect(
    probe.remote,
    'no asset may be fetched from a remote origin on open',
  ).toEqual([])
  expect(
    probe.mathjax,
    'MathJax (~6.5 MB) is never fetched — Vditor defaults to KaTeX and build.mjs drops the asset (task 40)',
  ).toEqual([])
  expect(
    probe.localCount,
    'sanity: the local-origin sample is non-empty',
  ).toBeGreaterThan(5)
  expect(
    probe.rendererAssets,
    'sanity: the lazy renderer assets really were fetched (else "no remote" is vacuous)',
  ).toBeGreaterThan(0)
  expect(
    probe.emojiPath,
    'hint.emojiPath is re-derived from our cdn, not unpkg',
  ).not.toContain('unpkg.com')
  expect(
    probe.contentThemePath,
    'preview.theme.path is re-derived from our cdn, not unpkg',
  ).not.toContain('unpkg.com')
})
