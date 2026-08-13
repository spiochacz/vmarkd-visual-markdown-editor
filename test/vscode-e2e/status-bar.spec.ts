import { settle, wf } from './webview-helpers'
// D1 (task 516) — status bar truth. `src/app/status-bar.ts` (word count + reading time, mode
// indicator) is unit-only today (readingTime/wordCount pure functions in
// media-src/../markdown/reading-time.ts, no e2e). The status bar is WORKBENCH chrome, not webview
// content — read it from the `workbox` page, not the nested iframe.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

// setupStatusBar (src/app/status-bar.ts) writes `$(book) X min read · $(pencil) N words` — icons
// render as separate codicon spans, so match on the surviving plain text instead of the raw
// `$(...)` source.
const wordCountLocator = (workbox: import('@playwright/test').Page) =>
  workbox.locator('.statusbar-item').filter({ hasText: 'words' })
const modeLocator = (workbox: import('@playwright/test').Page) =>
  workbox.locator('.statusbar-item').filter({ hasText: /WYSIWYG|Split/ })

test('word count in the status bar updates while typing, and the mode indicator tracks a mode switch', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(TEMP_DIR, 'vmarkd-status-bar.md')
  writeFileSync(tmp, '# Status bar fixture\n\nStart.\n')

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 500)

  const wc = wordCountLocator(workbox)
  await wc.first().waitFor({ timeout: 30_000 })
  const before = (await wc.first().innerText()).trim()
  // eslint-disable-next-line no-console
  console.log(`[status-bar] word count before: ${JSON.stringify(before)}`)
  expect(before).toMatch(/\d+ words/)

  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await frame.locator('body').evaluate(() => {
    const p = Array.from(document.querySelectorAll('.vditor-ir p')).find((x) =>
      x.textContent?.includes('Start.'),
    ) as HTMLElement | undefined
    const t = p?.lastChild as Text | null
    if (!t) throw new Error('anchor paragraph not found')
    const r = document.createRange()
    r.setStart(t, (t.textContent ?? '').length)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    p?.focus()
  })
  await workbox.keyboard.type(' Several more words landed here now.', {
    delay: 30,
  })

  await expect
    .poll(
      async () => {
        const t = (await wc.first().innerText()).trim()
        const m = /(\d+) words/.exec(t)
        return m ? Number(m[1]) : -1
      },
      { message: 'the status-bar word count increased after typing' },
    )
    .toBeGreaterThan(Number(/(\d+) words/.exec(before)?.[1] ?? 0))

  // Mode indicator: default is WYSIWYG label (IR/WYSIWYG both show it, per status-bar.ts); switch
  // to split (sv) through the toolbar's edit-mode panel and confirm the label follows.
  const modeBefore = (await modeLocator(workbox).first().innerText()).trim()
  // eslint-disable-next-line no-console
  console.log(`[status-bar] mode before: ${JSON.stringify(modeBefore)}`)
  expect(modeBefore).toMatch(/WYSIWYG/)

  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 500)))
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="sv"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-sv').first().waitFor({ timeout: 30_000 })
  await settle(frame, 500)

  await expect
    .poll(async () => (await modeLocator(workbox).first().innerText()).trim(), {
      message: 'the status-bar mode label switched to Split',
    })
    .toMatch(/Split/)

  rmSync(tmp, { force: true })
})
