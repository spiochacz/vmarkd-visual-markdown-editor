import { type EvaluateInVSCode, wf } from './webview-helpers'
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

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
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
  // Give the nested webview iframe PAGE-LEVEL keyboard focus before typing (click the editor's
  // top-left margin, clear of the diagram). placeCaretAfter() only does a DOM-level source.focus();
  // keyboard.type() dispatches to the top Electron window, so without this the keystrokes race the
  // focus and drop non-deterministically. Harness focus fix, not product behaviour.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
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
  // NOT stickySelection here, deliberately (2026-08-15). Its verification waits ~200ms after the
  // write to see whether the editor re-asserts its own caret — and in that window the expanded IR
  // node re-collapses, so the keystrokes land in the rendered preview instead of the source: this
  // spec measured 2/2 green with the plain write and failed both tests through the helper. Editing
  // an expanded IR source has to type IMMEDIATELY after the caret lands.
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

// The engine's editable source text, plus the whole document — the pair that separates an edit that
// landed in the block from one that landed somewhere else entirely.
const sourceAndDoc = (frame: ReturnType<typeof wf>, lang: string) =>
  frame.locator('body').evaluate((_el, cls) => {
    const code = Array.from(
      document.querySelectorAll('.vditor-ir__marker--pre code'),
    ).find((c) => c.className.includes(`language-${cls}`))
    return {
      source: code?.textContent ?? '',
      doc:
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    }
  }, lang)

// Place the caret in an engine's source and type — then CHECK THE OUTCOME, and retry if the text
// went somewhere else.
//
// Why the outcome and not the caret: under 8x`yes` load, 3 of 8 runs typed OUTSIDE the graphviz
// source — the document held the garbage while the block's own source stayed pristine, so no error
// render could ever appear and the spec sat out its 30s wait for one. But the caret cannot be
// checked BEFORE typing either: reading the selection back is a second round trip, and by then the
// expanded node has re-collapsed, so that check said "not in the source" on 7 of 8 runs that would
// have typed just fine. The caret's presence here is genuinely transient; the only honest question
// is whether the SOURCE changed.
//
// Cleanup between attempts is Ctrl+Z until the document no longer holds the text — a miss means the
// keystrokes landed in an unknown block, where Backspace would eat the wrong characters.
async function typeIntoSource(
  frame: ReturnType<typeof wf>,
  workbox: import('@playwright/test').Page,
  lang: string,
  anchor: string,
  text: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await placeCaretAfter(frame, lang, anchor)
    await workbox.keyboard.type(text, { delay: 40 })
    const { source } = await sourceAndDoc(frame, lang)
    if (source.includes(text.trim())) {
      // A retry that succeeds must still leave a trace. Silently absorbing misses is how a retry
      // loop turns a PRODUCT problem ("keystrokes stopped reaching the editor") into a green run —
      // this line means the full-suite log shows how often it is happening, instead of nothing.
      if (attempt > 0)
        // eslint-disable-next-line no-console
        console.log(
          `[typeIntoSource] ${lang}: took ${attempt + 1} attempts to land ${JSON.stringify(text)}`,
        )
      return
    }
    for (let undo = 0; undo < 8; undo++) {
      const { doc } = await sourceAndDoc(frame, lang)
      if (!doc.includes(text.trim())) break
      await workbox.keyboard.press('Control+z')
      await settle(frame, 200)
    }
  }
  throw new Error(
    `typeIntoSource: ${JSON.stringify(text)} never reached the ${lang} source after 3 attempts — the keystrokes are landing in another block, so the diagram cannot react to them`,
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
  await typeIntoSource(frame, workbox, 'flowchart', 'Start', 'XYZ')
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
  test.setTimeout(180_000)
  const frame = await open(workbox, evaluateInVSCode)
  await frame
    .locator('.vditor-ir__preview .language-graphviz svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await settle(frame, 1500)

  const before = await measure(frame, 'language-graphviz')
  // eslint-disable-next-line no-console
  console.log(`[monitor graphviz] before ${JSON.stringify(before)}`)
  expect.soft(before.hasSvg).toBe(true)
  expect.soft(before.svg?.h ?? 0).toBeGreaterThan(40)

  await startSampling(frame, 'language-graphviz')
  await typeIntoSource(frame, workbox, 'graphviz', 'alpha', 'XYZ')
  await settle(frame, 4000)
  const samples = await stopSampling(frame)
  const after = await measure(frame, 'language-graphviz')
  // eslint-disable-next-line no-console
  console.log(
    `[monitor graphviz] after ${JSON.stringify(after)} samples ${JSON.stringify(samples)}`,
  )

  expect.soft(after.hasSvg).toBe(true)
  expect.soft(after.hasError).toBe(false)
  expect
    .soft(
      after.svg?.h ?? 0,
      `graphviz shrank after edit: ${before.svg?.h} → ${after.svg?.h}`,
    )
    .toBeGreaterThanOrEqual(Math.round((before.svg?.h ?? 0) * 0.85))
  expect
    .soft(samples.min)
    .toBeGreaterThanOrEqual(Math.round((before.svg?.h ?? 0) * 0.5))
  // break it: type DOT garbage after a node name
  const GARBAGE = ' @@@bad'
  await typeIntoSource(frame, workbox, 'graphviz', 'gamma', GARBAGE)
  await frame
    .locator('.vditor-ir__preview .vmarkd-diagram-error')
    .first()
    .waitFor({ timeout: 30_000 })
  const broken = await measure(frame, 'language-graphviz')
  // eslint-disable-next-line no-console
  console.log(`[monitor recover] broken ${JSON.stringify(broken)}`)
  expect
    .soft(broken.hasError, 'invalid graphviz did not show the error box')
    .toBe(true)

  // recover: delete the garbage we typed (caret is right after it) → valid again
  for (let i = 0; i < GARBAGE.length; i++)
    await workbox.keyboard.press('Backspace', { delay: 30 })
  await settle(frame, 4000)
  const recovered = await measure(frame, 'language-graphviz')
  // eslint-disable-next-line no-console
  console.log(`[monitor recover] recovered ${JSON.stringify(recovered)}`)

  expect
    .soft(recovered.hasError, 'error box lingered after the source was fixed')
    .toBe(false)
  expect
    .soft(recovered.hasSvg, 'diagram did not re-render after recovery')
    .toBe(true)
  expect
    .soft(
      recovered.svg?.h ?? 0,
      `recovered graphviz smaller than before: ${before.svg?.h} → ${recovered.svg?.h}`,
    )
    .toBeGreaterThanOrEqual(Math.round((before.svg?.h ?? 0) * 0.85))
})
