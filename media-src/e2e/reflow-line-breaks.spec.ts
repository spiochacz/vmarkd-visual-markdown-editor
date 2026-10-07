import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'

/**
 * Task 83 (increment 2) — vmarkd.editor.reflowLineBreaks, the Preview half. A soft line break renders
 * as a flowing space (no <br>) in the Preview when the setting is on, and as <br> when it is off; the
 * editable surface and the saved markdown are the same either way. The real-VS-Code twin is
 * test/vscode-e2e/reflow-line-breaks.spec.ts.
 */

const DOC = 'First line\nsecond line\nthird line\n\nA new paragraph.\n'

async function load(page: Page, query: string) {
  await page.goto(`/list.html?md=${encodeURIComponent(DOC)}&${query}`)
  await page.waitForFunction(() => (window as any).__ready === true)
}

async function openPreview(page: Page) {
  await page.evaluate(() => {
    const inst = (window as any).vditor
    const v = inst.vditor
    v.preview.element.style.display = 'block'
    v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
    v.preview.render(v)
  })
  await page.locator('.vditor-preview p').first().waitFor({ timeout: 10_000 })
}

const previewBrs = (page: Page) =>
  page.locator('.vditor-preview p').first().locator('br').count()
const previewText = (page: Page) =>
  page
    .locator('.vditor-preview p')
    .first()
    .evaluate((p) => p.textContent)
const irHtml = (page: Page) =>
  page.evaluate(() => (window as any).vditor.vditor.ir.element.innerHTML)
const getValue = (page: Page) =>
  page.evaluate(() => (window as any).vditor.getValue() as string)

test('setting never applied: the preview keeps stock Lute (soft break -> <br>)', async ({
  page,
}) => {
  await load(page, 'mode=ir')
  await openPreview(page)
  expect(await previewBrs(page)).toBe(2)
})

test('reflow on: the preview paragraph flows (no <br>), the words stay on separate source lines', async ({
  page,
}) => {
  await load(page, 'mode=ir&reflow=1')
  await openPreview(page)
  expect(await previewBrs(page)).toBe(0)
  expect(await previewText(page)).toBe('First line\nsecond line\nthird line')
})

test('reflow off: every source line gets a <br> in the preview', async ({
  page,
}) => {
  await load(page, 'mode=ir&reflow=0')
  await openPreview(page)
  expect(await previewBrs(page)).toBe(2)
})

test('flipping the setting live re-renders the open preview', async ({
  page,
}) => {
  await load(page, 'mode=ir&reflow=1')
  await openPreview(page)
  expect(await previewBrs(page)).toBe(0)
  await page.evaluate(() => (window as any).__applyReflowLineBreaks(false))
  await expect.poll(() => previewBrs(page)).toBe(2)
  await page.evaluate(() => (window as any).__applyReflowLineBreaks(true))
  await expect.poll(() => previewBrs(page)).toBe(0)
})

// Increment 3 decorates the editable surface with marker spans when the setting is on; the DOM
// WITHOUT those spans (and the serialized markdown) must still not depend on the setting.
const SPAN =
  /<span class="vmarkd-softbreak" contenteditable="false">\n<\/span>/g

test('the editable IR surface (minus the marker spans) and the serialized markdown do not depend on the setting', async ({
  page,
}) => {
  const seen: { html: string; value: string }[] = []
  for (const q of ['mode=ir', 'mode=ir&reflow=1', 'mode=ir&reflow=0']) {
    await load(page, q)
    if (q.endsWith('reflow=1'))
      await page.waitForFunction(() =>
        document.querySelector('.vmarkd-softbreak'),
      )
    seen.push({
      html: (await irHtml(page)).replace(SPAN, '\n'),
      value: await getValue(page),
    })
  }
  expect(seen[1]).toEqual(seen[0])
  expect(seen[2]).toEqual(seen[0])
  expect(seen[0].value).toBe(DOC)
  expect(seen[0].html).not.toContain('<br')
})
