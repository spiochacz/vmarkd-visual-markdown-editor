import { wf } from './webview-helpers'
// NET (task 364) — IR ⇄ full Preview mode switching must not move the reader.
//
// The pre-existing scroll-preserve.spec.ts asserts only `pvFrac > 0.3` after scrolling to 0.5, so a
// jump of a fifth of the document passed as "preserved". It was blind to the real bug: the block
// anchors in preview-scroll-preserve stopped pairing (IR 126 blocks vs Preview 122 — IR carries a
// trailing edit paragraph and other structural nodes), the code silently fell back to the ~22 sparse
// HEADING anchors, and a linear interpolation across a whole section lands far off whenever a tall
// diagram sits inside it. Measured before the fix: 79px off at 30% scroll, 210px at 50%, 783px at 75%.
//
// So this spec asserts the two things that actually matter:
//   1. the DENSE branch is the one that runs (a silent degrade can never hide again), and
//   2. a perceptual metric — the block you were looking at stays put — measured DEEP in the document
//      (where the sparse fallback fails worst), not a loose scroll fraction.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })

const FIND_SCROLLER = `function findScroller(el) {
  let n = el;
  while (n && n !== document.body) {
    const s = getComputedStyle(n);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}`

// The first top-level block whose bottom is below the viewport top = what the reader is looking at.
const ANCHOR = `((sel, fs) => {
  new Function(fs + '; window.__fs = findScroller')();
  const reset = document.querySelector(sel);
  if (!reset) return null;
  const sc = window.__fs(reset);
  const scTop = sc.getBoundingClientRect().top;
  const kids = Array.from(reset.children);
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect();
    if (r.bottom > scTop + 1)
      return { idx: i, off: Math.round(r.top - scTop), sig: (kids[i].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30) };
  }
  return null;
})`

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, args?: unknown) => Promise<unknown>,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })
  // Let the diagram engines finish — their heights are what the anchors interpolate over.
  // task 451 looked at converting the sleeps in this file to polls and deliberately left them:
  // every assertion here reads POSITION (block-anchor offset, drift px) on all-renderers.md, across
  // 8 engines and a pane switch. A poll can only confirm "something exists", not "layout has
  // stopped moving" — declaring done on a mid-reflow plateau would be a FALSE PASS on exactly the
  // regression this file exists to catch (measured before the fix: 783px drift at 75% scroll).
  // Leave as a quiescence wait.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 10_000)))
  return frame
}

const toPreview = (frame: ReturnType<typeof wf>) =>
  frame.locator('body').evaluate(() => {
    const inst = (window as any).vditor
    const v = inst.vditor
    v.preview.element.style.display = 'block'
    v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
    v.preview.render(v)
  })

const toEdit = (frame: ReturnType<typeof wf>) =>
  frame.locator('body').evaluate(() => {
    const inst = (window as any).vditor
    const v = inst.vditor
    v.preview.element.style.display = 'none'
    v[inst.getCurrentMode()].element.parentElement.style.display = 'block'
  })

