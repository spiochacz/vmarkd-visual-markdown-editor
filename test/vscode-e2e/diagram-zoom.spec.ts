import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Ctrl-to-interact gate for diagrams (markmap + ECharts mindmap): a PLAIN wheel over a diagram must
// scroll the page (the diagram must NOT capture it — "przechwytuje kursor"), and Ctrl+wheel must
// zoom the diagram. We assert the deterministic signal of that gate: WheelEvent.defaultPrevented.
//   - plain wheel  → defaultPrevented === false  (diagram ignored it → the document scrolls)
//   - Ctrl + wheel → defaultPrevented === true   (the diagram's zoom handler ran + preventDefault'd)
// markmap is gated by overriding its d3-zoom `.filter` (esbuild patch); the ECharts mindmap by a
// capture-phase document listener (diagram-zoom-gate.ts). This is a real-VS-Code test because the
// behaviour lives entirely in the webview's native event path (not reproducible in the harness).
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('diagrams ignore a plain wheel (page scrolls) but zoom on Ctrl+wheel', async ({
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

  const frame = webviewFrame(workbox)
  await frame
    .locator('.vditor-ir__node[data-type="code-block"]')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  // Full Preview overlay — every diagram renders there at real size.
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor?: {
          vditor?: {
            preview?: { element?: HTMLElement; render?: (x: unknown) => void }
          }
        }
      }
    ).vditor
    const editEls = document.querySelectorAll(
      '.vditor-ir, .vditor-wysiwyg, .vditor-sv',
    )
    for (const el of Array.from(editEls))
      (el as HTMLElement).style.display = 'none'
    if (v?.vditor?.preview?.element) {
      v.vditor.preview.element.style.display = 'block'
      v.vditor.preview.render(v.vditor)
    }
  })

  // markmap renders an <svg>, the mindmap a <canvas>; wait for both, then let them settle.
  await frame
    .locator('.vditor-preview .language-markmap svg')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('.vditor-preview .language-mindmap canvas')
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  const result = await frame.locator('body').evaluate(() => {
    const fire = (el: Element | null, ctrlKey: boolean): string => {
      if (!el) return 'NO-EL'
      const ev = new WheelEvent('wheel', {
        deltaY: 120,
        ctrlKey,
        bubbles: true,
        cancelable: true,
      })
      el.dispatchEvent(ev)
      return ev.defaultPrevented ? 'PREVENTED' : 'passed'
    }
    // Dispatch on the deepest painted node so the diagram's own (deep-bound) handler is on the path.
    const markmap = document.querySelector(
      '.vditor-preview .language-markmap svg',
    )
    const mindmap = document.querySelector(
      '.vditor-preview .language-mindmap canvas',
    )
    return {
      markmapPlain: fire(markmap, false),
      markmapCtrl: fire(markmap, true),
      mindmapPlain: fire(mindmap, false),
      mindmapCtrl: fire(mindmap, true),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[zoom-gate] ${JSON.stringify(result)}`)

  // The core fix: a plain wheel is NOT captured → the document scrolls.
  expect(result.markmapPlain).toBe('passed')
  expect(result.mindmapPlain).toBe('passed')
  // Ctrl+wheel reaches the diagram's zoom handler (which preventDefaults).
  expect(result.markmapCtrl).toBe('PREVENTED')
  expect(result.mindmapCtrl).toBe('PREVENTED')
})
