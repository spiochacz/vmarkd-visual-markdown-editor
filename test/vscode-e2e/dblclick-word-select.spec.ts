import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { type EvaluateInVSCode, ev, settle, wf } from './webview-helpers'

// Task 485 — user report: double-click on a word selects the word AND the trailing space. This
// matches a documented Windows-only Chromium/Blink behaviour (see the task file) that does NOT
// reproduce on this Linux dev/CI machine — measured directly: a real dblclick() here never
// over-selects, in IR, WYSIWYG, or on a formatted word. So these specs are a NEGATIVE GUARD, not a
// repro-and-fix: they prove the fix (dblclick-word-select.ts, wired in finish-init.ts) does not
// over-trim, collapse the selection, or fight Vditor's marker-expand rebuild on the platforms that
// were already correct. The one test that DOES exercise the trim logic end-to-end in a real
// Electron/Blink build synthesizes the over-inclusive selection Windows would have produced — that
// proves the DOM manipulation itself works outside jsdom, NOT that the native Windows bug is fixed
// (only the user, on their machine, can confirm that).

let bootCount = 0

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  body: string,
) {
  const tmp = path.join(
    tmpdir(),
    `${process.pid}-${bootCount++}-dblclick-word-select.md`,
  )
  writeFileSync(tmp, body)
  await ev(evaluateInVSCode, async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
  await ev(
    evaluateInVSCode,
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    tmp,
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)
  return { tmp, frame }
}

async function switchToWysiwyg(frame: ReturnType<typeof wf>) {
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
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 30_000 })
  await settle(frame, 1000)
}

/** Double-clicks the middle of the [start, end) character range of the first `[data-block]`'s
 * own text node, and returns the resulting selection's text. */
async function dblclickCharRange(
  frame: ReturnType<typeof wf>,
  rootSelector: string,
  start: number,
  end: number,
) {
  const pLocator = frame.locator(`${rootSelector} [data-block]`).first()
  const relPos = await pLocator.evaluate(
    (p: HTMLElement, args: { start: number; end: number }) => {
      // Walk text nodes rather than assume `p.firstChild` holds the content — WYSIWYG can insert
      // an empty leading text node that's invisible in outerHTML (nothing to render) but shifts
      // which node offset 0 actually lands in.
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      let node: Text | null = null
      let base = 0
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = (n.textContent ?? '').length
        if (base + len > args.start) {
          node = n as Text
          break
        }
        base += len
      }
      if (!node) throw new Error('dblclickCharRange: offset out of range')
      const r = document.createRange()
      r.setStart(node, args.start - base)
      r.setEnd(node, args.end - base)
      const rect = r.getBoundingClientRect()
      const pRect = p.getBoundingClientRect()
      return {
        x: rect.x - pRect.x + rect.width / 2,
        y: rect.y - pRect.y + rect.height / 2,
      }
    },
    { start, end },
  )
  await pLocator.dblclick({ position: { x: relPos.x, y: relPos.y } })
  return frame
    .locator('body')
    .evaluate(() => window.getSelection()?.toString() ?? '')
}

test('IR: dblclick a plain word selects exactly the word, no trailing space', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'hello world foo bar\n',
  )
  const selected = await dblclickCharRange(frame, '.vditor-ir', 8, 9) // inside "world"
  expect(selected).toBe('world')
  rmSync(tmp, { force: true })
})

test('WYSIWYG: dblclick a plain word selects exactly the word, no trailing space', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'hello world foo bar\n',
  )
  await switchToWysiwyg(frame)
  const selected = await dblclickCharRange(frame, '.vditor-wysiwyg', 8, 9)
  expect(selected).toBe('world')
  rmSync(tmp, { force: true })
})

test('IR: dblclick a bold word selects exactly the word, markers stay intact', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'lead **boldword** trail\n',
  )
  await frame.locator('.vditor-ir [data-type="strong"]').first().dblclick()
  const selected = await frame
    .locator('body')
    .evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected).toBe('boldword')
  rmSync(tmp, { force: true })
})

test('synthetic: a selection over-including trailing whitespace (the Windows shape) is trimmed on a real dblclick', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'hello world foo\n',
  )
  const pLocator = frame.locator('.vditor-ir [data-block]').first()
  // Pre-select "world " (word + trailing space) — the over-inclusive shape Windows would produce —
  // BEFORE the dblclick, then dispatch a real dblclick so the fix's listener (bound on the real
  // `document`, not a mock) is what does the trimming.
  await pLocator.evaluate((p: HTMLElement) => {
    const textNode = p.firstChild as Text
    const r = document.createRange()
    r.setStart(textNode, 6)
    r.setEnd(textNode, 12) // "world "
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await pLocator.dispatchEvent('dblclick')
  const selected = await frame
    .locator('body')
    .evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected).toBe('world')
  rmSync(tmp, { force: true })
})
