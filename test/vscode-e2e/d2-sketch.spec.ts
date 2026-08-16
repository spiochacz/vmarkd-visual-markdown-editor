import { type EvaluateInVSCode, wf } from './webview-helpers'
// Opt-in hand-drawn "sketch" look for D2 diagrams (vmarkd.diagram.d2.sketch, task 120) — real-VS-Code
// only. We own D2's SVG (toSVG), so sketch is a drop-in on the per-shape emit: rough.js turns each leaf
// shape + edge into wobbly multi-stroke <path>s. rough.js rides the lazy d2-main.js chunk (imported by
// d2-render), so it loads only when a d2 block renders. This proves in REAL VS Code (resource-URI/CSP
// custom-editor pipeline the Playwright harness can't reproduce — D2 asserts are `fixme` there): (a) the
// crisp render emits leaf primitives (<rect>/<ellipse>), (b) with the setting ON every leaf + edge is a
// <path> instead (no leaf <rect>/<ellipse>) — so sketch really drove the emit, not a no-op — and (c) a
// live setting flip re-renders (paths ⇄ primitives).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'd2-sketch.md')

// Both tests flip `vmarkd.diagram.d2.sketch` on/off multiple times (reopen + live setting flip) to
// observe the render change, so it can't be pinned to one value.
useSettingsRestore(test, ['vmarkd.diagram.d2.sketch'])

// Close any prior editor (workers:1 → same VS Code instance), set the sketch setting, then open the
// fixture. collectConfigOptions reads the setting at OPEN. `sketch` is a plain boolean.
async function openFresh(
  evaluateInVSCode: EvaluateInVSCode,
  uri: string,
  sketch: boolean,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: [string, boolean]) => {
      const [u, sk] = args
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('diagram.d2.sketch', sk, true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(u),
        'vmarkd.editor',
      )
    },
    [uri, sketch] as [string, boolean],
  )
}

// Update the live setting WITHOUT reopening — exercises onDidChangeConfiguration → config-changed →
// rethemeDiagrams (d2SketchChanged) → reRenderD2.
async function updateSketch(
  evaluateInVSCode: EvaluateInVSCode,
  sketch: boolean,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: [boolean]) => {
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('diagram.d2.sketch', args[0], true)
    },
    [sketch] as [boolean],
  )
}

// Geometry signature of the rendered D2 SVG: primitive counts (rects/ellipses/polygons/paths) + total
// path-`d` length. Standalone (only touches `document`) so Playwright can serialize it to the webview.
// Sketch turns leaf <rect>/<ellipse> into wobbly <path>s → rects/ellipses drop to 0 and paths + pathLen
// jump.
function d2Geom() {
  const svg = document.querySelector('.language-d2 svg')
  if (!svg) return null
  const count = (sel: string) => svg.querySelectorAll(sel).length
  const pathLen = [...svg.querySelectorAll('path')]
    .map((p) => (p.getAttribute('d') || '').length)
    .reduce((a, b) => a + b, 0)
  return {
    rects: count('rect'),
    ellipses: count('ellipse'),
    polygons: count('polygon'),
    paths: count('path'),
    pathLen,
    engine: svg.closest('.language-d2')?.getAttribute('data-d2-engine') ?? '',
  }
}

async function waitForD2(frame: ReturnType<typeof wf>) {
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  // settle: D2 compiles WASM + (default engine) lazy-loads ELK, then swaps in the SVG.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))
}

