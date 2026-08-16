import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// MEASUREMENT (diagnostic, not a gate) — quantifies the per-keystroke cost of the #app MutationObserver
// fleet on a HEAVY doc (diagrams + callouts + code), to decide whether tasks 173/174/176 are worth it.
//
// The observers "ignore the MutationRecords and run a full-editor querySelectorAll" (memory
// per-keystroke-observer-side-effects), so their dominant cost IS querySelectorAll over the whole tree.
// We therefore wrap Element/Document.prototype.querySelectorAll and accumulate {selector -> count, ms}
// DURING a fast-typing burst — that captures the real aggregate scan cost and attributes it per selector
// (the observer selectors `.vditor-ir__marker--pre>code` / `blockquote` / `[data-type=html-block]` /
// `.language-*` show up directly). Plus: wrap SpinVditorIRDOM (spin share), a probe MutationObserver on
// the editor root (deliveries/keystroke = the amplification factor task 174 targets), and an rAF-gap
// blocking sampler (the symptom magnitude). Two scenarios: typing in PROSE vs in a CODE-block source
// (where code-source injects `.hljs` → extra fleet wakeups = amplification).
//
// Reports: total blocking, spin ms, total qSA ms + the OBSERVER-selector subset (the 173/174 gain
// ceiling), deliveries/keystroke. Asserts only that typing registered.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

const SCENARIOS = ['prose', 'code'] as const