test('the dense block anchors pair between IR and Preview (no silent sparse fallback)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  const frame = await open(workbox, evaluateInVSCode)
  await toPreview(frame)
  // task 451: leave (geometry-quiescence, see `open()`'s comment above).
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 12_000)))

  // Recompute the module's pairing decision from the live DOM: the counts differ by design, so what
  // must hold is that MOST blocks still pair (that is what keeps the anchors dense).
  const pairing = await frame.locator('body').evaluate(() => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: block-signature classifier across every block kind (heading/code/list/table/…); pre-existing (task 469 baseline)
    const sig = (el: Element): string => {
      const tag = el.tagName
      if (/^H[1-6]$/.test(tag))
        return `h:${(el.textContent ?? '').replace(/[#\s]/g, '').slice(0, 24)}`
      const host = (el.getAttribute('class') ?? '').includes('language-')
        ? el
        : el.querySelector('[class*="language-"]')
      const lang = (host?.getAttribute('class') ?? '').match(
        /language-([\w-]+)/,
      )?.[1]
      if (lang) return `lang:${lang}`
      if (
        el.getAttribute('data-type') === 'math-block' ||
        el.querySelector('.katex-display')
      )
        return 'math'
      if (tag === 'HR') return 'hr'
      if (tag === 'TABLE') return 'table'
      if (tag === 'BLOCKQUOTE') return 'bq'
      if (tag === 'UL' || tag === 'OL') return 'list'
      return 'p'
    }
    const v = (window as any).vditor
    const irEl = v.vditor[v.getCurrentMode()].element as HTMLElement
    const pvEl = v.vditor.preview.previewElement as HTMLElement
    const a = Array.from(irEl.children).map(sig)
    const b = Array.from(pvEl.children).map(sig)
    // Same LCS as the module.
    const n = a.length
    const m = b.length
    const dp = new Uint16Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * (m + 1) + j] =
          a[i] === b[j]
            ? dp[(i + 1) * (m + 1) + j + 1] + 1
            : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1])
    return { ir: n, pv: m, paired: dp[0] }
  })
  // eslint-disable-next-line no-console
  console.log(`[mode-switch] pairing: ${JSON.stringify(pairing)}`)

  // Dense means "most of the document", not "all of it" — IR legitimately carries extra nodes.
  expect(
    pairing.paired,
    'block anchors must still pair densely (else the module silently drops to ~20 heading anchors)',
  ).toBeGreaterThan(Math.min(pairing.ir, pairing.pv) * 0.8)
})

// Deep positions are where the sparse fallback failed worst (783px at 75% before the fix).
for (const frac of [0.5, 0.75]) {
  test(`the block you are reading stays put switching IR -> Preview at ${frac * 100}%`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(240_000)
    const frame = await open(workbox, evaluateInVSCode)

    await frame.locator('body').evaluate(
      (_el, args) => {
        const [fs, f] = args as [string, number]
        new Function(`${fs}; window.__fs = findScroller`)()
        const reset = document.querySelector(
          '.vditor-ir .vditor-reset',
        ) as HTMLElement
        const sc = (window as any).__fs(reset) as HTMLElement
        sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * f)
      },
      [FIND_SCROLLER, frac] as [string, number],
    )
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 600)))

    const before = (await frame.locator('body').evaluate(
      (_el, args) => {
        const [src, sel, fs] = args as [string, string, string]
        return new Function('sel', 'fs', `return (${src})(sel, fs)`)(sel, fs)
      },
      [ANCHOR, '.vditor-ir .vditor-reset', FIND_SCROLLER] as [
        string,
        string,
        string,
      ],
    )) as { idx: number; off: number; sig: string }
    expect(before, 'could not find an anchor block in IR').not.toBeNull()

    await toPreview(frame)
    // Outlast the pin AND the async diagram growth, so we measure where it SETTLES.
    // task 451: leave (geometry-quiescence, see `open()`'s comment above — this literally measures
    // "where it settles", so a poll that returns early defeats the point).
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 12_000)))

    // Find the SAME block in Preview. NOT by text: a diagram block's IR text is its ```fenced source
    // while Preview holds the rendered SVG, so text never matches for exactly the blocks that matter.
    // Use the module's own LCS pairing to map the IR index to its Preview counterpart.
    const landed = (await frame.locator('body').evaluate(
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: in-page IR-index→Preview-counterpart lookup via the LCS pairing + a nested block-signature function; pre-existing (task 469 baseline)
      (_el, args) => {
        const [fs, irIdx] = args as [string, number]
        new Function(`${fs}; window.__fs = findScroller`)()
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: block-signature classifier across every block kind (heading/code/list/table/…); pre-existing (task 469 baseline)
        const sig = (el: Element): string => {
          const tag = el.tagName
          if (/^H[1-6]$/.test(tag))
            return `h:${(el.textContent ?? '').replace(/[#\s]/g, '').slice(0, 24)}`
          const host = (el.getAttribute('class') ?? '').includes('language-')
            ? el
            : el.querySelector('[class*="language-"]')
          const lang = (host?.getAttribute('class') ?? '').match(
            /language-([\w-]+)/,
          )?.[1]
          if (lang) return `lang:${lang}`
          if (
            el.getAttribute('data-type') === 'math-block' ||
            el.querySelector('.katex-display')
          )
            return 'math'
          if (tag === 'HR') return 'hr'
          if (tag === 'TABLE') return 'table'
          if (tag === 'BLOCKQUOTE') return 'bq'
          if (tag === 'UL' || tag === 'OL') return 'list'
          return 'p'
        }
        const v = (window as any).vditor
        const irEl = v.vditor[v.getCurrentMode()].element as HTMLElement
        const reset = v.vditor.preview.previewElement as HTMLElement
        const a = Array.from(irEl.children).map(sig)
        const b = Array.from(reset.children).map(sig)
        const n = a.length
        const m = b.length
        const dp = new Uint16Array((n + 1) * (m + 1))
        for (let i = n - 1; i >= 0; i--)
          for (let j = m - 1; j >= 0; j--)
            dp[i * (m + 1) + j] =
              a[i] === b[j]
                ? dp[(i + 1) * (m + 1) + j + 1] + 1
                : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1])
        let i = 0
        let j = 0
        let pv = -1
        while (i < n && j < m) {
          if (a[i] === b[j]) {
            if (i === irIdx) {
              pv = j
              break
            }
            i++
            j++
          } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) i++
          else j++
        }
        if (pv < 0) return { found: false, off: 0 }
        const sc = (window as any).__fs(reset) as HTMLElement
        const el2 = reset.children[pv] as HTMLElement
        return {
          found: true,
          off: Math.round(
            el2.getBoundingClientRect().top - sc.getBoundingClientRect().top,
          ),
        }
      },
      [FIND_SCROLLER, before.idx] as [string, number],
    )) as { found: boolean; off: number }

    const drift = landed.found ? Math.abs(landed.off - before.off) : -1
    // eslint-disable-next-line no-console
    console.log(
      `[mode-switch ${frac}] anchor "${before.sig}" IR ${before.off}px -> PV ${landed.off}px  drift=${drift}px (found=${landed.found})`,
    )

    expect(landed.found, 'the anchor block must exist in Preview too').toBe(
      true,
    )
    // NOT near-zero by design: alignByHeadings aligns the viewport CENTRE, so the block at the TOP
    // keeps a small offset from the panes' differing layout over half a viewport. The bar is set to
    // catch the real regression (hundreds of px), not to demand pixel equality.
    expect(
      drift,
      `switching to Preview moved the reader's block by ${drift}px`,
    ).toBeLessThan(120)
  })
}

