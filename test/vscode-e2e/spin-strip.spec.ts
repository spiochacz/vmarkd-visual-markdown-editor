import { type EvaluateInVSCode, wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 172 — strip the rendered preview SVG out of the per-keystroke SpinVditorIRDOM input.
// ACCEPTANCE in the real custom-editor pipeline: typing in a mermaid source (which renders an svg into
// the preview that the spin would otherwise re-parse every keystroke) must (1) actually strip that svg
// from the spin INPUT — proven by wrapping window.__vmarkdStripPreviewForSpin and seeing inLen >> outLen;
// (2) round-trip BYTE-CORRECT to the host TextDocument (the strip touches only a copy fed to the spin,
// never the saved source); (3) leave the LIVE rendered svg intact (we parse a detached copy). RED before
// the patch: inLen === outLen (no strip) and the spin re-parses the whole svg.
const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-edit.md')

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

test('strips the rendered preview SVG from the spin input, byte-correct save, live svg intact', async ({
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
  // let mermaid render its svg into the preview (so there's a heavy render to embed in the spin)
  await frame
    .locator('.language-mermaid svg')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // The strip hook is installed by installEditActivity at init; wait for it before wrapping so we never
  // race ahead of the install (else our wrapper is skipped and the counters stay 0 — a cold-boot flake).
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(
            () =>
              typeof (window as unknown as Record<string, unknown>)
                .__vmarkdStripPreviewForSpin === 'function',
          ),
      { timeout: 15_000, intervals: [200, 400, 800] },
    )
    .toBe(true)

  // Wrap the strip hook to record input vs output length per call (the direct proof of the shrink).
  await frame.locator('body').evaluate(() => {
    const w = window as unknown as Record<string, any>
    w.__strip = { calls: 0, maxIn: 0, maxReduction: 0, sawSvgIn: false }
    const orig = w.__vmarkdStripPreviewForSpin
    if (typeof orig === 'function' && !orig.__wrapped) {
      const wrapped = (html: string) => {
        const out = orig(html)
        w.__strip.calls++
        if (html.length > w.__strip.maxIn) w.__strip.maxIn = html.length
        if (html.includes('<svg')) w.__strip.sawSvgIn = true
        const red = html.length - (out as string).length
        if (red > w.__strip.maxReduction) w.__strip.maxReduction = red
        return out
      }
      ;(wrapped as { __wrapped?: boolean }).__wrapped = true
      w.__vmarkdStripPreviewForSpin = wrapped
    }
  })

  // Give the nested webview iframe PAGE-LEVEL keyboard focus before typing. The evaluate below only
  // does a DOM-level source.focus(); workbox.keyboard.type() dispatches to the top Electron window, so
  // without an OS-level click into the iframe the keystrokes race the focus and drop non-
  // deterministically. Click the editor's top-left margin (position 4,4) — inside .vditor-ir but clear
  // of the rendered diagram, so it can't trip the diagram zoom/interaction gate. Harness focus fix.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })

  // Place the caret at the end of mermaid's trailing `zzz` identifier (stays valid as we append letters).
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  const placed = await frame.locator('body').evaluate(() => {
    const wrapper = document.querySelector('.language-mermaid')
    const node = wrapper?.closest('.vditor-ir__node') as HTMLElement | null
    if (!node) return false
    node.classList.add('vditor-ir__node--expand')
    const source = node.querySelector(
      '.vditor-ir__marker--pre',
    ) as HTMLElement | null
    if (!source) return false
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT)
    let target: Text | null = null
    let n = walker.nextNode() as Text | null
    while (n) {
      if (n.textContent?.includes('zzz')) {
        target = n
        break
      }
      n = walker.nextNode() as Text | null
    }
    if (!target) return false
    const idx = (target.textContent ?? '').lastIndexOf('zzz') + 3
    const r = document.createRange()
    r.setStart(target, idx)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    source.focus()
    return true
  })
  expect(placed, 'could not place caret in the mermaid source').toBe(true)

  await workbox.keyboard.type('qrstuvwx', { delay: 60 })
  // let the deferred render settle (so the live svg is back / overlay swapped)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const r = await frame.locator('body').evaluate(() => {
    const w = window as unknown as Record<string, any>
    const liveSvg = !!document.querySelector('.language-mermaid svg')
    return { ...w.__strip, liveSvg }
  })
  // eslint-disable-next-line no-console
  console.log(`[spin-strip] ${JSON.stringify(r)}`)

  // (1) the strip actually fired on the embedded render: a big input that shrank substantially
  expect(r.calls, 'strip hook never called (patch not wired?)').toBeGreaterThan(
    0,
  )
  expect(
    r.sawSvgIn,
    'no spin input ever contained an <svg (nothing to strip?)',
  ).toBe(true)
  expect(
    r.maxReduction,
    `spin input was not shrunk (maxIn=${r.maxIn}, maxReduction=${r.maxReduction})`,
  ).toBeGreaterThan(1000)

  // (3) the live rendered svg is intact (we only stripped a copy fed to the spin)
  expect(r.liveSvg, 'the live mermaid svg disappeared').toBe(true)

  // (2) byte-correct save: the appended letters land in the mermaid source in the host TextDocument
  const text = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[spin-strip] host doc has zzzqrstuvwx: ${text.includes('zzzqrstuvwx')}`,
  )
  expect(text).toContain('zzzqrstuvwx')
  expect(text).toContain('graph TD') // the mermaid block round-tripped intact
})
