import { type EvaluateInVSCode, wf } from './webview-helpers'
// Task 165 — the D2 render+layout pipeline (dagre + d2-render + elk-layout + …) is code-split into a
// lazy media/vditor/dist/js/d2/d2-main.js, loaded on demand inside renderD2()'s compile .then and read
// off window.__vmarkdD2. Two real-VS-Code proofs:
//   1. A doc WITHOUT any d2 block must NEVER fetch d2-main.js (that is the whole saving — non-D2 docs
//      stop paying the ~109 KB parse + top-level eval on startup).
//   2. A d2 block must STILL render (SVG produced, data-d2-engine set) after the now-lazy load, and the
//      bundle + the __vmarkdD2 bridge must be present once it does.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const ALL = path.join(__dirname, 'fixtures', 'all-renderers.md')
const NO_D2 = path.join(__dirname, 'fixtures', 'no-d2.md')

async function open(evaluateInVSCode: EvaluateInVSCode, uri: string) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [uri] as [string],
  )
}

test('a doc WITHOUT d2 never loads the d2-main.js bundle (task 165 — the saving)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await open(evaluateInVSCode, NO_D2)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  // Let the whole open/render burst settle — if d2-main.js were eager or wrongly triggered, its
  // script tag would appear within this window.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))
  const state = await frame.locator('body').evaluate(() => ({
    scriptLoaded: !!document.getElementById('vditorD2MainScript'),
    bridge: typeof (window as unknown as { __vmarkdD2?: unknown }).__vmarkdD2,
    hasD2Block: !!document.querySelector('.language-d2'),
  }))
  expect(state.hasD2Block, 'sanity: the no-d2 fixture has no d2 block').toBe(
    false,
  )
  expect(
    state.scriptLoaded,
    'd2-main.js must NOT be fetched for a non-d2 doc (the code-split saving)',
  ).toBe(false)
  expect(state.bridge, 'the __vmarkdD2 bridge must be absent too').toBe(
    'undefined',
  )
})

test('a d2 block renders via the now-lazy d2-main.js bundle (task 165 — still works)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await open(evaluateInVSCode, ALL)
  const frame = wf(workbox)
  await frame
    .locator('.vditor-ir .language-d2 svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))
  const info = await frame.locator('body').evaluate(() => {
    // IR mode has a source MARKER node and a preview RENDER node per d2 block, both `.language-d2`;
    // the SVG + engine attr live on the render node, so check whether ANY of them carries it.
    const d2s = [...document.querySelectorAll('.language-d2')]
    return {
      hasSvg: d2s.some((d) => !!d.querySelector('svg')),
      engine:
        d2s.map((d) => d.getAttribute('data-d2-engine')).find(Boolean) ?? null,
      scriptLoaded: !!document.getElementById('vditorD2MainScript'),
      bridge: typeof (window as unknown as { __vmarkdD2?: unknown }).__vmarkdD2,
    }
  })
  expect(info.hasSvg, 'd2 SVG produced after the lazy load').toBe(true)
  expect(
    info.engine,
    'data-d2-engine set (vmarkd/elk/dagre) — the pipeline ran',
  ).toBeTruthy()
  expect(
    info.scriptLoaded,
    'd2-main.js was lazy-loaded on demand when the d2 block rendered',
  ).toBe(true)
  expect(info.bridge, 'window.__vmarkdD2 bridge installed').toBe('object')
})
