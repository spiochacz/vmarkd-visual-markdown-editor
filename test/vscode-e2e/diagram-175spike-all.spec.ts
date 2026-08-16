import { wf } from './webview-helpers'
import { expect, test } from 'vscode-test-playwright'
import path from 'node:path'

// SPIKE MEASUREMENT (task 175 prototype) — answers "how do OTHER diagram engines behave with the
// fence-spin skip?". The skip is engine-agnostic (it fires for any inert insertText in a
// `.vditor-ir__marker--pre` source), but engines render on different paths: vditor-native
// (mermaid/graphviz/echarts/flowchart via processCodeRender) vs custom-observer (d2/stl via
// observeCustomDiagrams). Per engine, in ONE open: measure typing-phase blocking with the skip OFF
// (baseline) then ON, and assert the char reaches the source + the render survives/re-renders on settle.
const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-edit.md')
const ENGINES = ['d2', 'mermaid', 'graphviz', 'echarts', 'flowchart', 'stl']

// place caret at the end of the `zzz…` identifier in this engine's IR source
async function placeCaret(
  frame: ReturnType<typeof wf>,
  lang: string,
): Promise<boolean> {
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  return frame.locator('body').evaluate((_b, l) => {
    const node = document
      .querySelector(`.language-${l}`)
      ?.closest('.vditor-ir__node') as HTMLElement | null
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
    // place RIGHT AFTER 'zzz' (not at the text-node end — some engines have trailing content like
    // `}` / `" }` on the same node, which would land the caret in the wrong spot).
    const idx = (target.textContent ?? '').lastIndexOf('zzz') + 3
    const r = document.createRange()
    r.setStart(target, idx)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    source.focus()
    return true
  }, lang)
}

async function startSampler(frame: ReturnType<typeof wf>, on: boolean) {
  await frame.locator('body').evaluate((_b, flag) => {
    const w = window as unknown as Record<string, any>
    w.__vmarkdFastDiagramEdit = flag
    w.__b = { blockingMs: 0, maxGapMs: 0 }
    w.__bRun = true
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      const gap = now - last
      last = now
      if (gap > 20) {
        w.__b.blockingMs += gap - 16.7
        if (gap > w.__b.maxGapMs) w.__b.maxGapMs = gap
      }
      if (w.__bRun) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, on)
}
const stopSampler = (frame: ReturnType<typeof wf>) =>
  frame.locator('body').evaluate(() => {
    const w = window as unknown as Record<string, any>
    w.__bRun = false
    return { blockingMs: w.__b.blockingMs, maxGapMs: w.__b.maxGapMs }
  }) as Promise<{ blockingMs: number; maxGapMs: number }>

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

for (const lang of ENGINES) {
  test(`175 spike across engines: ${lang}`, async ({ workbox }) => {
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await frame
      .locator(`.language-${lang} svg, .language-${lang} canvas`)
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {
        // Best-effort wait — some engines (WebGL/STL) don't visibly render in
        // headless; proceed and let the render-cost sampling below reflect
        // whatever painted rather than hard-failing on the wait.
      })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

    // BASELINE burst (skip OFF)
    expect(await placeCaret(frame, lang), `caret ${lang}`).toBe(true)
    await startSampler(frame, false)
    await workbox.keyboard.type('s'.repeat(8), { delay: 60 })
    const off = await stopSampler(frame)
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1800)))

    // 175 burst (skip ON)
    expect(await placeCaret(frame, lang), `caret ${lang} #2`).toBe(true)
    await startSampler(frame, true)
    await workbox.keyboard.type('s'.repeat(8), { delay: 60 })
    const on = await stopSampler(frame)
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

    // correctness: chars in source + a render present after settle
    const post = await frame.locator('body').evaluate((_b, l) => {
      const node = document
        .querySelector(`.language-${l}`)
        ?.closest('.vditor-ir__node')
      const src = node?.querySelector('.vditor-ir__marker--pre')?.textContent
      const render = !!node?.querySelector('svg, canvas')
      return { srcHasS: /zzzs{8,}/.test(src ?? ''), render }
    }, lang)

    const r = (n: number) => Math.round(n)
    // eslint-disable-next-line no-console
    console.log(
      `[175-all] ${lang.padEnd(9)} typing-block OFF=${r(off.blockingMs)}ms (worst ${r(off.maxGapMs)}) → ON=${r(on.blockingMs)}ms (worst ${r(on.maxGapMs)})  · src+s=${post.srcHasS} render=${post.render}`,
    )
    // the skip must not corrupt: the char lands in source (the byte-correct-save invariant), and a
    // render is back after settle. stl renders to a WebGL canvas that does NOT paint under headless
    // xvfb (no GPU) — a pre-existing limitation (see d2-edit-perf.spec), so skip the render check for it.
    expect(post.srcHasS, `${lang}: typed chars missing from source`).toBe(true)
    if (lang !== 'stl') {
      expect(post.render, `${lang}: no render after settle`).toBe(true)
    }
  })
}
