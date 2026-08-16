import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const DIR = path.join(tmpdir(), 'vmarkd-task-212')
const DOC = path.join(DIR, 'widgets.md')

const frameFor = (workbox: import('@playwright/test').Page) =>
  workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')

usePinnedSettings(test, {
  'vmarkd.editor.codeLineNumbers': true,
})

test('CSP-safe image and code widgets neither lock scrolling nor lose copy', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  writeFileSync(
    DOC,
    '# Widgets\n\n![image](https://example.invalid/never-loads.png)\n\n```ts\nconst copyMe = 42;\n```\n',
  )
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [DOC] as [string],
  )
  const frame = frameFor(workbox)
  // Task 516 triage — `#vmarkd-prerender` (html-builder.ts) is a full-viewport
  // `position:absolute;inset:0;z-index:5` instant-paint overlay carrying its OWN copy of
  // `.vditor-ir img` (same class as the live editor — prerender-style-parity.spec.ts documents the
  // mirroring), and it is not `pointer-events:none` — only its spinner is. `.vditor-ir img`'s
  // `.first()` resolves to document order, which lands on the LIVE editor's img (the overlay markup
  // comes later in the body), not the overlay's own copy — so waiting only for that img to be
  // "visible" says nothing about whether the still-present overlay is sitting on top of it.
  // `removePrerenderOverlay()` runs synchronously right after `applyVditorTheme` in the common case,
  // normally a sub-second window, but under CPU contention it can still be in flight once the image
  // is judged visible — reproduced deterministically with the VMARKD_PRERENDER_PARITY_HOLD test hook
  // (preview-widgets-dblclick-probe, task 516): held open, the SAME dblclick this test issues times
  // out with the exact "visible, enabled, stable" + hit-test-retry signature from the reported flake,
  // and `document.elementFromPoint` at the image's center resolves inside `#vmarkd-prerender`, not the
  // image. Waiting for the overlay's own removal (a real, observable DOM event) instead of a fixed
  // delay removes the race without weakening the dblclick assertion.
  const image = frame.locator('.vditor-ir img').first()
  await image.waitFor({ timeout: 60_000 })
  // `state: 'detached'` resolves immediately when the element never existed at all (an overlay-less
  // open, e.g. no preRenderedHtml), so this is a no-op there — only a REAL still-present overlay
  // makes it wait.
  await frame
    .locator('#vmarkd-prerender')
    .waitFor({ state: 'detached', timeout: 60_000 })
  await image.dblclick()
  await expect(frame.locator('.vditor-img')).toHaveCount(0)
  await expect
    .poll(() =>
      frame.locator('body').evaluate(() => document.body.style.overflow),
    )
    .toBe('')

  // No-arg overload: the callback takes no vscode args, so the fixture's `evaluateInVSCode(fn)`
  // overload applies directly instead of a `[] as [string]` cast (which TS rejects — an empty
  // array literal can't be narrowed to the 1-tuple `[string]`).
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.env.clipboard.writeText('task-212-sentinel')
  })
  const codeBlock = frame
    .locator('.vditor-ir__preview')
    .filter({ hasText: 'copyMe' })
  await codeBlock.hover()
  await frame
    .locator('.vditor-ir .vditor-copy [data-vmarkd-copy-code="true"]')
    .first()
    .click()
  await expect
    .poll(
      () =>
        // Same no-arg overload as above.
        evaluateInVSCode(async (vscode: typeof import('vscode')) =>
          vscode.env.clipboard.readText(),
        ),
      { timeout: 15_000, intervals: [250, 500, 1000] },
    )
    // Vditor prepends visual line numbers in this mode. The custom copy bridge must use the
    // underlying code textarea, not the rendered gutter, or users get "1 const copyMe...".
    .toBe('const copyMe = 42;')
  rmSync(DIR, { recursive: true, force: true })
})
