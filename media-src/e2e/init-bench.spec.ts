import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Init-construction benchmark (tasks/42). Measures `init.construct` — the cost
// of `new Vditor` -> after() — to attribute the ~650ms editor-open time between
// the one-time GopherJS Lute load+eval (cold) and per-document parsing (warm),
// and to test which init options actually move the number.
//
// Skipped in the normal e2e run; opt in with BENCH=1:
//   BENCH=1 npx playwright test init-bench.spec.ts
const RUN = process.env.BENCH === '1'

test.describe('init construction benchmark', () => {
  test.skip(!RUN, 'set BENCH=1 to run the init-construction benchmark')
  test.describe.configure({ timeout: 180_000 })

  async function ready(page: Page) {
    await page.goto('/bench.html')
    await page.waitForFunction(() => (window as any).__ready === true)
  }

  test('cold vs warm + content/option matrix', async ({ page }) => {
    // COLD: first construct on a freshly (re)loaded page — Lute is re-evaluated
    // each page load, mirroring a fresh webview's first editor open.
    const coldDocs = ['empty', 'plain10k', 'math', 'code']
    const cold: Record<string, number> = {}
    for (const doc of coldDocs) {
      await ready(page)
      cold[doc] = await page.evaluate(
        (d) => (window as any).__benchCold({ doc: d }),
        doc,
      )
    }

    // WARM: Lute already resident; median of N constructs per spec.
    await ready(page)
    const specs = [
      { name: 'empty', doc: 'empty' },
      { name: 'plain1k', doc: 'plain1k' },
      { name: 'plain10k', doc: 'plain10k' },
      { name: 'plain50k', doc: 'plain50k' },
      { name: 'headings(~10k)', doc: 'headings' },
      { name: 'code x50', doc: 'code' },
      { name: 'math x50', doc: 'math' },
      { name: 'tables x30', doc: 'tables' },
      { name: 'plain10k +toolbar', doc: 'plain10k', toolbar: 'full' },
      { name: 'plain10k -toolbar', doc: 'plain10k', toolbar: 'none' },
      { name: 'plain10k mode=sv', doc: 'plain10k', mode: 'sv' },
      { name: 'plain10k mode=wysiwyg', doc: 'plain10k', mode: 'wysiwyg' },
    ]
    const warm: { name: string; median: number; runs: number[] }[] =
      await page.evaluate((s) => (window as any).__bench(s, 5), specs)

    const lines: string[] = []
    lines.push('')
    lines.push(
      '=== COLD construct (fresh page; includes 3.8MB Lute load+eval) ===',
    )
    for (const d of coldDocs)
      lines.push(`  ${d.padEnd(14)} ${cold[d].toFixed(1)} ms`)
    lines.push('')
    lines.push('=== WARM construct (Lute resident; median of 5) ===')
    lines.push(`  ${'spec'.padEnd(24)} ${'median'.padStart(9)}   runs`)
    for (const r of warm) {
      lines.push(
        `  ${r.name.padEnd(24)} ${(`${r.median.toFixed(1)}ms`).padStart(9)}   ` +
          r.runs.map((x) => x.toFixed(0)).join('/'),
      )
    }
    lines.push('')
    const report = lines.join('\n')
    // eslint-disable-next-line no-console
    console.log(report)
    test.info().annotations.push({ type: 'benchmark', description: report })

    expect(warm.length).toBe(specs.length)
    expect(cold.empty).toBeGreaterThan(0)
  })
})
