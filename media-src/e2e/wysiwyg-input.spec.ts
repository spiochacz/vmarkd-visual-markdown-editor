import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

/**
 * E2e for content-based paste code detection (task 63 / upstream PR #1921),
 * against the PATCHED `processPasteCode` (harness imports it from vditor source, so
 * the fixProcessCode esbuild patch applies). The bug: pasted markdown-with-HTML
 * (#1917) or math (#1914) was forced into a code block by IDE-marker heuristics.
 * Fixed: a <pre> is code only if it has a <code> child or the text looks like code.
 */
async function goto(page: Page) {
  await page.goto('/wysiwyg-input.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

function paste(page: Page, html: string, text: string) {
  return page.evaluate(
    ({ html, text }) =>
      (window as any).__processPasteCode(html, text, 'wysiwyg'),
    { html, text },
  )
}

test.describe('processPasteCode — content-based detection', () => {
  test('markdown-with-HTML in a bare <pre> is NOT forced to a code block (#1917)', async ({
    page,
  }) => {
    await goto(page)
    const text = '<div>inline html tag</div>\n\n- item'
    const result = await paste(page, `<pre>${text}</pre>`, text)
    expect(result).toBe(false)
  })

  test('a single normal sentence in a classed <pre> is NOT code (#1914-style)', async ({
    page,
  }) => {
    await goto(page)
    const text = 'just a normal sentence'
    const result = await paste(
      page,
      `<pre class="language-js">${text}</pre>`,
      text,
    )
    expect(result).toBe(false)
  })

  test('a real <pre><code> block IS still detected as code', async ({
    page,
  }) => {
    await goto(page)
    const text = 'const a = 1;\nconsole.log(a);'
    const result = await paste(page, `<pre><code>${text}</code></pre>`, text)
    expect(typeof result).toBe('string')
    expect(result).toContain('data-type="code-block"')
  })

  test('code-looking content (keywords + braces, multi-line) IS detected as code', async ({
    page,
  }) => {
    await goto(page)
    const text = 'const a = 1;\nif (a) {\n  console.log(a);\n}'
    const result = await paste(page, `<pre>${text}</pre>`, text)
    expect(typeof result).toBe('string')
    expect(result).toContain('data-type="code-block"')
  })
})
