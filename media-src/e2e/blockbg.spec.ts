import { test, expect } from './coverage-fixture'

// A content theme paints every `pre.vditor-ir__preview` with a code-block panel background. Our
// main.css rule must neutralise it for CUSTOM blocks (mermaid/echarts/diagrams/math) so they sit
// on the page background — while a real CODE block keeps its panel background.

const PANEL = 'rgb(20, 27, 35)' // the simulated content-theme code panel bg
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

test.beforeEach(async ({ page }) => {
  await page.goto('/blockbg.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  // both blocks rendered: mermaid → svg, code → highlighted
  await page.waitForFunction(
    () => {
      const el = (window as any).__el()
      return (
        !!el.querySelector('.vditor-ir__preview .language-mermaid svg') &&
        !!el.querySelector('.vditor-ir__preview code.hljs')
      )
    },
    undefined,
    { timeout: 10000 },
  )
})

test('a custom (mermaid) preview is transparent — sits on the page background', async ({
  page,
}) => {
  const bg = await page.evaluate(() => {
    const div = (window as any)
      .__el()
      .querySelector('.vditor-ir__preview .language-mermaid')
    const pre = div?.closest('.vditor-ir__preview')
    return getComputedStyle(pre).backgroundColor
  })
  expect(bg).toBe(TRANSPARENT)
})

test('code blocks have no diagonal hatch background-image (clean surface)', async ({
  page,
}) => {
  const img = await page.evaluate(() => {
    const code = (window as any)
      .__el()
      .querySelector('.vditor-ir__preview code.hljs')
    return getComputedStyle(code).backgroundImage
  })
  expect(img).toBe('none')
})

test('a real code-block preview keeps the theme panel background', async ({
  page,
}) => {
  const bg = await page.evaluate(() => {
    const code = (window as any)
      .__el()
      .querySelector('.vditor-ir__preview code.hljs')
    const pre = code?.closest('.vditor-ir__preview')
    return getComputedStyle(pre).backgroundColor
  })
  expect(bg).toBe(PANEL)
})

// A COLLAPSED code block (caret outside) must be the SAME height as its rendered output —
// no phantom line boxes above/below from the IR dual-node's pseudo spaces + h:0 markers.
// Otherwise it's ~40px taller than Preview and "jumps" on Edit↔Preview / caret enter-leave.
test('collapsed code block has no phantom height (node ≈ rendered preview)', async ({
  page,
}) => {
  // caret outside → collapsed
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges()
    ;(document.activeElement as HTMLElement)?.blur?.()
  })
  const m = await page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    const node = Array.from(
      el.querySelectorAll<HTMLElement>('.vditor-ir__node'),
    ).find(
      (n) =>
        n.getAttribute('data-type') === 'code-block' &&
        !!n.querySelector('code.language-js'),
    )!
    const pv = node.querySelector('.vditor-ir__preview') as HTMLElement
    const code = pv.querySelector('code.hljs') as HTMLElement
    return {
      expanded: node.classList.contains('vditor-ir__node--expand'),
      delta:
        node.getBoundingClientRect().height - pv.getBoundingClientRect().height,
      codeH: code.getBoundingClientRect().height,
    }
  })
  expect(m.expanded).toBe(false)
  // node height equals the rendered preview height (the ~40px phantom is gone)
  expect(m.delta).toBeLessThan(4)
  // and the render is NOT squished — its 5 lines still take real vertical room
  // (a line-height:0 regression would collapse this to ~20px)
  expect(m.codeH).toBeGreaterThan(60)
})

// On DARK, the IR rendered code must use the hljs `1em` bottom padding — same as its top (and
// as the standalone Preview pane). A dark-only bottom TRIM (the old task-05 9.9px) made the IR
// render ~4px shorter at the bottom than the same block in Preview → a mismatch on Edit↔Preview.
test('dark IR code render has symmetric (1em) vertical padding — matches Preview', async ({
  page,
}) => {
  await page.evaluate(() => {
    document.querySelector('.vditor')?.classList.add('vditor--dark')
  })
  // the real hljs theme paired with material-dark — sets `pre code.hljs { padding: 1em }`
  await page.addStyleTag({
    url: '/vditor/dist/js/highlight.js/styles/atom-one-dark.min.css',
  })
  const pad = await page.evaluate(() => {
    const code = (window as any)
      .__el()
      .querySelector('.vditor-ir__preview code.hljs') as HTMLElement
    const cs = getComputedStyle(code)
    return { top: cs.paddingTop, bottom: cs.paddingBottom }
  })
  // bottom equals top (= 1em) — no dark bottom trim, so it matches the Preview pane
  expect(pad.bottom).toBe(pad.top)
})

// The phantom-removal rule applies to EVERY collapsed dual-node with a `.vditor-ir__preview`
// render — real code AND diagram blocks (mermaid/echarts/math). A custom (mermaid) block shares
// `data-type="code-block"` but has no `code.hljs`; it too must have its node pseudos nulled so
// its collapsed IR height matches the Preview render (verified in the real webview — diagrams
// were ~58px taller in IR before this). Flattening leaves the diagram render intact.
test('phantom-removal rule flattens custom (mermaid) blocks too', async ({
  page,
}) => {
  const afterContent = await page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    const node = Array.from(
      el.querySelectorAll<HTMLElement>('.vditor-ir__node'),
    ).find((n) => !!n.querySelector('.vditor-ir__preview .language-mermaid'))!
    return getComputedStyle(node, '::after').content
  })
  // collapsed → the node's phantom pseudo space is removed (same as real code blocks)
  expect(afterContent).toBe('none')
})