test('sketch renders crisp and rough geometry, then re-renders live after a setting flip', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(150_000)

  // ── Crisp baseline (setting off) — leaf boxes are <rect>, the circle an <ellipse>, the diamond a
  // <polygon>. Two fresh opens make the crisp≠sketch proof deterministic (no live round-trip). ──
  await openFresh(evaluateInVSCode, FIXTURE, false)
  let frame = wf(workbox)
  await waitForD2(frame)
  const crisp = await frame.locator('body').evaluate(d2Geom)
  expect.soft(crisp, 'crisp render produced a D2 SVG').not.toBeNull()
  // eslint-disable-next-line no-console
  console.log(`[d2-sketch] crisp: ${JSON.stringify(crisp)}`)
  expect
    .soft(crisp?.rects, 'crisp: the two rectangle leaves are <rect>')
    .toBeGreaterThan(0)
  expect
    .soft(crisp?.ellipses, 'crisp: the circle is an <ellipse>')
    .toBeGreaterThan(0)

  // ── Sketch (setting on) — every leaf shape + edge is a rough <path>; no leaf <rect>/<ellipse>. ──
  await openFresh(evaluateInVSCode, FIXTURE, true)
  frame = wf(workbox)
  await waitForD2(frame)
  const sketch = await frame.locator('body').evaluate(d2Geom)
  expect.soft(sketch, 'sketch render produced a D2 SVG').not.toBeNull()
  // eslint-disable-next-line no-console
  console.log(`[d2-sketch] sketch: ${JSON.stringify(sketch)}`)

  // The core proof: the same graph rendered sketchy has NO leaf primitives (they became paths), and far
  // more (and longer) <path>s than the crisp render. If sketch had been a no-op these would match crisp.
  expect
    .soft(sketch?.rects, 'sketch: no leaf <rect> (rough paths instead)')
    .toBe(0)
  expect
    .soft(sketch?.ellipses, 'sketch: no <ellipse> (the circle is a rough path)')
    .toBe(0)
  expect.soft(sketch?.paths).toBeGreaterThan(crisp?.paths ?? 0)
  expect
    .soft(
      sketch?.pathLen,
      'sketch: rough beziers make the total path data much longer',
    )
    .toBeGreaterThan((crisp?.pathLen ?? 0) * 2)
  // Flip OFF live (no reopen) → onDidChangeConfiguration → config-changed → reRenderD2. Poll (generously
  // — the config round-trip + WASM/ELK re-render is slow on a cold host) until the crisp <rect>s return.
  await updateSketch(evaluateInVSCode, false)
  await expect.soft
    .poll(async () => (await frame.locator('body').evaluate(d2Geom))?.rects, {
      timeout: 60_000,
    })
    .toBeGreaterThan(0)
})

// Task 396 — "na ciemnym d2 styled tez ma biala czcionka a powinna miec chyba jak inne": in SKETCH
// mode, a node with an explicit `style.fill` (the `Styled` node, `all-renderers.md`, fill #2b6cb0)
// got its label coloured by contrast-vs-fill (labelColor), but sketch paints fills as rough.js
// HACHURE — only a fraction of the shape is actually that colour, the rest is the page. Fixed:
// sketch mode disables the fill-contrast branch and falls back to the theme's own text colour, same
// as an unstyled node. This asserts the FIX in the real webview: with sketch ON, `Styled`'s label
// fill matches an unstyled node's label fill in the SAME diagram (the grid cell `a`, no explicit
// style at all) — both must fall through to the same theme text colour.
const STYLED_FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

test('sketch mode: a custom-fill node label matches an unstyled node label (task 396)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(150_000)
  await openFresh(evaluateInVSCode, STYLED_FIXTURE, true)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })

  const read = () =>
    frame.locator('body').evaluate(() => {
      const root = (
        window as unknown as {
          vditor: { vditor: { ir: { element: HTMLElement } } }
        }
      ).vditor.vditor.ir.element
      const texts = Array.from(root.querySelectorAll('.language-d2 svg text'))
      const styled = texts.find((t) => t.textContent === 'Styled')
      const plainCell = texts.find((t) => t.textContent === 'a')
      return {
        styledFill: styled ? styled.getAttribute('fill') : null,
        plainFill: plainCell ? plainCell.getAttribute('fill') : null,
      }
    })
  let r: { styledFill: string | null; plainFill: string | null } = {
    styledFill: null,
    plainFill: null,
  }
  await expect
    .poll(
      async () => {
        r = await read()
        return r.styledFill
      },
      { timeout: 90_000, message: 'the Styled node label never rendered' },
    )
    .not.toBeNull()
  expect(
    r.plainFill,
    'no unstyled grid-cell label found to compare against',
  ).not.toBeNull()
  expect(r.styledFill).toBe(r.plainFill)
})
