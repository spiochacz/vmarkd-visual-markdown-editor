import { wf } from './webview-helpers'
// REGRESSION (task 361, second site) — an abc score must survive a theme flip when the render came
// from the PERSISTENT CACHE, not from a live/offscreen render.
//
// Why this spec has to exist separately: the rest of the suite can NEVER reach this path.
// playwright.config.ts sets VMARKD_E2E=1, so DiagramCache starts with `freshStart` and wipes its disk
// store for every test — every render in every other spec is a cache MISS. A real user re-opening a
// document takes the HIT branch instead, and that branch paints `wrapper.innerHTML = <cached svg>`,
// which clobbers textContent. abc re-renders from `data-code` (the patched abcRender), so if the HIT
// paint doesn't stamp the source back, the next theme flip runs reRenderLang (innerHTML='' →
// re-render), finds neither data-code nor textContent, bails out, and the score is GONE permanently.
//
// So: render once (populating the cache), re-open the SAME document in the same VS Code instance to
// force a real HIT, and only then flip the theme.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings, useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'abc-flip-cache.md')

// Content theme follows the editor and is set once, before either open, and never changed again.
usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })
// workbench.colorTheme is flipped twice mid-test (the genuine flip this spec observes), so it
// can't be pinned.
useSettingsRestore(test, ['workbench.colorTheme'])

test('a cached abc render survives a theme flip (task 361 cache-hit path)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  const openIt = () =>
    evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [FIXTURE] as [string],
    )

  // PRECONDITION: content theme follows the editor, so the workbench flip below actually moves the
  // webview foreground and triggers the re-theme (pinned above via usePinnedSettings).

  // Pass 1 — a MISS: render live/offscreen, then let the finished SVG be PUT to the host cache.
  await openIt()
  let frame = wf(workbox)
  await frame
    .locator('.vditor-ir__preview .language-abc svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  // Close and re-open the same file — the second open finds the render in the cache.
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  })
  await openIt()
  frame = wf(workbox)
  await frame
    .locator('.vditor-ir__preview .language-abc svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  // Confirm this run really took the cache-HIT branch — otherwise the spec would silently degrade
  // into a second MISS and prove nothing about the path it exists to cover.
  const hit = await frame
    .locator('.vditor-ir__preview .language-abc[data-vmarkd-cache-hit]')
    .count()
  // eslint-disable-next-line no-console
  console.log(`[abc-cache] cache-hit nodes=${hit}`)
  expect(
    hit,
    'the re-open must be served from the render cache',
  ).toBeGreaterThan(0)

  // Establish a known theme, then make a GENUINE flip (a no-op update fires no re-render).
  const setTheme = async (name: string) => {
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.workspace
          .getConfiguration('workbench')
          .update('colorTheme', args[0], vscode.ConfigurationTarget.Global)
      },
      [name] as [string],
    )
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 4000)))
  }
  await setTheme('Default Light Modern')
  await setTheme('Default Dark Modern')

  const after = await frame.locator('body').evaluate(() => {
    const live = document.querySelector(
      '.vditor-ir__preview .language-abc',
    ) as HTMLElement | null
    return {
      svgs: live?.querySelectorAll('svg').length ?? -1,
      hasCode: !!live?.getAttribute('data-code'),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[abc-cache] after flip: ${JSON.stringify(after)}`)

  expect(
    after.hasCode,
    'the cached paint must stamp the source back (data-code) for the flip re-render',
  ).toBe(true)
  expect(
    after.svgs,
    'the abc score must still be rendered after the theme flip',
  ).toBeGreaterThan(0)
})
