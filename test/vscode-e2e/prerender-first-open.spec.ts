// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
// Task 432 — PROBE: does the FIRST document opened in a session get an instant-paint teaser at all?
//
// The mechanism under test (read from source, timing never established): `prewarmLute` defers the
// ~250 ms synchronous Lute eval via `setTimeout(…, 0)` (src/lute-host.ts:113-116). If it hasn't landed
// when the first document's HTML is built, `renderForMode` bails on `!lute` (:203-206) and
// `buildPrerenderOverlay` emits nothing (src/html-builder.ts:123-125) — so the masking mechanism would
// be missing on exactly the open it exists for (the cold one, where the webview-side Lute costs ~670 ms
// per task 42).
//
// Why the flag and not a DOM query: `after()` removes `#vmarkd-prerender` within ~150 ms, so by the time
// a spec can look, "never emitted" and "already swapped out" are indistinguishable. main.ts records
// `window.__vmarkdHadTeaser` at module-eval time, while the teaser is still in the DOM.
//
// Deliberately does NOT pre-activate the extension: `vscode.openWith` triggers activation-by-event and
// the custom-editor resolve back to back, which is the closest this harness gets to the real cold path
// (VS Code starting with a .md already open). An `await activate()` first would hand the event loop the
// turn that `setTimeout(0)` needs, warming Lute and answering a different question than the one asked.
import type { EvaluateInVSCode } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIRST = path.join(__dirname, 'fixtures', 'sample.md')
const SECOND = path.join(__dirname, 'fixtures', 'inline.md')

// The SECOND open leaves two live `iframe.webview` elements (both editors stay mounted), so the usual
// `frameLocator('iframe.webview')` hits a strict-mode violation. Take the last one — the editor just
// opened — via contentFrame().
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .locator('iframe.webview')
    .last()
    .contentFrame()
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

async function openAndReadTeaserFlag(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  uri: string,
): Promise<boolean> {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [uri] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  return (await frame
    .locator('body')
    .evaluate(
      () =>
        (window as unknown as { __vmarkdHadTeaser?: boolean })
          .__vmarkdHadTeaser === true,
    )) as boolean
}

test('the first open of a session gets an instant-paint teaser (task 432 probe) @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  const first = await openAndReadTeaserFlag(workbox, evaluateInVSCode, FIRST)
  const second = await openAndReadTeaserFlag(workbox, evaluateInVSCode, SECOND)
  console.log(`[task 432] teaser: first-open=${first} second-open=${second}`)

  expect(
    second,
    'sanity: a later open (host Lute definitely warm) must have the teaser — otherwise this probe is measuring something else entirely',
  ).toBe(true)
  expect(
    first,
    'the FIRST open of the session must also get the teaser — if this fails, the prewarm setTimeout(0) loses the race and the cold open is completely unmasked (task 432)',
  ).toBe(true)
})