for (const scenario of SCENARIOS) {
  test(`observer-fleet cost on a heavy doc — typing in ${scenario} @probe`, async ({
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
    // let the diagram render burst + settle so we measure steady-state per-keystroke cost
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 5000)))

    // Give the nested webview iframe PAGE-LEVEL keyboard focus before typing (click the editor's
    // top-left margin). The evaluate below only does a DOM-level target.focus(); keyboard.type()
    // dispatches to the top Electron window. Prose happens to land without this, but the code-block
    // source (marker--pre) does not activate from a classList-expand + DOM focus alone — the
    // keystrokes never reach it (deliveries=0). Harness focus fix, not product behaviour.
    await frame
      .locator('.vditor-ir')
      .first()
      .click({ position: { x: 4, y: 4 } })
    // Place the caret: end of a prose paragraph, or end of a code-block source line.
    // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
    // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
    // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
    const placed = await frame.locator('body').evaluate((_b, sc) => {
      const ir = document.querySelector('.vditor-ir') as HTMLElement | null
      if (!ir) return false
      let target: HTMLElement | null = null
      if (sc === 'prose') {
        target = (Array.from(ir.querySelectorAll('p')).find(
          (p) =>
            (p.textContent ?? '').length > 40 &&
            !p.closest('[data-type="code-block"]'),
        ) ?? null) as HTMLElement | null
      } else {
        // a real (highlighted) code block source, NOT a diagram language
        const code = Array.from(
          ir.querySelectorAll('.vditor-ir__marker--pre > code'),
        ).find((c) =>
          /language-(js|javascript|ts|typescript|python|json)/.test(
            (c as HTMLElement).className,
          ),
        )
        const node = code?.closest('.vditor-ir__node') as HTMLElement | null
        node?.classList.add('vditor-ir__node--expand')
        target = (code as HTMLElement) ?? null
      }
      if (!target) return false
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
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
      target.focus()
      return true
    }, scenario)
    expect(placed, `could not place caret for ${scenario}`).toBe(true)

    // Instrument BEFORE typing: spin wrap, qSA wrap (gated), probe observer, blocking sampler.
    const docInfo = await frame.locator('body').evaluate(() => {
      const w = window as unknown as Record<string, any>
      const lute = w.vditor?.vditor?.lute
      w.__spin = { count: 0, ms: 0 }
      if (lute && !lute.__wrapped) {
        const orig = lute.SpinVditorIRDOM.bind(lute)
        lute.SpinVditorIRDOM = (html: string) => {
          const a = performance.now()
          const r = orig(html)
          w.__spin.ms += performance.now() - a
          w.__spin.count++
          return r
        }
        lute.__wrapped = true
      }

      // qSA accumulator (gated by __qsaOn so only the typing burst counts)
      w.__qsa = {
        on: false,
        total: 0,
        count: 0,
        bySel: {} as Record<string, { c: number; ms: number }>,
      }
      const acc = (sel: string, dt: number) => {
        w.__qsa.total += dt
        w.__qsa.count++
        if (!w.__qsa.bySel[sel]) w.__qsa.bySel[sel] = { c: 0, ms: 0 }
        const e = w.__qsa.bySel[sel]
        e.c++
        e.ms += dt
      }
      if (!w.__qsaWrapped) {
        const ep = Element.prototype.querySelectorAll
        Element.prototype.querySelectorAll = function (
          this: Element,
          sel: string,
        ) {
          if (!w.__qsa.on) return ep.call(this, sel)
          const a = performance.now()
          const res = ep.call(this, sel)
          acc(sel, performance.now() - a)
          return res
        } as typeof Element.prototype.querySelectorAll
        const dp = Document.prototype.querySelectorAll
        Document.prototype.querySelectorAll = function (
          this: Document,
          sel: string,
        ) {
          if (!w.__qsa.on) return dp.call(this, sel)
          const a = performance.now()
          const res = dp.call(this, sel)
          acc(sel, performance.now() - a)
          return res
        } as typeof Document.prototype.querySelectorAll
        w.__qsaWrapped = true
      }

      // probe observer on the editor root: count microtask deliveries + records during the burst
      w.__mo = { deliveries: 0, records: 0 }
      const root =
        (w.vditor?.vditor?.ir?.element as HTMLElement) ??
        (document.querySelector('.vditor-ir') as HTMLElement)
      w.__probe?.disconnect?.()
      const probe = new MutationObserver((muts) => {
        w.__mo.deliveries++
        w.__mo.records += muts.length
      })
      probe.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      w.__probe = probe

      w.__perf = { blockingMs: 0, maxGapMs: 0 }
      w.__perfRunning = true
      let lastT = performance.now()
      const tick = () => {
        const now = performance.now()
        const gap = now - lastT
        lastT = now
        if (gap > 20) {
          w.__perf.blockingMs += gap - 16.7
          if (gap > w.__perf.maxGapMs) w.__perf.maxGapMs = gap
        }
        if (w.__perfRunning) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      return {
        domNodes: root?.querySelectorAll('*').length ?? 0,
        svgNodes: root?.querySelectorAll('svg *').length ?? 0,
      }
    })

    // turn the qSA accumulator ON for the burst only
    await frame.locator('body').evaluate(() => {
      ;(window as unknown as Record<string, any>).__qsa.on = true
    })

    const KEYSTROKES = 30
    const t0 = Date.now()
    await workbox.keyboard.type(
      'abcdefghijklmnopqrstuvwxyzabcd'.slice(0, KEYSTROKES),
      { delay: 15 },
    )
    const typeMs = Date.now() - t0

    const r = await frame.locator('body').evaluate(() => {
      const w = window as unknown as Record<string, any>
      w.__qsa.on = false
      w.__perfRunning = false
      w.__probe?.disconnect?.()
      const bySel: Record<string, { c: number; ms: number }> = w.__qsa.bySel
      // observer-selector subset = the scans tasks 173/174 would scope/dedupe (whole-tree decorator walks)
      const OBS = [
        '.vditor-ir__marker--pre > code', // code-source
        'blockquote', // callouts
        '[data-type="html-block"]', // html-comment
        'language-', // diagram/custom-diagram observers (.language-X …)
        '.vditor-ir__node', // gap-paragraph / others
      ]
      let obsMs = 0
      for (const [sel, e] of Object.entries(bySel))
        if (OBS.some((o) => sel.includes(o))) obsMs += e.ms
      const top = Object.entries(bySel)
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, 8)
        .map(([sel, e]) => `${e.ms.toFixed(1)}ms x${e.c} ${sel.slice(0, 48)}`)
      return {
        spinCount: w.__spin.count,
        spinMs: w.__spin.ms,
        qsaTotalMs: w.__qsa.total,
        qsaCount: w.__qsa.count,
        obsMs,
        topSelectors: top,
        deliveries: w.__mo.deliveries,
        records: w.__mo.records,
        blockingMs: w.__perf.blockingMs,
        maxGapMs: w.__perf.maxGapMs,
      }
    })

    const rnd = (n: number) => Math.round(n * 10) / 10
    // eslint-disable-next-line no-console
    console.log(
      `[fleet] scenario=${scenario}  doc: ${docInfo.domNodes} DOM nodes (${docInfo.svgNodes} inside svg)\n` +
        `  typed ${KEYSTROKES} chars in ${typeMs}ms · MutationObserver deliveries=${r.deliveries} (~${rnd(r.deliveries / KEYSTROKES)}/key), records=${r.records}\n` +
        `  BLOCKING during burst: ${Math.round(r.blockingMs)}ms · worst freeze=${Math.round(r.maxGapMs)}ms\n` +
        `  SPIN: ${r.spinCount} calls · ${rnd(r.spinMs)}ms total (~${rnd(r.spinMs / KEYSTROKES)}/key)\n` +
        `  querySelectorAll TOTAL during burst: ${rnd(r.qsaTotalMs)}ms over ${r.qsaCount} calls\n` +
        `    -> OBSERVER-selector subset (173/174 ceiling): ${rnd(r.obsMs)}ms (${Math.round((r.obsMs / Math.max(1, r.qsaTotalMs)) * 100)}% of qSA, ${Math.round((r.obsMs / Math.max(1, r.blockingMs)) * 100)}% of blocking)\n` +
        `  top qSA selectors:\n    ${r.topSelectors.join('\n    ')}`,
    )

    // Sanity that the typing burst actually landed. Was `spinCount > 0`, but the fence-skip (task 175)
    // and prose-skip (task 180) — both default ON — deliberately suppress the per-keystroke
    // SpinVditorIRDOM, so spinCount is legitimately 0 now. The MutationObserver deliveries prove the
    // keystrokes reached the document (measured: 60 for a 30-char prose burst) without depending on a
    // spin the product no longer performs.
    expect(r.deliveries, 'typing produced no DOM mutations').toBeGreaterThan(0)
  })
}
