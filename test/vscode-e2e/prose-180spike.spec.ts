import { type EvaluateInVSCode, stickySelection, wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 180 — defer the per-keystroke spin for inert prose keystrokes (the user's original "litery po
// kilka sztuk w paragrafie"). Measures typing-phase blocking with the prose-skip OFF vs ON
// (`window.__vmarkdFastProseEdit`, default ON) on a large doc, asserts byte-correct save + intact
// structure, AND that markdown-active keystrokes (heading) still form (fall through to the real spin).
const FIXTURE = path.join(__dirname, 'fixtures', 'perf-prose.md')

const readDoc = (evaluateInVSCode: EvaluateInVSCode) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri] = args
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === uri,
      )
      return doc ? doc.getText() : ''
    },
    [FIXTURE] as [string],
  ) as Promise<string>

async function caretAtEditHere(frame: ReturnType<typeof wf>): Promise<boolean> {
  return stickySelection(
    frame,
    () => {
      const ir = document.querySelector('.vditor-ir') as HTMLElement | null
      const p = Array.from(ir?.querySelectorAll('p') ?? []).find((x) =>
        x.textContent?.includes('Edit here'),
      ) as HTMLElement | undefined
      if (!p) return false
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      let last: Text | null = null
      let n = walker.nextNode() as Text | null
      while (n) {
        last = n
        n = walker.nextNode() as Text | null
      }
      if (!last) return false
      const r = document.createRange()
      r.setStart(last, (last.textContent ?? '').length)
      r.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      p.focus()
      return true
    },
    null,
  )
}

async function sampleBurst(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  proseSkip: boolean,
  chars: string,
): Promise<{ blockingMs: number; maxGapMs: number }> {
  await frame.locator('body').evaluate((_b, on) => {
    const w = window as unknown as Record<string, any>
    w.__vmarkdFastProseEdit = on
    w.__b = { blockingMs: 0, maxGapMs: 0 }
    w.__bRun = true
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      const gap = now - last
      last = now
      if (gap > 20) {
        w.__b.blockingMs += gap - 16.7
        if (gap > w.__b.maxGapMs) w.__b.maxGapMs = gap
      }
      if (w.__bRun) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, proseSkip)
  await workbox.keyboard.type(chars, { delay: 30 })
  return frame.locator('body').evaluate(() => {
    const w = window as unknown as Record<string, any>
    w.__bRun = false
    return { blockingMs: w.__b.blockingMs, maxGapMs: w.__b.maxGapMs }
  }) as Promise<{ blockingMs: number; maxGapMs: number }>
}

test('SPIKE: deferring the prose spin on a large doc', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const paras0 = await frame
    .locator('body')
    .evaluate(() => document.querySelectorAll('.vditor-ir p').length)

  // BASELINE burst (prose-skip OFF)
  expect(await caretAtEditHere(frame), 'caret #1').toBe(true)
  const off = await sampleBurst(workbox, frame, false, 'abcdefghij')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1800)))

  // SPIKE burst (prose-skip ON)
  expect(await caretAtEditHere(frame), 'caret #2').toBe(true)
  const on = await sampleBurst(workbox, frame, true, 'klmnopqrst')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  // structure intact + chars saved
  const paras1 = await frame
    .locator('body')
    .evaluate(() => document.querySelectorAll('.vditor-ir p').length)
  const text = await readDoc(evaluateInVSCode)
  const r = (n: number) => Math.round(n)
  // eslint-disable-next-line no-console
  console.log(
    `[180-spike] large prose (${paras0} paragraphs)\n` +
      `  typing-block OFF=${r(off.blockingMs)}ms (worst ${r(off.maxGapMs)}) → ON=${r(on.blockingMs)}ms (worst ${r(on.maxGapMs)})\n` +
      `  paragraphs ${paras0}→${paras1} (unchanged=${paras0 === paras1}) · chars saved=${/Edit here[\s\S]*abcdefghij[\s\S]*klmnopqrst|Edit here.*klmnopqrst|abcdefghijklmnopqrst/.test(text)}`,
  )

  // SAFETY: both bursts' chars reached the host doc (skip must not lose input) + no block split/merge
  expect(text, 'typed chars missing from the host doc').toMatch(/klmnopqrst/)
  expect(text, 'baseline chars missing').toMatch(/abcdefghij/)
  expect(paras1, 'paragraph count changed (structure corrupted)').toBe(paras0)
})

test('SAFETY: markdown-active keystrokes still form structure (heading) with prose-skip ON', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  // default ON (no flag set). Caret at end of "Edit here" para, Enter to a new line, type `## Heading`.
  expect(await caretAtEditHere(frame), 'caret').toBe(true)
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('Enter')
  // `#` `#` and the space are markdown-active → fall through to the real spin → heading forms; the
  // letters of "Heading" are skipped but are content.
  await workbox.keyboard.type('## Heading', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const formed = await frame
    .locator('body')
    .evaluate(() =>
      Array.from(document.querySelectorAll('.vditor-ir h2')).some((h) =>
        h.textContent?.includes('Heading'),
      ),
    )
  const text = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[180-spike] heading formed=${formed} · saved=${text.includes('## Heading')}`,
  )
  expect(
    formed,
    'heading did not render (structural char wrongly skipped?)',
  ).toBe(true)
  expect(text).toContain('## Heading') // byte-correct save
})
