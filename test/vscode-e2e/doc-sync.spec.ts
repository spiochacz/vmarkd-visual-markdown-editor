import { stickySelection, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// NET/PROBE (task 190 P0) — the bidirectional document-sync path shared by the "two tabs on
// one file" (J30) and "external modification while open" (J15) journeys. Both reduce to the
// SAME host↔webview contract: a change NOT originating in this webview (a text-editor tab, a
// git pull, a formatter) fires onDidChangeTextDocument → schedulePostUpdate → the webview's
// `update` handler → preserveCaretAndScroll(setValue) (Vditor #1912). This drives that path
// from both directions and asserts (a) a webview edit reaches the TextDocument, (b) an
// external edit reaches the webview WITHOUT resetting scroll to the top, (c) no echo loop.
// caret-preserve.ts had never been exercised by any test before this.
const SRC = path.join(__dirname, 'fixtures', 'doc-sync.md')

test('a webview edit reaches the TextDocument and does not loop (no echo storm)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(tmpdir(), 'vmarkd-doc-sync-a.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
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
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // PAGE-LEVEL keyboard focus into the nested webview iframe first — `p.focus()` below is DOM-level
  // INSIDE the iframe, while `workbox.keyboard` dispatches to the top Electron window; without this
  // click the keystrokes race that focus and are silently dropped, so the edit never reaches the doc.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })

  // Type into the CARET-ANCHOR paragraph.
  await stickySelection(
    frame,
    () => {
      const p = [...document.querySelectorAll('.vditor-ir p')].find((x) =>
        x.textContent?.includes('CARET-ANCHOR'),
      ) as HTMLElement | undefined
      const t = p?.lastChild as Text | null
      if (!t) throw new Error('caret anchor not found')
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
    },
    null,
  )
  await workbox.keyboard.type('WEBVIEWEDIT', { delay: 40 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const afterEdit = (await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      return { text: doc?.getText() ?? '', version: doc?.version ?? -1 }
    },
    [tmp] as [string],
  )) as { text: string; version: number }
  // The edit reached the document a second (text) tab would show.
  expect(
    afterEdit.text.includes('WEBVIEWEDIT'),
    'webview edit reached doc',
  ).toBe(true)

  // No echo loop: with no further input, the document version must stop changing (an
  // update→edit→update ping-pong would keep incrementing it).
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const settled = (await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      return { version: doc?.version ?? -1 }
    },
    [tmp] as [string],
  )) as { version: number }
  expect(settled.version, 'doc version stable after edit (no echo loop)').toBe(
    afterEdit.version,
  )
  rmSync(tmp, { force: true })
})

test('an external edit reaches the webview and preserves scroll (caret-preserve #1912)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(tmpdir(), 'vmarkd-doc-sync-b.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
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
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // Scroll the true IR scroller (the pre.vditor-reset, NOT the overflow:hidden wrapper) and
  // confirm the write stuck before we rely on it.
  const scrolledTo = await frame.locator('body').evaluate(() => {
    const sc =
      (document.querySelector('.vditor-ir pre.vditor-reset') as HTMLElement) ??
      (document.querySelector('.vditor-ir') as HTMLElement)
    sc.scrollTop = 300
    return sc.scrollTop
  })
  expect(scrolledTo, 'scroller must actually scroll (setup)').toBeGreaterThan(
    50,
  )

  // Rewrite the EXTERNAL-TARGET line from OUTSIDE the webview (simulates a text-editor tab /
  // git pull / formatter): an applyEdit the webview did not originate.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      if (!doc) return
      const idx = doc
        .getText()
        .split('\n')
        .findIndex((l) => l.includes('EXTERNAL-TARGET'))
      const line = doc.lineAt(idx)
      const edit = new vscode.WorkspaceEdit()
      edit.replace(
        doc.uri,
        line.range,
        'EXTERNAL-TARGET rewritten from outside XZ',
      )
      await vscode.workspace.applyEdit(edit)
    },
    [tmp] as [string],
  )
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const result = await frame.locator('body').evaluate(() => {
    const sc =
      (document.querySelector('.vditor-ir pre.vditor-reset') as HTMLElement) ??
      (document.querySelector('.vditor-ir') as HTMLElement)
    return {
      scrollTop: sc.scrollTop,
      hasExternal: (
        document.querySelector('.vditor-ir') as HTMLElement
      ).innerText.includes('rewritten from outside'),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[doc-sync] afterExternalEdit=${JSON.stringify(result)}`)
  // The external change reached the webview…
  expect(result.hasExternal, 'external edit rendered in the webview').toBe(true)
  // …and it did NOT yank the viewport to the top (the #1912 scroll-preserve guarantee).
  expect(
    result.scrollTop,
    'external update must preserve scroll, not reset to top',
  ).toBeGreaterThan(50)
  rmSync(tmp, { force: true })
})
