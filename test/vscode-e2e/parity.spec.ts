import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Edit↔Preview parity in the REAL webview: a COLLAPSED IR special block (code, and every
// diagram/math block — anything with a `.vditor-ir__preview` render) must be the SAME height
// as the same block in the full Preview overlay, so nothing "jumps" when you toggle. The IR
// dual-node otherwise wraps the render between phantom line boxes (~58px); the collapse rule
// (main.css) neutralises them for ALL such nodes, not just `code.hljs`.
//
// (Callouts are a separate dual-node whose render is only wired into the IR editor, not the
// Preview pane — out of scope here.)

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// Heights of every top-level dual-node render block (code/diagram/math), keyed by DOM index
// among the reset's children so IR and Preview pair up.
const HEIGHTS = `(sel => {
  const reset = document.querySelector(sel);
  if (!reset) return [];
  return Array.from(reset.children).map((el, i) => ({
    i,
    type: el.getAttribute && el.getAttribute('data-type'),
    h: Math.round(el.getBoundingClientRect().height),
  })).filter(b => b.type === 'code-block' || b.type === 'math-block');
})`

test('collapsed IR special blocks match their Preview height (no jump on toggle)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = webviewFrame(workbox)
  await expect(
    frame.locator('.vditor-ir__node[data-type="code-block"]').first(),
  ).toBeVisible({ timeout: 45_000 })
  await expect(
    frame.locator('.vditor-ir__preview code.hljs').first(),
  ).toBeVisible({ timeout: 20_000 })
  // let IR diagrams settle
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const ir = (await frame
    .locator('body')
    .evaluate(
      (_b, s) =>
        new Function('sel', `return (${s})(sel)`)('.vditor-ir .vditor-reset'),
      HEIGHTS,
    )) as Array<{ i: number; type: string; h: number }>

  // Toggle the full Preview overlay (same as the toolbar button) and let it settle.
  await frame.locator('body').evaluate(() => {
    const inst = (window as any).vditor
    const v = inst.vditor
    v.preview.element.style.display = 'block'
    v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
    v.preview.render(v)
  })
  await expect(frame.locator('.vditor-preview code.hljs').first()).toBeVisible({
    timeout: 20_000,
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const pv = (await frame
    .locator('body')
    .evaluate(
      (_b, s) =>
        new Function('sel', `return (${s})(sel)`)(
          '.vditor-preview .vditor-reset',
        ),
      HEIGHTS,
    )) as Array<{ i: number; type: string; h: number }>

  expect(ir.length).toBeGreaterThan(5)
  // The Kth special block in IR is the Kth in Preview (same doc, same order). Pair by position
  // up to the shorter list. Each: IR (collapsed) height ≈ Preview height. Before the fix,
  // diagram/math blocks were ~58–72px taller in IR. Tolerance absorbs sub-pixel + async settle.
  const n = Math.min(ir.length, pv.length)
  const offenders = []
  for (let k = 0; k < n; k++) {
    const d = Math.abs(ir[k].h - pv[k].h)
    if (d > 8) offenders.push({ type: ir[k].type, ir: ir[k].h, pv: pv[k].h, d })
  }
  expect(offenders, JSON.stringify(offenders)).toEqual([])
})
