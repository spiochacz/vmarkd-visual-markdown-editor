import { wf } from './webview-helpers'
// Cross-diagram edit stability (task 189, user report 2026-07-03): editing ONE
// diagram's source must not corrupt ANY other rendered diagram. The preview morph
// (task 187) keeps rendered DOM alive across afterRender passes, which exposed
// non-idempotent Vditor adapters (markmapRender re-rendered its own output on every
// pass → growing svg + stray nodes; user: "kropki pod markmap"). This spec
// fingerprints every diagram family, performs edits (prose + a diagram source) in
// the split view, and asserts every OTHER family's render is unchanged.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
const LANGS = [
  'mermaid',
  'echarts',
  'mindmap',
  'markmap',
  'flowchart',
  'graphviz',
  'plantuml',
  'abc',
  'smiles',
  'wavedrom',
  'nomnoml',
  'd2',
  'vega-lite',
  'geojson',
] as const

interface Fp {
  codeBg: string
  els: number
  svgs: number
  canvases: number
  h: number
  copyBtns: number
  preBg: string
  cls: string
}

const FINGERPRINT = `(() => {
  const pv = document.querySelector('.vditor-preview')
  const out = {}
  for (const lang of ${JSON.stringify(LANGS)}) {
    const els = [...pv.querySelectorAll('.language-' + lang)]
    const first = els[0]
    const pre = first ? first.closest('pre') : null
    out[lang] = {
      els: els.length,
      svgs: pv.querySelectorAll('.language-' + lang + ' svg').length,
      canvases: pv.querySelectorAll('.language-' + lang + ' canvas').length,
      h: Math.round(els.reduce((s, el) => s + el.getBoundingClientRect().height, 0)),
      copyBtns: els.reduce((s, el) => s + (el.closest('pre')?.querySelectorAll('.vditor-copy').length ?? 0), 0),
      preBg: pre ? getComputedStyle(pre).backgroundColor : 'no-pre',
      codeBg: first ? getComputedStyle(first).backgroundColor : 'none',
      cls: first ? (first.closest('pre')?.className ?? '') + ' | ' + first.className : 'none',
    }
  }
  return out
})()`

test('editing one diagram leaves every other family intact (split view)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(300_000)
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
  await frame
    .locator('.vditor-ir .language-d2 svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  await frame.locator('body').evaluate(() => {
    document
      .querySelector('.vditor-toolbar button[data-mode="sv"]')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      )
  })
  // initial split render + engine passes
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 9000)))

  const fp = () =>
    frame
      .locator('body')
      .evaluate(
        (_b, src) => new Function(`return ${src}`)(),
        FINGERPRINT,
      ) as Promise<Record<(typeof LANGS)[number], Fp>>

  // Type INSIDE a given sv source block (caret after the needle text).
  const typeInBlock = async (needle: string, text: string) => {
    // NOT stickySelection: this callback places the Range AND performs the whole edit
    // (execCommand('insertText')) in the same evaluate turn, so there is no window between the
    // write and the keystroke for the editor to revert the caret into — the drift stickySelection
    // guards against can't happen here. Wrapping it in the retry helper instead made an EDIT get
    // retried: measured with an offset probe on 2026-08-16, both call sites ran all 5 attempts,
    // because the post-write selection sits where the insert left it, which equals the pre-write
    // selection on every later attempt, so the helper reads "did not move" and retries. The insert
    // itself didn't repeat — the probe captured the anchor text identical before and after attempt
    // 5, and the document ended up with exactly one insertion — but that was incidental, not
    // guaranteed by the retry, and each wasted attempt paid the 3.5s sleep: ~14s per call, two
    // calls, in a spec that takes 58.8s.
    await frame.locator('body').evaluate(
      async (_b, arg) => {
        const [needleTxt, insert] = arg as [string, string]
        const sv = document.querySelector('.vditor-sv') as HTMLElement
        sv.focus()
        const walker = document.createTreeWalker(sv, NodeFilter.SHOW_TEXT)
        let node: Text | null = null
        while (walker.nextNode()) {
          const t = walker.currentNode as Text
          if (t.textContent?.includes(needleTxt)) {
            node = t
            break
          }
        }
        if (!node) throw new Error(`needle not found: ${needleTxt}`)
        const off =
          (node.textContent ?? '').indexOf(needleTxt) + needleTxt.length
        const r = document.createRange()
        r.setStart(node, off)
        r.collapse(true)
        const sel = getSelection()!
        sel.removeAllRanges()
        sel.addRange(r)
        document.execCommand('insertText', false, insert)
        // preview delay 500 + morph + engine passes
        await new Promise((res) => setTimeout(res, 3500))
      },
      [needle, text] as [string, string],
    )
  }

  const before = await fp()
  console.log(`[cross-edit] before: ${JSON.stringify(before)}`)

  // Every family must have rendered at all before we compare.
  for (const lang of LANGS) expect(before[lang].els, lang).toBeGreaterThan(0)

  // Edit 1: prose (the doc title). Edit 2: INSIDE the echarts source (the user's
  // exact repro). Edit 3: INSIDE the wavedrom source.
  await typeInBlock('All Renderers', ' X')
  const afterProse = await fp()
  await typeInBlock('ECharts demo', '_')
  const afterEcharts = await fp()
  await typeInBlock('"wave": "p', '.')
  const afterWavedrom = await fp()
  console.log(`[cross-edit] after: ${JSON.stringify(afterWavedrom)}`)

  const assertStable = (
    label: string,
    prev: Record<string, Fp>,
    next: Record<string, Fp>,
    editedLang?: string,
  ) => {
    for (const lang of LANGS) {
      if (lang === editedLang) continue
      const a = prev[lang]
      const b = next[lang]
      expect(b.els, `${label}/${lang} element count`).toBe(a.els)
      expect(b.svgs, `${label}/${lang} svg count`).toBe(a.svgs)
      expect(b.canvases, `${label}/${lang} canvas count`).toBe(a.canvases)
      expect(b.copyBtns, `${label}/${lang} copy buttons`).toBe(a.copyBtns)
      // Height stable within 15% (async engines settle slightly differently).
      expect(
        Math.abs(b.h - a.h),
        `${label}/${lang} height drift (${a.h} -> ${b.h})`,
      ).toBeLessThanOrEqual(Math.max(8, a.h * 0.15))
      expect(b.preBg, `${label}/${lang} pre background`).toBe(a.preBg)
      expect(b.codeBg, `${label}/${lang} code background`).toBe(a.codeBg)
    }
  }

  assertStable('prose-edit', before, afterProse)
  assertStable('echarts-edit', afterProse, afterEcharts, 'echarts')
  assertStable('wavedrom-edit', afterEcharts, afterWavedrom, 'wavedrom')

  // Diagram panels must sit on the page (transparent), not the code panel —
  // the user's smiles report. Every rendered family's wrapping <pre> is transparent.
  for (const lang of LANGS) {
    expect(
      afterWavedrom[lang].preBg,
      `${lang} pre transparent (cls: ${afterWavedrom[lang].cls})`,
    ).toMatch(/rgba\(0, 0, 0, 0\)|no-pre/)
    // The diagram ELEMENT itself must be panel-free too — smiles is <code>-wrapped in
    // the Preview pane and kept the inline-code box when the strip rule missed the
    // pre>code form (user screenshot, task 189).
    expect(
      afterWavedrom[lang].codeBg,
      `${lang} element transparent (cls: ${afterWavedrom[lang].cls})`,
    ).toMatch(/rgba\(0, 0, 0, 0\)|none/)
  }
})
