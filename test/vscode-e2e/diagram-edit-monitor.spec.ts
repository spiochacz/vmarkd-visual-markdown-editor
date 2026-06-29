// Edit-cycle MONITOR for diagram rendering — the regression net that was missing.
//
// Earlier diagram specs were "open → assert the final state" snapshots; they could not catch a
// diagram that renders fine at OPEN but breaks (shrinks / errors / vanishes) when its source is
// EDITED. The flowchart-shrink bug (svg 179→79px wide after an edit, because flowchart.js measures
// text and the task-161 defer re-rendered it into a still-display:none child) slipped through exactly
// that gap. This spec drives a REAL keystroke edit through the debounce→settle→swap cycle and watches
// the three things that regress there:
//   1. size jump      — the live diagram must not shrink/collapse vs its initial render,
//   2. error          — a valid edit must NOT show an error box; an invalid one MUST, then recover,
//   3. renders        — the diagram (svg) is actually present after the edit.
// Real VS Code only (the overlay/defer + flowchart text-measure happen only in the custom editor).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-edit-monitor.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, args: unknown) => Promise<unknown>,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri] = args
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  return frame
}

// Measure the LIVE (non-overlay) render of one engine: its `.language-X` wrapper REGION + the svg.
async function measure(frame: ReturnType<typeof wf>, langClass: string) {
  // NB: locator.evaluate passes the ELEMENT as the 1st param, the arg as the 2nd (memory:
  // plantuml-engine-type-stickiness) — so the langClass is `cls`, NOT the first param.
  return frame.locator('body').evaluate((_el, cls) => {
    const wrap = Array.from(
      document.querySelectorAll(`.vditor-ir__preview .${cls}`),
    ).filter((w) => !w.closest('.vmarkd-stale-overlay'))[0] as
      | HTMLElement
      | undefined
    const svg = wrap?.querySelector('svg') as SVGElement | null
    const rect = (el: Element | null | undefined) =>
      el
        ? {
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
          }
        : null
    return {
      region: rect(wrap),
      svg: rect(svg),
      hasSvg: !!svg,
      hasError: !!document.querySelector(
        '.vditor-ir__preview .vmarkd-diagram-error',
      ),
    }
  }, langClass)
}

// Expand the engine's IR node and drop the caret right after `anchor` in its editable source.
async function placeCaretAfter(
  frame: ReturnType<typeof wf>,
  lang: string,
  anchor: string,
) {
  return frame.locator('body').evaluate(
    (_el, { lang, anchor }) => {
      const code = Array.from(
        document.querySelectorAll('.vditor-ir__marker--pre code'),
      ).find((c) => c.className.includes(`language-${lang}`))
      const node = code?.closest('.vditor-ir__node') as HTMLElement | null
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
        if (n.textContent?.includes(anchor)) {
          target = n
          break
        }
        n = walker.nextNode() as Text | null
      }
      if (!target) return false
      const idx = (target.textContent ?? '').indexOf(anchor) + anchor.length
      const r = document.createRange()
      r.setStart(target, idx)
      r.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      source.focus()
      return true
    },
    { lang, anchor },
  )
}

// rAF-sample the live svg height across the whole cycle (catches a mid-edit collapse the
// before/after snapshots would miss).
async function startSampling(frame: ReturnType<typeof wf>, langClass: string) {
  await frame.locator('body').evaluate((_el, cls) => {
    const w = window as unknown as Record<string, unknown>
    w.__samples = []
    w.__sampling = true
    const tick = () => {
      if (!w.__sampling) return
      const wrap = Array.from(
        document.querySelectorAll(`.vditor-ir__preview .${cls}`),
      ).filter((x) => !x.closest('.vmarkd-stale-overlay'))[0] as
        | HTMLElement
        | undefined
      const svg = wrap?.querySelector('svg') as SVGElement | null
      ;(w.__samples as number[]).push(
        svg ? Math.round(svg.getBoundingClientRect().height) : 0,
      )
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, langClass)
}

async function stopSampling(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    w.__sampling = false
    const arr = (w.__samples as number[]).filter((x) => x > 0)
    return {
      min: arr.length ? Math.min(...arr) : 0,
      max: arr.length ? Math.max(...arr) : 0,
      n: arr.length,
    }
  })
}

const settle = (frame: ReturnType<typeof wf>, ms: number) =>
  frame
    .locator('body')
    .evaluate((_el, d) => new Promise((r) => setTimeout(r, d)), ms)

