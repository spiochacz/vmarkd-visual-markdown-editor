import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// MEASUREMENT (diagnostic, not a gate) — user report: "jak piszę szybko w paragrafie, litery pojawiają
// się po kilka sztuk" (fast prose typing → letters appear in batches). The diagram-block lag (task 172)
// is the EMBEDDED-SVG spin amplifier; this is the PROSE case, where the per-block spin is cheap, so the
// batching must come from per-keystroke work that scales with the WHOLE DOCUMENT. We open a large
// prose-only doc (no diagrams) and decompose one fast-typing burst into:
//   - spin: every SpinVditorIRDOM call's INPUT LENGTH + wall-ms (input len tells us block- vs doc-scoped)
//   - observers: the wall-cost of the 3 synchronous before-paint observer walks on THIS doc
//                (code-source `.vditor-ir__marker--pre>code`, callouts `blockquote`, html-comment
//                `[data-type=html-block]`) — each runs a full-editor querySelectorAll per keystroke
//   - total main-thread blocking during the burst (rAF-gap sampler) + worst single freeze
// Prints a breakdown; asserts only that typing registered, so a green run is a real measurement.
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// A/B: same fast-typing burst on a SMALL vs LARGE prose doc. If blocking scales with doc size, the
// per-keystroke cost is doc-scoped (fixable — something walks the whole doc); if flat, it's intrinsic.
const DOCS = [
  { name: 'small', file: 'perf-prose-small.md' },
  { name: 'large', file: 'perf-prose.md' },
]

for (const doc of DOCS) {
  test(`fast prose typing breakdown — ${doc.name} doc`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    const FIXTURE = path.join(__dirname, 'fixtures', doc.file)
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

    // Place the caret at the END of the "Edit here" prose paragraph.
    const placed = await frame.locator('body').evaluate(() => {
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
    })
    expect(placed, 'could not place caret in the prose paragraph').toBe(true)

    // Instrument: wrap SpinVditorIRDOM (records input length + ms per call) + a rAF-gap blocking sampler.
    const docInfo = await frame.locator('body').evaluate(() => {
      const w = window as unknown as Record<string, any>
      const v = w.vditor?.vditor
      const lute = v?.lute
      w.__spin = []
      if (lute && !lute.__wrapped) {
        const orig = lute.SpinVditorIRDOM.bind(lute)
        lute.SpinVditorIRDOM = (html: string) => {
          const a = performance.now()
          const r = orig(html)
          const b = performance.now()
          w.__spin.push({ len: (html ?? '').length, ms: b - a })
          return r
        }
        lute.__wrapped = true
      }
      w.__perf = { blockingMs: 0, maxGapMs: 0, frames: 0 }
      w.__perfRunning = true
      let lastT = performance.now()
      const tick = () => {
        const now = performance.now()
        const gap = now - lastT
        lastT = now
        w.__perf.frames++
        if (gap > 20) {
          w.__perf.blockingMs += gap - 16.7
          if (gap > w.__perf.maxGapMs) w.__perf.maxGapMs = gap
        }
        if (w.__perfRunning) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      const ir = document.querySelector('.vditor-ir') as HTMLElement
      return {
        irNodes: ir?.querySelectorAll('*').length ?? 0,
        irBlocks: ir?.querySelectorAll('[data-block]').length ?? 0,
        headings: ir?.querySelectorAll('h1,h2,h3,h4,h5,h6').length ?? 0,
        luteWrapped: !!lute,
      }
    })

    // Type fast (15 ms apart ≈ a quick typist's burst) into the prose paragraph.
    const KEYSTROKES = 30
    const t0 = Date.now()
    await workbox.keyboard.type(
      'abcdefghijklmnopqrstuvwxyzabcd'.slice(0, KEYSTROKES),
      {
        delay: 15,
      },
    )
    const typeMs = Date.now() - t0

    // Read spin timings + blocking; also directly time the 3 sync observers' full-doc walks on THIS doc.
    const r = await frame.locator('body').evaluate(() => {
      const w = window as unknown as Record<string, any>
      w.__perfRunning = false
      const spins: { len: number; ms: number }[] = w.__spin ?? []
      const ms = spins.map((s) => s.ms).sort((a, b) => a - b)
      const lens = spins.map((s) => s.len)
      const med = (arr: number[]) =>
        arr.length ? arr[Math.floor(arr.length / 2)] : 0
      const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

      // Cost of ONE pass of each synchronous before-paint observer's full-editor querySelectorAll, timed
      // on the real doc (×N for the per-keystroke reality; prose injects nothing, so no amplification pass).
      const timeQ = (sel: string) => {
        const a = performance.now()
        let total = 0
        for (let i = 0; i < 20; i++)
          total += document.querySelectorAll(sel).length
        const b = performance.now()
        return { perCall: (b - a) / 20, count: total / 20 }
      }
      return {
        spinCount: spins.length,
        spinMedianMs: med(ms),
        spinMaxMs: ms.length ? ms[ms.length - 1] : 0,
        spinTotalMs: sum(spins.map((s) => s.ms)),
        spinMedianLen: med(lens.slice().sort((a, b) => a - b)),
        spinMaxLen: lens.length ? Math.max(...lens) : 0,
        blockingMs: w.__perf.blockingMs,
        maxGapMs: w.__perf.maxGapMs,
        obsCodeSource: timeQ('.vditor-ir__marker--pre > code'),
        obsCallouts: timeQ('.vditor-ir blockquote'),
        obsHtmlComment: timeQ('.vditor-ir [data-type="html-block"]'),
      }
    })

    const rnd = (n: number) => Math.round(n * 100) / 100
    const obsPerKeystroke =
      r.obsCodeSource.perCall + r.obsCallouts.perCall + r.obsHtmlComment.perCall
    // eslint-disable-next-line no-console
    console.log(
      `[prose-perf] ${doc.name} doc: ${docInfo.irBlocks} blocks, ${docInfo.headings} headings, ${docInfo.irNodes} DOM nodes\n` +
        `  typed ${KEYSTROKES} chars in ${typeMs}ms (~${rnd(typeMs / KEYSTROKES)}ms/key)\n` +
        `  SPIN: ${r.spinCount} calls · median=${rnd(r.spinMedianMs)}ms · max=${rnd(r.spinMaxMs)}ms · total=${rnd(r.spinTotalMs)}ms\n` +
        `        input length: median=${r.spinMedianLen} chars · MAX=${r.spinMaxLen} chars  (block-scoped if small, doc-scoped if ~${docInfo.irNodes}+)\n` +
        `  SYNC OBSERVERS (per keystroke, full-doc walks): ${rnd(obsPerKeystroke)}ms total\n` +
        `        code-source q=${rnd(r.obsCodeSource.perCall)}ms · callouts q=${rnd(r.obsCallouts.perCall)}ms · html-comment q=${rnd(r.obsHtmlComment.perCall)}ms\n` +
        `  MAIN-THREAD BLOCKING during burst: ${Math.round(r.blockingMs)}ms · worst single freeze=${Math.round(r.maxGapMs)}ms`,
    )

    expect(r.spinCount, 'typing produced no spins').toBeGreaterThan(0)
  })
}
