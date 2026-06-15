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

test("Obsidian's [!tip]- fold suffix is accepted but IGNORED (renders as a normal callout)", async ({
  page,
}) => {
  const bq = page.locator('#fold')
  await expect(bq).toHaveAttribute('data-callout', 'tip')
  // fold-state support was dropped (overkill at this stage): no foldable attribute,
  // the body stays visible
  await expect(bq).not.toHaveAttribute('data-callout-foldable', /.*/)
  await expect(
    bq.locator('.vmarkd-callout__preview .vmarkd-callout__body'),
  ).toBeVisible()
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

// ── WYSIWYG: non-editable title label + hidden marker; type picker lives in Vditor's popover ──────

test('WYSIWYG callout gets a non-editable title label, NOT the dual-node preview', async ({
  page,
}) => {
  const bq = page.locator('#wy-note')
  await expect(bq).toHaveAttribute('data-callout', 'note')
  await expect(bq).toHaveClass(/vmarkd-callout--note/)
  // no dual-node in WYSIWYG (would duplicate content + add a 2nd scrollbar)
  await expect(bq).not.toHaveClass(/vditor-ir__node/)
  await expect(bq.locator('.vmarkd-callout__preview')).toHaveCount(0)
  // a non-editable title label showing the type
  const title = bq.locator('> .vmarkd-callout__title')
  await expect(title).toHaveCount(1)
  await expect(title).toHaveAttribute('contenteditable', 'false')
  await expect(title).toHaveText('Note')
})

test('WYSIWYG hides the raw marker but keeps it in the source (round-trips)', async ({
  page,
}) => {
  const bq = page.locator('#wy-note')
  // the marker line is wrapped in a hidden, non-editable span…
  const marker = bq.locator('.vmarkd-callout__marker')
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveAttribute('contenteditable', 'false')
  await expect(marker).toBeHidden() // display:none
  // …but the <p>'s textContent still contains the marker, so Lute serializes `> [!NOTE]` unchanged
  const srcText = await bq.evaluate(
    (el) => el.querySelector(':scope > p')?.textContent ?? '',
  )
  expect(srcText).toContain('[!NOTE]')
  expect(srcText).toContain('Body of the note.')
})

test('the popover hook injects a type <select> for a focused callout', async ({
  page,
}) => {
  const popover = await page.evaluate(() => {
    const p = (window as any).__toolbar('wy-note') as HTMLElement
    const sel = p.querySelector('select.vmarkd-callout__type') as
      | HTMLSelectElement
      | undefined
    return {
      selects: p.querySelectorAll('select.vmarkd-callout__type').length,
      value: sel?.value,
      nativeClass: sel?.classList.contains('vditor-input'),
    }
  })
  expect(popover.selects).toBe(1)
  expect(popover.value).toBe('note')
  expect(popover.nativeClass).toBe(true) // styled like the native code-block language field
})

test('changing the popover <select> rewrites the marker type in the source', async ({
  page,
}) => {
  const srcText = await page.evaluate(() => {
    const p = (window as any).__toolbar('wy-note') as HTMLElement
    const sel = p.querySelector(
      'select.vmarkd-callout__type',
    ) as HTMLSelectElement
    sel.value = 'tip'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    const bq = document.getElementById('wy-note') as HTMLElement
    return {
      attr: bq.getAttribute('data-callout'),
      cls: bq.className,
      src: bq.querySelector(':scope > p')?.textContent ?? '',
      title: bq.querySelector(':scope > .vmarkd-callout__title')?.textContent,
    }
  })
  expect(srcText.attr).toBe('tip')
  expect(srcText.cls).toContain('vmarkd-callout--tip')
  expect(srcText.cls).not.toContain('vmarkd-callout--note')
  expect(srcText.src).toContain('[!TIP]')
  expect(srcText.src).not.toContain('[!NOTE]')
  expect(srcText.src).toContain('Body of the note.')
  expect(srcText.title).toBe('Tip')
})

test('a custom title is shown as the label and preserved when the type changes', async ({
  page,
}) => {
  await expect(page.locator('#wy-warning > .vmarkd-callout__title')).toHaveText(
    'Careful',
  )
  const src = await page.evaluate(() => {
    const p = (window as any).__toolbar('wy-warning') as HTMLElement
    const sel = p.querySelector(
      'select.vmarkd-callout__type',
    ) as HTMLSelectElement
    sel.value = 'caution'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    const bq = document.getElementById('wy-warning') as HTMLElement
    return bq.querySelector(':scope > p')?.textContent ?? ''
  })
  expect(src).toContain('[!CAUTION] Careful')
})

test('the popover has a title input that edits the title in the source + label', async ({
  page,
}) => {
  // pre-filled with the existing custom title
  const initial = await page.evaluate(() => {
    const p = (window as any).__toolbar('wy-warning') as HTMLElement
    const input = p.querySelector(
      'input.vmarkd-callout__title-input',
    ) as HTMLInputElement
    return {
      count: p.querySelectorAll('input.vmarkd-callout__title-input').length,
      value: input?.value,
    }
  })
  expect(initial.count).toBe(1)
  expect(initial.value).toBe('Careful')

  // typing a new title rewrites the source marker AND the inline label, keeping the type
  const after = await page.evaluate(() => {
    const p = (window as any).__toolbar('wy-warning') as HTMLElement
    const input = p.querySelector(
      'input.vmarkd-callout__title-input',
    ) as HTMLInputElement
    input.value = 'Heads up'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const bq = document.getElementById('wy-warning') as HTMLElement
    return {
      src: bq.querySelector(':scope > p')?.textContent ?? '',
      label: bq.querySelector(':scope > .vmarkd-callout__title')?.textContent,
    }
  })
  expect(after.src).toContain('[!WARNING] Heads up')
  expect(after.label).toBe('Heads up')

  // clearing the title falls back to the type name in the label, and drops it from the source
  const cleared = await page.evaluate(() => {
    const p = (window as any).__toolbar('wy-warning') as HTMLElement
    const input = p.querySelector(
      'input.vmarkd-callout__title-input',
    ) as HTMLInputElement
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const bq = document.getElementById('wy-warning') as HTMLElement
    return {
      src: bq.querySelector(':scope > p')?.textContent ?? '',
      label: bq.querySelector(':scope > .vmarkd-callout__title')?.textContent,
    }
  })
  expect(cleared.src).toContain('[!WARNING]')
  expect(cleared.src).not.toContain('Heads up')
  expect(cleared.label).toBe('Warning') // default type name
})

test('re-applying is idempotent in WYSIWYG (no duplicate titles/markers)', async ({
  page,
}) => {
  await page.evaluate(() => {
    ;(window as any).__apply()
    ;(window as any).__apply()
  })
  await expect(page.locator('#wy-note > .vmarkd-callout__title')).toHaveCount(1)
  await expect(page.locator('#wy-note .vmarkd-callout__marker')).toHaveCount(1)
})

test('a normal WYSIWYG blockquote gets no title/marker (and no popover select)', async ({
  page,
}) => {
  await expect(page.locator('#wy-plain')).not.toHaveAttribute(
    'data-callout',
    /.*/,
  )
  await expect(page.locator('#wy-plain > .vmarkd-callout__title')).toHaveCount(
    0,
  )
  await expect(page.locator('#wy-plain .vmarkd-callout__marker')).toHaveCount(0)
  const selects = await page.evaluate(
    () =>
      ((window as any).__toolbar('wy-plain') as HTMLElement).querySelectorAll(
        'select',
      ).length,
  )
  expect(selects).toBe(0)
})