test('switching Preview -> IR and back is stable (no cumulative creep)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  const frame = await open(workbox, evaluateInVSCode)

  await frame.locator('body').evaluate((_el, fs) => {
    new Function(`${fs}; window.__fs = findScroller`)()
    const reset = document.querySelector(
      '.vditor-ir .vditor-reset',
    ) as HTMLElement
    const sc = (window as any).__fs(reset) as HTMLElement
    sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * 0.6)
  }, FIND_SCROLLER)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 600)))

  const read = async () =>
    (await frame.locator('body').evaluate(
      (_el, args) => {
        const [src, sel, fs] = args as [string, string, string]
        return new Function('sel', 'fs', `return (${src})(sel, fs)`)(sel, fs)
      },
      [ANCHOR, '.vditor-ir .vditor-reset', FIND_SCROLLER] as [
        string,
        string,
        string,
      ],
    )) as { idx: number; off: number; sig: string }

  const start = await read()
  // Three full round trips — a per-switch bias would compound into an obvious drift.
  // task 451: leave both sleeps in this loop (geometry-quiescence, see `open()`'s comment above).
  for (let i = 0; i < 3; i++) {
    await toPreview(frame)
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 6000)))
    await toEdit(frame)
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  }
  const end = await read()
  // eslint-disable-next-line no-console
  console.log(
    `[mode-switch] round trips: start "${start.sig}" @${start.off}px -> end "${end.sig}" @${end.off}px`,
  )

  expect(
    end.sig,
    'after 3 round trips the reader must be on the same block',
  ).toBe(start.sig)
  expect(
    Math.abs(end.off - start.off),
    'position must not creep across repeated switches',
  ).toBeLessThan(120)
})
