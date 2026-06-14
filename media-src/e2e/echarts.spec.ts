import { test, expect } from './coverage-fixture'

// Task 89 — ECharts bumped 5.5.1 → 6.1.0 (vendored over Vditor's copy).
// Task 90 — charts follow the content-theme palette, and re-theme live on a theme change.

test.beforeEach(async ({ page }) => {
  await page.goto('/echarts.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  // wait for the chart to render to a non-empty canvas
  await page.waitForFunction(
    () => {
      const el = (window as any)
        .__el()
        .querySelector(
          '.vditor-ir__preview .language-echarts[data-processed="true"] canvas',
        ) as HTMLCanvasElement | null
      return !!el && el.width > 0 && el.height > 0
    },
    undefined,
    { timeout: 10000 },
  )
})

test('renders on the bumped (6.1.0) build with the pinned cache-buster', async ({
  page,
}) => {
  const src = await page.evaluate(() => (window as any).__scriptSrc())
  expect(src).toContain('echarts.min.js?v=6.1.0')
  expect(src).not.toContain('v=5.5.1')
  const version = await page.evaluate(() => (window as any).echarts?.version)
  expect(version).toBe('6.1.0')
})

test('the chart adopts the paired palette background (github-dark)', async ({
  page,
}) => {
  const bg = await page.evaluate(() => (window as any).__bg())
  expect(bg).toBe('#0d1117') // github-dark palette bg
})

test('a content-theme switch re-themes the chart live (task 90)', async ({
  page,
}) => {
  expect(await page.evaluate(() => (window as any).__bg())).toBe('#0d1117')
  await page.evaluate(() =>
    (window as any).__applyTheme('github-light', 'light'),
  )
  await page.waitForFunction(
    () => (window as any).__bg() === '#ffffff',
    undefined,
    { timeout: 10000 },
  )
  expect(await page.evaluate(() => (window as any).__bg())).toBe('#ffffff') // github-light bg
})

test('an explicit gallery theme (macarons) applies its palette', async ({
  page,
}) => {
  await page.evaluate(() =>
    (window as any).__applyTheme('github-dark', 'dark', 'macarons'),
  )
  await page.waitForFunction(
    () => (window as any).__colors()?.[0] === '#2ec7c9',
    undefined,
    { timeout: 10000 },
  )
  const colors = await page.evaluate(() => (window as any).__colors())
  expect(colors[0]).toBe('#2ec7c9') // macarons' first series colour
  // gallery themes omit a background → we back-fill one so the chart isn't transparent
  expect(await page.evaluate(() => (window as any).__bg())).toBe('#ffffff')
})

test('the custom vintage-dark theme: vintage palette on a dark background', async ({
  page,
}) => {
  await page.evaluate(() =>
    (window as any).__applyTheme('auto', 'dark', 'vintage-dark'),
  )
  await page.waitForFunction(
    () => (window as any).__bg() === '#292420',
    undefined,
    { timeout: 10000 },
  )
  const colors = await page.evaluate(() => (window as any).__colors())
  expect(colors[0]).toBe('#d87c7c') // vintage's first series colour
})

test('auto pairs material-dark to vintage colours on the page background', async ({
  page,
}) => {
  await page.evaluate(() =>
    (window as any).__applyTheme('material-dark', 'dark', 'auto'),
  )
  await page.waitForFunction(
    () => (window as any).__bg() === '#282c34', // material-dark page bg (blends in)
    undefined,
    { timeout: 10000 },
  )
  const colors = await page.evaluate(() => (window as any).__colors())
  expect(colors[0]).toBe('#d87c7c') // vintage palette
})

test('auto pairs VS Code Dark 2026 to VS Code chart colours', async ({
  page,
}) => {
  await page.evaluate(() =>
    (window as any).__applyTheme('vscode-dark-2026', 'dark', 'auto'),
  )
  await page.waitForFunction(
    () => (window as any).__bg() === '#121314',
    undefined,
    { timeout: 10000 },
  )
  const colors = await page.evaluate(() => (window as any).__colors())
  expect(colors[0]).toBe('#59a4f9') // VS Code charts.blue (dark)
})

test('explicit light/dark and auto-without-pairing never render transparent', async ({
  page,
}) => {
  // explicit light → a real (white) background, not ECharts' transparent default
  await page.evaluate(() =>
    (window as any).__applyTheme('auto', 'light', 'light'),
  )
  await page.waitForFunction(
    () => (window as any).__bg() === '#ffffff',
    undefined,
    {
      timeout: 10000,
    },
  )
  // explicit dark → a real dark background
  await page.evaluate(() =>
    (window as any).__applyTheme('auto', 'dark', 'dark'),
  )
  await page.waitForFunction(
    () => (window as any).__bg() === '#18181b',
    undefined,
    {
      timeout: 10000,
    },
  )
  // auto + content theme "auto" → follows the VS Code editor background (#1e1e1e in the harness)
  await page.evaluate(() =>
    (window as any).__applyTheme('auto', 'dark', 'auto'),
  )
  await page.waitForFunction(
    () => (window as any).__bg() === '#1e1e1e',
    undefined,
    {
      timeout: 10000,
    },
  )
  // …and the SERIES colours come from VS Code's chart colours (charts-blue first)
  const colors = await page.evaluate(() => (window as any).__colors())
  expect(colors).toEqual([
    '#3794ff', // charts-blue
    '#89d185', // charts-green
    '#d18616', // charts-orange
    '#b180d7', // charts-purple
    '#f14c4c', // charts-red
    '#cca700', // charts-yellow
  ])
})

test('survives repeated theme switches without collapsing or duplicating', async ({
  page,
}) => {
  // The chart re-themes on every switch (no stale colour, no 0×0 blank canvas, no leftover
  // canvases) — guards the "stops working after a few switches" report.
  const seq: [string, 'dark' | 'light', string][] = [
    ['github-light', 'light', '#ffffff'],
    ['github-dark', 'dark', '#0d1117'],
    ['github-light', 'light', '#ffffff'],
    ['github-dark', 'dark', '#0d1117'],
    ['github-light', 'light', '#ffffff'],
  ]
  for (let i = 0; i < seq.length; i++) {
    const [ct, mode, bg] = seq[i]
    await page.evaluate(
      ([c, m]) => (window as any).__applyTheme(c, m),
      [ct, mode],
    )
    await page.waitForFunction((want) => (window as any).__bg() === want, bg, {
      timeout: 10000,
    })
    const dims = await page.evaluate(() => {
      const c = (window as any)
        .__el()
        .querySelector(
          '.vditor-ir__preview .language-echarts canvas',
        ) as HTMLCanvasElement | null
      const all = (window as any)
        .__el()
        .querySelectorAll('.vditor-ir__preview .language-echarts canvas').length
      return { w: c?.width ?? 0, h: c?.height ?? 0, count: all }
    })
    expect(dims.w, `switch ${i + 1} width`).toBeGreaterThan(0)
    expect(dims.h, `switch ${i + 1} height`).toBeGreaterThan(0)
    expect(dims.count, `switch ${i + 1} canvas count`).toBe(1)
  }
})
