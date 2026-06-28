import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// MEASUREMENT (baseline for task 161 — live-edit responsiveness). Types letter-by-letter into a
// diagram's IR source block and measures how much the main thread is BLOCKED while the diagram
// re-renders below ("UI przycina się jak edytuję diagram"). This is the EDIT scenario, distinct from
// the one-time OPEN burst measured by perf-timeline.spec.ts (task 145).
//
// Two engine families re-render on different code paths, so we measure one of each:
//   - d2       → observeCustomDiagrams (media-src/src/custom-diagrams.ts): NO debounce — every keystroke
//                re-runs compileD2 (WASM, main-thread go.run). This is the path task 161 targets.
//   - mermaid  → Vditor-native previewRender (mermaidRender) on each SpinVditorIRDOM.
//   - graphviz → Vditor-native previewRender (graphvizRender, viz.js inline worker) on each spin.
//
// Headline metric is rAF-gap blocking: a requestAnimationFrame sampler records frame-to-frame gaps
// during the typing burst; a gap >> 16.7 ms means the main thread was stuck (a render blocked it).
// `blockingMs` = Σ(gap-16.7) over the window (a Total-Blocking-Time analogue that needs no API),
// `maxGapMs` = the single worst freeze. `rebuilds` = how many times the preview wrapper was rebuilt
// (churn). longtask/TBT are reported too when the browser exposes the `longtask` entry type.
//
// The assertions are intentionally trivial (this is a diagnostic, like perf-timeline.spec.ts): it
// prints a table and only fails if typing never registered (rebuilds === 0), so a green run is a real
// measurement, not a no-op.
const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-edit.md')

const ENGINES: { lang: string; family: string }[] = [
  { lang: 'd2', family: 'custom-observer' },
  { lang: 'mermaid', family: 'vditor-native' },
  { lang: 'graphviz', family: 'vditor-native' },
  { lang: 'echarts', family: 'vditor-native (canvas)' },
  { lang: 'flowchart', family: 'vditor-native (DSL)' },
  { lang: 'stl', family: 'custom-observer (WebGL)' },
]

const KEYSTROKES = 15 // letters appended to the trailing `zzz` identifier
const TYPE_DELAY_MS = 50 // human-ish fast typing

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test.beforeEach(async ({ evaluateInVSCode }) => {
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
})

