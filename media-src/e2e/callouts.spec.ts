import { test, expect } from './coverage-fixture'

// Task 106 — applyCallouts turns `[!TYPE]` blockquotes into dual-nodes: tags them `vditor-ir__node`
// (so Vditor's expandMarker drives the source⇄preview swap), injects a non-editable
// `.vditor-ir__preview` render (title + body, Lute-ignored), and leaves the editable source intact
// so the markdown round-trips. (The visibility swap itself is tested in callout-ir.spec.ts.)

test.beforeEach(async ({ page }) => {
  await page.goto('/callouts.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.evaluate(() => (window as any).__apply())
})

test('a [!NOTE] blockquote becomes a dual-node callout (tag + attrs)', async ({
  page,
}) => {
  const bq = page.locator('#note')
  await expect(bq).toHaveAttribute('data-callout', 'note')
  await expect(bq).toHaveAttribute('data-callout-title', 'Note')
  await expect(bq).toHaveClass(/vmarkd-callout--note/)
  await expect(bq).toHaveClass(/vditor-ir__node/) // Vditor manages expand on this
})

test('a non-editable preview is injected (title + body) and Lute will ignore it', async ({
  page,
}) => {
  const preview = page.locator('#note .vmarkd-callout__preview')
  await expect(preview).toHaveCount(1)
  await expect(preview).toHaveAttribute('contenteditable', 'false')
  await expect(preview).toHaveClass(/vditor-ir__preview/) // Lute ignores this subtree
  await expect(preview.locator('.vmarkd-callout__title')).toHaveText('Note')
  // body holds the rendered body WITHOUT the marker line
  await expect(preview.locator('.vmarkd-callout__body')).toContainText(
    'Body of the note.',
  )
  await expect(preview.locator('.vmarkd-callout__body')).not.toContainText(
    '[!NOTE]',
  )
})

test('the editable source is left intact (markdown round-trips)', async ({
  page,
}) => {
  // the original <p> with the raw marker stays in the DOM (outside the preview) for Lute to read
  const srcText = await page.locator('#note').evaluate((el) => {
    const p = el.querySelector(':scope > p')
    return p?.textContent ?? ''
  })
  expect(srcText).toContain('[!NOTE]')
  expect(srcText).toContain('Body of the note.')
})

test('captures an explicit title', async ({ page }) => {
  await expect(page.locator('#warning')).toHaveAttribute(
    'data-callout',
    'warning',
  )
  await expect(
    page.locator('#warning .vmarkd-callout__preview .vmarkd-callout__title'),
  ).toHaveText('Careful')
})

test('foldable [!tip]- is marked collapsed', async ({ page }) => {
  const bq = page.locator('#fold')
  await expect(bq).toHaveAttribute('data-callout', 'tip')
  await expect(bq).toHaveAttribute('data-callout-foldable', 'closed')
})

test('a normal blockquote is left untouched (no tag, no preview)', async ({
  page,
}) => {
  await expect(page.locator('#plain')).not.toHaveAttribute('data-callout', /.*/)
  await expect(page.locator('#plain')).not.toHaveClass(/vditor-ir__node/)
  await expect(page.locator('#plain .vmarkd-callout__preview')).toHaveCount(0)
  await expect(page.locator('#plain')).toContainText('Just a normal quote.')
})

test('the callout box is styled (left border + tinted background)', async ({
  page,
}) => {
  const styles = await page.locator('#note').evaluate((el) => {
    const s = getComputedStyle(el)
    return { border: s.borderLeftWidth, bg: s.backgroundColor }
  })
  expect(parseFloat(styles.border)).toBeGreaterThan(0)
  expect(styles.bg).not.toBe('rgba(0, 0, 0, 0)') // has a tint
})
