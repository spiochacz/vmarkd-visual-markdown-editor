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