// 1. SIZE STABILITY — flowchart (the regression). A valid edit must keep it rendered at full size and
// never collapse mid-cycle. RED before the fix: svg shrank 412→282 (boxes to ~0-width via getBBox).
test('flowchart: a valid edit keeps it full-size (no shrink, no collapse, no error)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  await frame
    .locator('.vditor-ir__preview .language-flowchart svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await settle(frame, 1500)

  const before = await measure(frame, 'language-flowchart')
  // eslint-disable-next-line no-console
  console.log(`[monitor flowchart] before ${JSON.stringify(before)}`)
  expect(before.hasSvg).toBe(true)
  expect(before.svg?.h ?? 0).toBeGreaterThan(40)

  await startSampling(frame, 'language-flowchart')
  expect(await placeCaretAfter(frame, 'flowchart', 'Start')).toBe(true)
  await workbox.keyboard.type('XYZ', { delay: 40 })
  await settle(frame, 4000)
  const samples = await stopSampling(frame)
  const after = await measure(frame, 'language-flowchart')
  // eslint-disable-next-line no-console
  console.log(
    `[monitor flowchart] after ${JSON.stringify(after)} samples ${JSON.stringify(samples)}`,
  )

  expect(after.hasSvg, 'flowchart lost its svg after edit').toBe(true)
  expect(after.hasError, 'a valid flowchart edit showed an error box').toBe(
    false,
  )
  expect(
    after.svg?.h ?? 0,
    `flowchart shrank after edit: ${before.svg?.h} → ${after.svg?.h}`,
  ).toBeGreaterThanOrEqual(Math.round((before.svg?.h ?? 0) * 0.85))
  expect(
    samples.min,
    `flowchart collapsed mid-edit (min ${samples.min} vs baseline ${before.svg?.h})`,
  ).toBeGreaterThanOrEqual(Math.round((before.svg?.h ?? 0) * 0.5))
})

// 2. SIZE STABILITY — graphviz (control). A non-measuring SVG engine that renders fine while hidden;
// proves the monitor generalises and that the cover-mode change didn't regress the deferred path.
test('graphviz: a valid edit keeps it full-size (no shrink, no collapse, no error)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  await frame
    .locator('.vditor-ir__preview .language-graphviz svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await settle(frame, 1500)

  const before = await measure(frame, 'language-graphviz')
  // eslint-disable-next-line no-console
  console.log(`[monitor graphviz] before ${JSON.stringify(before)}`)
  expect(before.hasSvg).toBe(true)
  expect(before.svg?.h ?? 0).toBeGreaterThan(40)

  await startSampling(frame, 'language-graphviz')
  expect(await placeCaretAfter(frame, 'graphviz', 'alpha')).toBe(true)
  await workbox.keyboard.type('XYZ', { delay: 40 })
  await settle(frame, 4000)
  const samples = await stopSampling(frame)
  const after = await measure(frame, 'language-graphviz')
  // eslint-disable-next-line no-console
  console.log(
    `[monitor graphviz] after ${JSON.stringify(after)} samples ${JSON.stringify(samples)}`,
  )

  expect(after.hasSvg).toBe(true)
  expect(after.hasError).toBe(false)
  expect(
    after.svg?.h ?? 0,
    `graphviz shrank after edit: ${before.svg?.h} → ${after.svg?.h}`,
  ).toBeGreaterThanOrEqual(Math.round((before.svg?.h ?? 0) * 0.85))
  expect(samples.min).toBeGreaterThanOrEqual(
    Math.round((before.svg?.h ?? 0) * 0.5),
  )
})

// 3. ERROR + RECOVER — edit a valid diagram to be INVALID (error box must appear, replacing the live
// svg — not a stale shrunken diagram lingering), then DELETE the garbage so it's valid again and
// assert the diagram re-renders at full size and the error box is gone. Tests the whole error round
// trip through the settle gate, which the open-only error specs never exercised.
test('graphviz: break → error box appears, then recover → re-renders, error gone', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  await frame
    .locator('.vditor-ir__preview .language-graphviz svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await settle(frame, 1500)
  const before = await measure(frame, 'language-graphviz')
  expect(before.hasSvg).toBe(true)

  // break it: type DOT garbage after a node name
  expect(await placeCaretAfter(frame, 'graphviz', 'gamma')).toBe(true)
  const GARBAGE = ' @@@bad'
  await workbox.keyboard.type(GARBAGE, { delay: 40 })
  await frame
    .locator('.vditor-ir__preview .vmarkd-diagram-error')
    .first()
    .waitFor({ timeout: 30_000 })
  const broken = await measure(frame, 'language-graphviz')
  // eslint-disable-next-line no-console
  console.log(`[monitor recover] broken ${JSON.stringify(broken)}`)
  expect(broken.hasError, 'invalid graphviz did not show the error box').toBe(
    true,
  )

  // recover: delete the garbage we typed (caret is right after it) → valid again
  for (let i = 0; i < GARBAGE.length; i++)
    await workbox.keyboard.press('Backspace', { delay: 30 })
  await settle(frame, 4000)
  const recovered = await measure(frame, 'language-graphviz')
  // eslint-disable-next-line no-console
  console.log(`[monitor recover] recovered ${JSON.stringify(recovered)}`)

  expect(
    recovered.hasError,
    'error box lingered after the source was fixed',
  ).toBe(false)
  expect(recovered.hasSvg, 'diagram did not re-render after recovery').toBe(
    true,
  )
  expect(
    recovered.svg?.h ?? 0,
    `recovered graphviz smaller than before: ${before.svg?.h} → ${recovered.svg?.h}`,
  ).toBeGreaterThanOrEqual(Math.round((before.svg?.h ?? 0) * 0.85))
})
