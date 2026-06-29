// Unified diagram validation/render-error box (task 178) — real-VS-Code only.
//
// Generalises the mermaid parse-error box (mermaid-error.spec.ts) to every engine that can report an
// error: a broken block must render the shared themed `.vmarkd-diagram-error` box (engine title + a
// <pre> message) instead of a raw "X render error:" dump, a silent blank, or the bare source. The
// error path runs through each engine's real (lazy-loaded) renderer in the actual webview / CSP
// pipeline — not reproducible in the chromium harness. Engines covered here are the ones that
// deterministically THROW on bad input; mindmap/plantuml/geojson/topojson/smiles are NOT asserted
// here — covered by the unit patch tests + their own specs (plantuml renders its own SVG error;
// geojson/topojson keep source; smiles-drawer is too lenient to reliably throw — empirically it
// renders an SVG even for malformed input, so the box code stays defensive but isn't e2e-triggerable).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-errors.md')
const SETTLE_FIXTURE = path.join(
  __dirname,
  'fixtures',
  'diagram-error-settle.md',
)

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// engine slug → the title the box must show (diagram-error.ts ENGINE_TITLES)
const EXPECTED: Record<string, string> = {
  graphviz: 'Graphviz',
  echarts: 'ECharts',
  flowchart: 'Flowchart',
  vega: 'Vega',
  wavedrom: 'WaveDrom',
  nomnoml: 'nomnoml',
}

test('every broken diagram block renders the themed error box, no raw dump / blank', async ({
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
  const expectedCount = Object.keys(EXPECTED).length
  // Engines lazy-load their scripts then render the box; wait until all of them are present (or time out).
  await expect
    .poll(
      async () =>
        frame
          .locator('.vditor-ir__preview .vmarkd-diagram-error')
          .count()
          .catch(() => 0),
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBeGreaterThanOrEqual(expectedCount)
  // settle (custom-diagram observer + any re-render passes)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const info = await frame.locator('body').evaluate(() => {
    const boxes = Array.from(
      document.querySelectorAll('.vditor-ir__preview .vmarkd-diagram-error'),
    )
    return {
      // every box's title + whether its message is a non-empty <pre>
      titles: boxes.map(
        (b) =>
          b.querySelector('.vmarkd-diagram-error__title')?.textContent ?? '',
      ),
      allPre: boxes.every(
        (b) => b.querySelector('.vmarkd-diagram-error__msg')?.tagName === 'PRE',
      ),
      allMsgNonEmpty: boxes.every(
        (b) =>
          (
            b.querySelector('.vmarkd-diagram-error__msg')?.textContent ?? ''
          ).trim().length > 0,
      ),
      // no raw "X render error:" dump survived anywhere
      rawDump: /\b(echarts|mindmap|graphviz|plantuml) render error:/.test(
        document.body.innerText,
      ),
      // the box must never leak into the editable SOURCE (Lute round-trip safety)
      inSource: document.querySelectorAll(
        '.vditor-ir__marker--pre .vmarkd-diagram-error',
      ).length,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[diagram-errors] ${JSON.stringify(info)}`)

  // each engine we cover produced a titled box
  for (const title of Object.values(EXPECTED)) {
    expect(info.titles).toContain(title)
  }
  expect(info.allPre).toBe(true) // <pre> → newlines preserved
  expect(info.allMsgNonEmpty).toBe(true) // a real message, not empty
  expect(info.rawDump).toBe(false) // no unformatted raw dump anywhere
  expect(info.inSource).toBe(0) // never in the editable source
})

// Task 178 item 4 — the box rides the task-161 settle gate. This e2e proves the EDIT→box path in the
// real webview: open a VALID graphviz (renders an SVG), break its source by really TYPING into it, and
// assert the engine re-runs and shows the themed box (replacing the SVG) once the edit settles — i.e.
// the broken-source error path works through Vditor's real spin, not just at open time. The "no box
// strobes mid-keystroke" timing property is proven deterministically in edit-activity.test.ts
// (deferIrDiagramRender skips the render while isTyping()); here we confirm the live edit produces it.
test('editing a valid diagram to be invalid shows the themed error box (real spin, settled)', async ({
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
    [SETTLE_FIXTURE] as [string],
  )

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  // the valid graphviz must render its SVG first (so we know we then REPLACE a live render with a box)
  await frame
    .locator('.vditor-ir__preview .language-graphviz svg')
    .first()
    .waitFor({ timeout: 60_000 })

  // Place the caret after the `zzz` seed inside the editable IR source (proven pattern from
  // d2-edit-perf.spec.ts): the source marker is hidden until the node is expanded, so expand it
  // manually and collapse the caret to the end of the `zzz` text node, then focus the source.
  const placed = await frame.locator('body').evaluate(() => {
    const wrapper = document.querySelector('.language-graphviz')
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
  expect(placed, 'could not place caret in the graphviz source').toBe(true)
  // type DOT-breaking garbage right after `zzz` — a real keystroke burst (delay < QUIET_MS so it
  // coalesces, then settles when we stop) → each keystroke mutates the source → spin → gated render.
  await workbox.keyboard.type(' @@@bad', { delay: 40 })

  // on settle the gate re-renders the now-broken source → the engine throws → the themed box appears
  await frame
    .locator('.vditor-ir__preview .vmarkd-diagram-error')
    .first()
    .waitFor({ timeout: 30_000 })

  const r = await frame.locator('body').evaluate(() => {
    const box = document.querySelector(
      '.vditor-ir__preview .vmarkd-diagram-error',
    )
    return {
      hasBox: !!box,
      title:
        box?.querySelector('.vmarkd-diagram-error__title')?.textContent ?? null,
      msgTag: box?.querySelector('.vmarkd-diagram-error__msg')?.tagName ?? null,
      // the broken render replaced the live SVG (no stale diagram left beside the box)
      svgLeft: document.querySelectorAll(
        '.vditor-ir__preview .language-graphviz svg',
      ).length,
      // never leaks into the editable source
      inSource: document.querySelectorAll(
        '.vditor-ir__marker--pre .vmarkd-diagram-error',
      ).length,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[diagram-error-settle] ${JSON.stringify(r)}`)

  expect(r.hasBox).toBe(true)
  expect(r.title).toBe('Graphviz')
  expect(r.msgTag).toBe('PRE')
  expect(r.svgLeft).toBe(0) // the box replaced the diagram (not shown alongside a stale SVG)
  expect(r.inSource).toBe(0)
})
