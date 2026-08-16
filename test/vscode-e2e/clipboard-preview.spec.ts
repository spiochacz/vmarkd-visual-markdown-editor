import { settle, stickySelection } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 386 — copying from the SPLIT-VIEW PREVIEW pane put nothing on the clipboard.
//
// This is the one clipboard path that had zero coverage, and it is a different MECHANISM from every
// other pane: IR, WYSIWYG and sv-edit all write `clipboardData.setData` inside their copy handler,
// while `preview/index.ts` cloned the selection and called `document.execCommand("copy")` — from
// inside that very `copy` handler — before `preventDefault()`ing the original event. In a VS Code
// webview (a doubly-nested OOPIF) Chromium refuses that re-entrant write and still returns `true`,
// so the native copy was cancelled and the clipboard kept whatever it held before. Select a
// paragraph in the rendered right-hand pane, press Ctrl+C, paste — and the old content came back.
//
// Real keystrokes and the real VS Code clipboard: the whole defect is in what the handler does to
// the SYSTEM clipboard, which a synthetic ClipboardEvent cannot observe.
//
// Ordering gotcha that made the first investigation inconclusive and is now load-bearing: CLICK the
// pane FIRST (that focuses the webview so the keystroke reaches it), and only THEN set the
// selection. Clicking after selecting collapses the very selection under test, and the copy handler
// then has nothing to serialize — which reads exactly like the bug.
const SRC = path.join(__dirname, 'fixtures', 'torture.md')

const wf = (w: import('@playwright/test').Page) =>
  w
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')

let bootCount = 0

async function bootInSv(
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
  workbox: import('@playwright/test').Page,
) {
  // Unique path per test: VS Code keeps a TextDocument alive per fsPath.
  const tmp = path.join(
    tmpdir(),
    `vmarkd-clip-preview-${process.pid}-${bootCount++}.md`,
  )
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
    [] as unknown as [string],
  )
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), a: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(a[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 2000)
  // Into split view, through the edit-mode toolbar panel — the user's own path.
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
  await frame.locator('.vditor-preview').first().waitFor({ timeout: 30_000 })
  await settle(frame, 3000)
  return { tmp, frame }
}

const readClip = (
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode')) => vscode.env.clipboard.readText(),
    [] as unknown as [string],
  ) as Promise<string>

const writeClip = (
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
  text: string,
) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode'), a: string[]) => {
      await vscode.env.clipboard.writeText(a[0])
    },
    [text] as [string],
  )

test('a selection copied from the split PREVIEW pane reaches the clipboard', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  const { tmp, frame } = await bootInSv(evaluateInVSCode, workbox)
  await writeClip(evaluateInVSCode, 'SENTINEL-preview-copy')

  await frame
    .locator('.vditor-preview')
    .first()
    .click({ position: { x: 8, y: 8 } })
  // Wait for the preview pane to stop CHANGING, not for a fixed number of ms (task 451's rule).
  // torture.md renders several diagrams into this pane, and each one that lands after the selection
  // is set replaces DOM under it.
  //
  // This poll is NOT what fixed the flake this spec used to have — recorded so the next reader
  // doesn't credit it. The real cause was task 490: the click above blurs the editor, focus-restore
  // then treated "activeElement is BODY" as focus-went-nowhere and pulled the caret back into the
  // editor, arming caret.ts's re-assert loop, which collapsed the selection made below one frame
  // later. Fixed in focus-restore.ts (it now bails when the selection is anchored outside the
  // editor). The poll stays because a pane still mutating under a selection is a genuine second
  // hazard.
  let lastSize = -1
  await expect
    .poll(
      async () => {
        const size = await frame
          .locator('.vditor-preview')
          .first()
          .evaluate((el) => el.innerHTML.length)
        const stable = size === lastSize
        lastSize = size
        return stable
      },
      { timeout: 30_000, intervals: [500, 500, 1000] },
    )
    .toBe(true)
  // The copy listener lives on `.vditor-reset` INSIDE `.vditor-preview`, not on the pane itself.
  const selected = await stickySelection(
    frame,
    () => {
      const p = [
        ...document.querySelectorAll('.vditor-preview .vditor-reset p'),
      ].find((x) => x.textContent?.includes('Anchor line BRAVO'))
      if (!p) throw new Error('no BRAVO paragraph in the rendered preview')
      const r = document.createRange()
      r.selectNodeContents(p)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      return s?.toString() ?? ''
    },
    null,
  )
  // Guards the ordering above: if this is empty the test proves nothing about the clipboard.
  expect(selected, 'a real selection was made in the preview pane').toContain(
    'Anchor line BRAVO',
  )

  // Re-read the selection at the LAST possible moment: if the pane still moved under it despite the
  // quiescence poll above, fail here — on the precondition — instead of at the clipboard assertion,
  // where a collapsed selection is indistinguishable from the copy-handler defect under test.
  const stillSelected = await frame
    .locator('body')
    .evaluate(() => window.getSelection()?.toString() ?? '')
  expect(
    stillSelected,
    'the selection survived until the copy keystroke',
  ).toContain('Anchor line BRAVO')

  // Copy exactly ONCE — deliberately not retried. Retrying the keystroke until the clipboard
  // agreed would mask precisely the defect this spec exists to catch (task 386: the handler
  // cancelled the native copy and left the clipboard at its previous value).
  await workbox.keyboard.press('Control+c')

  // Poll the clipboard rather than sleeping: the write is asynchronous through the webview → host
  // bridge, and the previous fixed 2.5 s was both slower than needed and occasionally not enough.
  await expect
    .poll(() => readClip(evaluateInVSCode), {
      timeout: 15_000,
      intervals: [250, 500, 1000],
    })
    .not.toBe('SENTINEL-preview-copy')
  const clip = await readClip(evaluateInVSCode)
  expect(clip, 'the selected preview text reached the clipboard').toContain(
    'Anchor line BRAVO',
  )
  rmSync(tmp, { force: true })
})

test('the split EDIT pane still copies markdown source — the control', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // Proves the preview fix did not disturb the pane that already worked, and that a failure in the
  // test above is about the preview handler rather than about focus, keyboard routing or the VS Code
  // clipboard bridge — all three of which this exercises in the same VS Code.
  test.setTimeout(180_000)
  const { tmp, frame } = await bootInSv(evaluateInVSCode, workbox)
  await writeClip(evaluateInVSCode, 'SENTINEL-edit-copy')

  await frame
    .locator('.vditor-sv')
    .first()
    .click({ position: { x: 8, y: 8 } })
  const selected = await stickySelection(
    frame,
    () => {
      const sv = document.querySelector('.vditor-sv') as HTMLElement | null
      if (!sv) throw new Error('.vditor-sv missing')
      const walker = document.createTreeWalker(sv, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf('Anchor line BRAVO')
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n as Text, i)
        r.setEnd(n as Text, i + 'Anchor line BRAVO'.length)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        return s?.toString() ?? ''
      }
      throw new Error('anchor not found in the sv edit pane')
    },
    null,
  )
  expect(selected).toContain('Anchor line BRAVO')

  await workbox.keyboard.press('Control+c')
  await settle(frame, 2500)

  const clip = await readClip(evaluateInVSCode)
  expect(clip, 'the edit pane copies its selection').toContain(
    'Anchor line BRAVO',
  )
  rmSync(tmp, { force: true })
})
