import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// Task 59 — mermaid diagrams must re-theme on a live color-theme change. Vditor renders a
// diagram to SVG once and never re-runs it, so flipping dark↔light leaves stale colors.
// reRenderMermaid (wired into handleSetTheme) restores each preview's source and re-renders
// with the new theme. We assert the SVG's embedded theme CSS actually changes (ids stripped
// so the comparison reflects colors, not the per-render random id).

// The mermaid SVG embeds a <style> with theme colors; selectors contain a random id, so
// strip it to compare the theme, not the id.
async function themeStyle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const svg = (window as any)
      .__el()
      .querySelector(
        '.vditor-ir__preview .language-mermaid svg',
      ) as SVGElement | null
    const style = svg?.querySelector('style')?.textContent || ''
    return style.replace(/mermaid[A-Za-z0-9_-]+/g, 'ID')
  })
}

test('mermaid re-renders with new theme colors on theme change (task 59)', async ({
  page,
}) => {
  await page.goto('/mermaid.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  // wait for the initial (light) render
  await page.waitForFunction(
    () =>
      !!(window as any)
        .__el()
        .querySelector(
          '.vditor-ir__preview .language-mermaid[data-processed="true"] svg',
        ),
    undefined,
    { timeout: 8000 },
  )
  const light = await themeStyle(page)
  expect(light.length).toBeGreaterThan(0)

  // Watch the LIVE diagram throughout the re-theme: it must never lose its <svg>
  // (offscreen render swaps atomically — an in-place re-render would collapse it to
  // source text, shrinking the doc and scrolling the view to the top — the user bug).
  await page.evaluate(() => {
    ;(window as any).__everEmpty = false
    ;(window as any).__watch = setInterval(() => {
      const live = (window as any)
        .__el()
        .querySelector('.vditor-ir__preview .language-mermaid')
      if (live && !live.querySelector('svg')) (window as any).__everEmpty = true
    }, 1)
  })

  // flip to dark
  await page.evaluate(() => (window as any).__reTheme('dark'))
  await page.waitForFunction(
    () =>
      !!(window as any)
        .__el()
        .querySelector(
          '.vditor-ir__preview .language-mermaid[data-processed="true"] svg',
        ),
    undefined,
    { timeout: 8000 },
  )
  // wait until the embedded theme CSS actually differs from the light one
  await page.waitForFunction(
    (prev) => {
      const svg = (window as any)
        .__el()
        .querySelector(
          '.vditor-ir__preview .language-mermaid svg',
        ) as SVGElement | null
      const s = (svg?.querySelector('style')?.textContent || '').replace(
        /mermaid[A-Za-z0-9_-]+/g,
        'ID',
      )
      return s.length > 0 && s !== prev
    },
    light,
    { timeout: 8000 },
  )
  const dark = await themeStyle(page)
  expect(dark).not.toBe(light) // theme colors changed → diagram re-themed

  const everEmpty = await page.evaluate(() => {
    clearInterval((window as any).__watch)
    return (window as any).__everEmpty
  })
  expect(everEmpty).toBe(false) // live diagram never collapsed → no scroll-to-top

  // the source is intact (re-render didn't clobber the editable code)
  const source = await page.evaluate(
    () =>
      (window as any)
        .__el()
        .querySelector('.vditor-ir__marker--pre code.language-mermaid')
        ?.textContent,
  )
  expect(source).toContain('graph TD')
})