for (const { lang, family } of ENGINES) {
  test(`edit-churn baseline: ${lang} (${family})`, async ({ workbox }) => {
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    // Let THIS engine boot + render once so we measure steady-state per-keystroke cost, not first boot.
    // Soft wait (svg OR canvas — echarts/stl render to canvas): if an engine doesn't visibly render in
    // headless (e.g. WebGL/STL), proceed anyway — we still measure the per-keystroke main-thread block.
    await frame
      .locator(`.language-${lang} svg, .language-${lang} canvas`)
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {})
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

    // Place the caret at the end of the trailing `zzz` identifier in this block's editable IR source.
    const placed = await frame.locator('body').evaluate((_b, l) => {
      const wrapper = document.querySelector(`.language-${l}`)
      const node = wrapper?.closest('.vditor-ir__node') as HTMLElement | null
      if (!node) return false
      // Click-equivalent: select inside the node so Vditor expands it (reveals the editable source).
      const src = node.querySelector(
        '.vditor-ir__marker--pre',
      ) as HTMLElement | null
      const seed = (src ?? node) as HTMLElement
      const range = document.createRange()
      range.selectNodeContents(seed)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      ;(node as HTMLElement).classList.add('vditor-ir__node--expand')
      // Now find the `zzz` text node in the (now visible) source and collapse the caret to its end.
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
      const r2 = document.createRange()
      r2.setStart(target, idx)
      r2.collapse(true)
      sel?.removeAllRanges()
      sel?.addRange(r2)
      ;(source as HTMLElement).focus()
      return true
    }, lang)
    expect(placed, `could not place caret in ${lang} source`).toBe(true)

    // Install the samplers, reset counters.
    await frame.locator('body').evaluate((_b, l) => {
      const w = window as unknown as Record<string, any>
      w.__perf = {
        rebuilds: 0,
        svg: 0,
        longtasks: 0,
        longMs: 0,
        tbt: 0,
        blockingMs: 0,
        maxGapMs: 0,
        frames: 0,
      }
      // longtask (best-effort — not all Chromium builds expose it in a webview)
      try {
        w.__perfPO?.disconnect?.()
        const po = new PerformanceObserver(
          (list: PerformanceObserverEntryList) => {
            for (const e of list.getEntries()) {
              w.__perf.longtasks++
              w.__perf.longMs += e.duration
              w.__perf.tbt += Math.max(0, e.duration - 50)
            }
          },
        )
        po.observe({ entryTypes: ['longtask'] })
        w.__perfPO = po
      } catch {
        /* longtask unsupported — rAF sampler below is the primary metric */
      }
      // preview-rebuild churn: count fresh `.language-<l>` wrappers added by SpinVditorIRDOM
      w.__perfMO?.disconnect?.()
      const root = document.querySelector('.vditor-ir') as HTMLElement
      const mo = new MutationObserver((muts) => {
        for (const m of muts)
          for (const node of Array.from(m.addedNodes)) {
            if (!(node instanceof HTMLElement)) continue
            if (
              node.matches?.(`.language-${l}`) ||
              node.querySelector?.(`.language-${l}`)
            )
              w.__perf.rebuilds++
            if (node.tagName === 'svg' || node.querySelector?.('svg'))
              w.__perf.svg++
          }
      })
      mo.observe(root, { childList: true, subtree: true })
      w.__perfMO = mo
      // rAF-gap blocking sampler (primary, always available)
      w.__perfRunning = true
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        const gap = now - last
        last = now
        w.__perf.frames++
        if (gap > 20) {
          w.__perf.blockingMs += gap - 16.7
          if (gap > w.__perf.maxGapMs) w.__perf.maxGapMs = gap
        }
        if (w.__perfRunning) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, lang)

    // Type letter-by-letter into the focused source — each keystroke mutates the source → spin → render.
    const t0 = Date.now()
    await workbox.keyboard.type('x'.repeat(KEYSTROKES), {
      delay: TYPE_DELAY_MS,
    })
    const typeMs = Date.now() - t0

    // Snapshot blocking accumulated DURING typing — this is the stutter the user feels. With debounce
    // the heavy render is deferred to the pause, so this should be much lower than the pre-debounce
    // baseline even though the (single) post-pause render still costs something.
    const typing = await frame.locator('body').evaluate(() => {
      const p = (window as unknown as Record<string, any>).__perf
      return {
        blockingMs: p.blockingMs,
        maxGapMs: p.maxGapMs,
        rebuilds: p.rebuilds,
      }
    })

    // Settle the deferred render, then stop the sampler and read the totals.
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
    const perf = await frame.locator('body').evaluate(() => {
      const w = window as unknown as Record<string, any>
      w.__perfRunning = false
      w.__perfPO?.disconnect?.()
      w.__perfMO?.disconnect?.()
      return w.__perf
    })

    const round = (n: number) => Math.round(n)
    const postPause = round(perf.blockingMs - typing.blockingMs)
    // eslint-disable-next-line no-console
    console.log(
      `[edit-perf] ${lang.padEnd(9)} (${family})\n` +
        `  keystrokes=${KEYSTROKES} typed in ${typeMs}ms\n` +
        `  WHILE TYPING (the stutter): blocking≈${round(typing.blockingMs)}ms · worst freeze=${round(typing.maxGapMs)}ms\n` +
        `  post-pause settle render: blocking≈${postPause}ms · total blocking≈${round(perf.blockingMs)}ms\n` +
        `  longtask: count=${perf.longtasks} totalMs=${round(perf.longMs)} TBT=${round(perf.tbt)}ms (best-effort)`,
    )

    // Diagnostic, not a gate: only fail if typing never landed (so a green run = a real measurement).
    expect(
      perf.rebuilds,
      `${lang}: typing produced no preview rebuilds`,
    ).toBeGreaterThan(0)
  })
}
