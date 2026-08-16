import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 184 acceptance (real VS Code, headless) — the persistent diagram render cache:
//   1. Open a multi-diagram file, let it render, CLOSE the tab, REOPEN → each diagram is
//      served from the HOST cache with ZERO engine render (data-vmarkd-cache-hit + NO
//      data-d2-engine, which is set ONLY by renderD2's engine path), correctly sized (no
//      task-183 size jump), and getValue() byte-identical.
//   2. Editing one diagram never evicts the others' cached renders on reopen.
// The cache lives in the extension host (spans the window session), so a tab close/reopen
// reuses the same store — this is what an in-webview cache (the reverted task-183 idea) can't do.
const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-cache.md')

// Open the fixture in the vMarkd custom editor with the cache flag ON.
async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (
    fn: (vscode: typeof import('vscode'), args: string[]) => Promise<void>,
    args: [string],
  ) => Promise<void>,
) {
  await evaluateInVSCode(
    async (vscode, args) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  return frame
}

// Revert (drop any edit so no save prompt) + close the active editor tab → disposes the webview.
async function closeActive(
  evaluateInVSCode: (
    fn: (vscode: typeof import('vscode')) => Promise<void>,
  ) => Promise<void>,
) {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    )
  })
}

// Wait until all three d2 diagrams have a rendered <svg> (from engine or cache), then settle.
async function waitAllRendered(frame: ReturnType<typeof wf>) {
  await frame.locator('div.language-d2 svg').nth(2).waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
}

// Per-d2-wrapper snapshot + the whole-doc getValue, read inside the webview.
async function snapshot(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    const wrappers = Array.from(
      document.querySelectorAll<HTMLElement>('div.language-d2'),
    )
    const diagrams = wrappers.map((w) => {
      const svg = w.querySelector('svg')
      return {
        cacheHit: w.getAttribute('data-vmarkd-cache-hit') === '1',
        hasEngineMarker: w.hasAttribute('data-d2-engine'),
        hasSvg: !!svg,
        width: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
      }
    })
    const vditor = (window as unknown as { vditor?: { getValue(): string } })
      .vditor
    return { diagrams, value: vditor ? vditor.getValue() : '' }
  })
}

test('reopen serves every diagram from cache: zero engine render, correct size, byte-identical save', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // First open — render (live or already-cached from a prior run; either way populate the cache).
  const frame1 = await open(workbox, evaluateInVSCode)
  await waitAllRendered(frame1)
  const before = await snapshot(frame1)
  expect(before.diagrams).toHaveLength(3)
  expect(before.diagrams.every((d) => d.hasSvg)).toBe(true)

  // Close the tab (webview destroyed) and reopen the same file.
  await closeActive(evaluateInVSCode)
  await new Promise((r) => setTimeout(r, 500))
  const frame2 = await open(workbox, evaluateInVSCode)
  await waitAllRendered(frame2)
  const after = await snapshot(frame2)

  // eslint-disable-next-line no-console
  console.log(`[diagram-cache] before=${JSON.stringify(before.diagrams)}`)
  // eslint-disable-next-line no-console
  console.log(`[diagram-cache] after =${JSON.stringify(after.diagrams)}`)

  expect(after.diagrams).toHaveLength(3)
  // ZERO engine render: every diagram was served from the host cache (cache marker present)
  // and the engine's data-d2-engine marker is ABSENT (renderD2 never ran for it).
  expect(after.diagrams.every((d) => d.cacheHit)).toBe(true)
  expect(after.diagrams.every((d) => !d.hasEngineMarker)).toBe(true)
  // Correct size — no task-183 grow/shrink (cached SVG injected into the LIVE constrained div).
  for (let i = 0; i < 3; i++) {
    expect(after.diagrams[i].width).toBeGreaterThan(0)
    expect(
      Math.abs(after.diagrams[i].width - before.diagrams[i].width),
    ).toBeLessThanOrEqual(2)
  }
  // getValue() byte-identical with cached SVGs injected (data-render="1" → Lute-invisible).
  expect(after.value).toBe(before.value)
})

test('editing one diagram does not evict the other diagrams from the cache', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame1 = await open(workbox, evaluateInVSCode)
  await waitAllRendered(frame1)

  // Type a character into the FIRST d2 diagram's editable source (adds/edits it → a new render
  // + a new cache entry for that diagram; the siblings are untouched).
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  await frame1.locator('body').evaluate(() => {
    const node = Array.from(
      document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
    ).find((n) => n.querySelector('code.language-d2')) as
      | HTMLElement
      | undefined
    const code = node?.querySelector('.vditor-ir__marker--pre code') as
      | HTMLElement
      | undefined
    if (!code) return
    const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    let n = w.nextNode() as Text | null
    while (n) {
      last = n
      n = w.nextNode() as Text | null
    }
    const tn: Node = last ?? code
    const r = document.createRange()
    r.setStart(tn, tn.nodeType === 3 ? (tn.textContent ?? '').length : 0)
    r.collapse(true)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    ;(node as HTMLElement)?.focus()
  })
  await new Promise((r) => setTimeout(r, 30))
  await workbox.keyboard.type(' ', { delay: 0 })
  // Let the edit settle + re-render + re-cache.
  await frame1
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  // Revert (so the doc is clean → closes without a prompt) + close, then reopen.
  await closeActive(evaluateInVSCode)
  await new Promise((r) => setTimeout(r, 500))
  const frame2 = await open(workbox, evaluateInVSCode)
  await waitAllRendered(frame2)
  const after = await snapshot(frame2)

  // eslint-disable-next-line no-console
  console.log(`[diagram-cache:edit] after=${JSON.stringify(after.diagrams)}`)
  // The two UNEDITED diagrams (at least) are still served from the cache — editing one diagram
  // (which added its own new cache entries) never evicted the others' renders.
  const hits = after.diagrams.filter((d) => d.cacheHit).length
  expect(hits).toBeGreaterThanOrEqual(2)
})
