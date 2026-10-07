import { test, expect } from './coverage-fixture'

// Task 528 — the three Vditor 3.11.3 neutralisations, proven against a real Vditor in chromium:
//   (a) native callouts stay OFF: our `blockquote[data-callout]` DOM and byte-identical getValue()
//   (b) the native WaveDrom renderer is a no-op: ONE svg, rendered by our engine, no error box
//   (c) the HR toolbar button still yields `---` (no patch needed, see the NOTE below)

const open = async (
  page: import('@playwright/test').Page,
  mode: string,
  md: string,
) => {
  await page.goto(
    `/vditor-upgrade.html?mode=${mode}&md=${encodeURIComponent(md)}`,
  )
  await page.waitForFunction(() => (window as any).__ready === true)
}

const CALLOUTS = [
  '> [!NOTE]\n> Body\n',
  '> [!TIP] Custom title\n> Body\n',
  '> [!WARNING]-\n> Folded body\n',
]

for (const mode of ['ir', 'wysiwyg']) {
  for (const md of CALLOUTS) {
    test(`${mode}: ${JSON.stringify(md.split('\n')[0])} keeps OUR callout DOM and bytes`, async ({
      page,
    }) => {
      await open(page, mode, `para\n\n${md}\nafter\n`)
      await page.waitForSelector('blockquote[data-callout]', { timeout: 10000 })
      const info = await page.evaluate(() => {
        const el = (window as any).__el() as HTMLElement
        return {
          ours: el.querySelectorAll('blockquote[data-callout]').length,
          nativeCallout: el.querySelectorAll(
            'blockquote.callout, [data-type="callout"], .vditor-wysiwyg__callout-marker',
          ).length,
          value: (window as any).__getValue() as string,
        }
      })
      expect(info.ours).toBe(1)
      expect(info.nativeCallout).toBe(0)
      // byte-identical: no emoji/title injected, no blank `>` line, marker line untouched
      expect(info.value).toContain(md.trimEnd())
      expect(info.value).not.toMatch(/✏️|⚠️|💡/)
    })
  }
}

const WAVE =
  '```wavedrom\n{ "signal": [{ "name": "clk", "wave": "p......." }] }\n```\n'

for (const mode of ['ir', 'wysiwyg']) {
  test(`${mode}: wavedrom renders exactly once via our engine`, async ({
    page,
  }) => {
    await open(page, mode, `text\n\n${WAVE}`)
    await page.waitForSelector('.language-wavedrom svg', { timeout: 30000 })
    await page.waitForTimeout(1500) // let a competing native render (if any) land
    const info = await page.evaluate(() => {
      const el = (window as any).__el() as HTMLElement
      return {
        svgs: el.querySelectorAll('.language-wavedrom svg').length,
        error: /wavedrom render error/.test(el.textContent || ''),
        nativeScript: document.querySelectorAll(
          'script[src*="wavedrom.min.js?v="]',
        ).length,
      }
    })
    expect(info.svgs).toBe(1)
    expect(info.error).toBe(false)
    expect(info.nativeScript).toBe(0)
  })
}

test('Vditor.preview: native wavedromRender never loads its own bundle', async ({
  page,
}) => {
  await open(page, 'preview', `text\n\n${WAVE}`)
  await page.waitForTimeout(2000)
  const info = await page.evaluate(() => ({
    error: /wavedrom render error/.test(document.body.textContent || ''),
    nativeScript: document.querySelectorAll('script[src*="wavedrom.min.js?v="]')
      .length,
  }))
  expect(info.error).toBe(false)
  expect(info.nativeScript).toBe(0)
})

// NOTE (measured, task 528): HR stays `---` in IR/WYSIWYG WITHOUT any patch (they insert an <hr> node
// and Lute serialises it); the 3.11.3 `line` prefix `***` only reaches SV, where Lute rewrites it anyway.
for (const mode of ['ir', 'wysiwyg']) {
  test(`${mode}: the horizontal-rule toolbar button inserts ---`, async ({
    page,
  }) => {
    await open(page, mode, 'first\n')
    await page.evaluate(() => {
      const el = (window as any).__el() as HTMLElement
      const p = (el.querySelector('p') || el.firstElementChild) as HTMLElement
      const r = document.createRange()
      r.selectNodeContents(p)
      r.collapse(false)
      el.focus()
      const s = window.getSelection()!
      s.removeAllRanges()
      s.addRange(r)
    })
    await page.click(
      '.vditor-toolbar [data-type="line"] button, .vditor-toolbar button[data-type="line"]',
    )
    await page.waitForTimeout(500)
    const value = await page.evaluate(
      () => (window as any).__getValue() as string,
    )
    expect(value).toMatch(/^---\s*$/m)
    expect(value).not.toContain('***')
  })
}
