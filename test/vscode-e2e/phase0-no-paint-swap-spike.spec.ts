import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// PHASE 0.3 (task 183 de-risk) — the FOUNDATION of approach C: capturing a render node, letting the
// spin destroy the preview, then re-homing the SAME node before `setRangeByWbr` (all in ONE
// synchronous task in ir/input.ts:185→233 — statically confirmed: no await/yield/paint between) is
// safe because the BROWSER NEVER PAINTS an intermediate empty state within a single task.
//
// This spike proves that structural guarantee empirically in the REAL webview, AND validates the
// detector (so we don't repeat the d2-insert-gap-spike's flawed metric):
//   PART 1: a paint-sampler (rAF chain) records `wrapper.childElementCount` every frame while we
//     (a) SAME-TASK: detach + re-attach the child in ONE rAF callback  → expect emptyFrames === 0
//     (b) CROSS-TASK (control): detach in frame N, re-attach in frame N+2 → expect emptyFrames >= 1
//   If (a)=0 the no-paint guarantee holds; if (b)>=1 the sampler is genuinely able to catch an empty
//   frame (so (a)=0 is meaningful, not a blind detector).
//   PART 2 (characterization): sample the REAL d2 preview wrapper across a live INSERT settle on the
//   current build, reporting bad frames (no svg AND no overlay) + whether the task-161 overlay engaged
//   — documents that today's no-disappear relies on the timing-gated overlay (the fragility task 183
//   replaces with the structural guarantee from PART 1).
const FIXTURE = path.join(__dirname, 'fixtures', 'render-cost-spike.md')

test('SPIKE 0.3: synchronous detach+reattach is never painted empty (capture/re-home foundation)', async ({
  workbox,
  evaluateInVSCode,
}) => {
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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // PART 1 — the structural no-paint proof + detector validation
  const part1 = await frame.locator('body').evaluate(async () => {
    const nextFrame = () =>
      new Promise<void>((res) => requestAnimationFrame(() => res()))
    const sleepFrames = async (n: number) => {
      for (let i = 0; i < n; i++) await nextFrame()
    }
    function makeWrapper(id: string) {
      const d = document.createElement('div')
      d.id = id
      d.style.cssText = 'position:fixed;left:-9999px;width:120px;height:40px'
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      s.setAttribute('width', '120')
      s.setAttribute('height', '40')
      d.appendChild(s)
      document.body.appendChild(d)
      return d
    }

    async function runCase(swapMode: 'same-task' | 'cross-task') {
      const wrap = makeWrapper(`t03-${swapMode}`)
      let empties = 0
      let samples = 0
      let running = true
      const sampler = () => {
        if (!running) return
        samples++
        if (wrap.childElementCount === 0) empties++
        requestAnimationFrame(sampler)
      }
      requestAnimationFrame(sampler)
      await sleepFrames(2) // baseline: sampler should see the svg
      const saved = wrap.firstElementChild as Element
      if (swapMode === 'same-task') {
        await new Promise<void>((res) =>
          requestAnimationFrame(() => {
            wrap.replaceChildren() // detach (preview momentarily empty)
            wrap.appendChild(saved) // re-home — same task, no paint between
            res()
          }),
        )
      } else {
        await new Promise<void>((res) =>
          requestAnimationFrame(() => {
            wrap.replaceChildren()
            res()
          }),
        )
        await sleepFrames(2) // paints happen here with the wrapper empty
        wrap.appendChild(saved)
      }
      await sleepFrames(3)
      running = false
      const final = wrap.childElementCount
      wrap.remove()
      return {
        swapMode,
        emptyFrames: empties,
        samples,
        endedWithChild: final === 1,
      }
    }

    const sameTask = await runCase('same-task')
    const crossTask = await runCase('cross-task')
    return {
      sameTask,
      crossTask,
      foundationHolds: sameTask.emptyFrames === 0 && sameTask.endedWithChild,
      detectorValid: crossTask.emptyFrames >= 1,
    }
  })

  // PART 2 — characterize the REAL d2 INSERT settle on the current build
  // place caret at end of the d2 source
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  await frame.locator('body').evaluate(() => {
    const node = Array.from(
      document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
    ).find((n) => n.querySelector('code.language-d2')) as
      | HTMLElement
      | undefined
    const code = node?.querySelector('.vditor-ir__marker--pre code') as
      | HTMLElement
      | undefined
    if (!code) return
    const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    let n = w.nextNode() as Text | null
    while (n) {
      last = n
      n = w.nextNode() as Text | null
    }
    const tn: Node = last ?? code
    const r = document.createRange()
    r.setStart(tn, tn.nodeType === 3 ? (tn.textContent ?? '').length : 0)
    r.collapse(true)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    node?.focus()
  })

  const part2poll = frame.locator('body').evaluate(async () => {
    const d2Wrapper = () => {
      const node = Array.from(
        document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
      ).find((n) => n.querySelector('code.language-d2'))
      return node?.querySelector('.vditor-ir__preview') as HTMLElement | null
    }
    let badFrames = 0
    let samples = 0
    let overlaySeen = false
    let waited = 0
    while (waited < 2500) {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      waited += 16
      const p = d2Wrapper()
      if (!p) continue
      samples++
      const hasSvg = !!p.querySelector('svg')
      const hasOverlay = !!p.querySelector('.vmarkd-stale-overlay')
      if (hasOverlay) overlaySeen = true
      if (!hasSvg && !hasOverlay) badFrames++
    }
    return { badFrames, samples, overlaySeen }
  })
  await new Promise((r) => setTimeout(r, 30))
  await workbox.keyboard.type(' ', { delay: 0 }) // INSERT (task-175-skipped path)
  const part2 = (await part2poll) as {
    badFrames: number
    samples: number
    overlaySeen: boolean
  }

  // eslint-disable-next-line no-console
  console.log(
    `[phase0.3-no-paint-swap] PART1=${JSON.stringify(part1)}\n  PART2(real d2 insert settle, current build)=${JSON.stringify(part2)}`,
  )
  // eslint-disable-next-line no-console
  console.log(
    `[phase0.3-VERDICT] foundationHolds=${part1.foundationHolds} (same-task swap never painted empty) ` +
      `detectorValid=${part1.detectorValid} (control caught an empty frame) ⇒ capture/re-home is structurally safe. ` +
      `Real d2 settle today: badFrames=${part2.badFrames}/${part2.samples} overlayEngaged=${part2.overlaySeen}.`,
  )
  expect(part1).toBeTruthy()
})
