import { expect, test } from './coverage-fixture'

test('moves overflowed items into more and restores their authored order', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)

  await page.setViewportSize({ width: 360, height: 700 })
  await expect(page.locator('.vmarkd-toolbar-more')).toBeVisible()
  // The exact count depends on measured widths, so assert the give-way ORDER instead: emoji (first
  // to go) is in the menu while bold (last to go) is still in the row.
  await expect(
    page.locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]:has([data-type="emoji"])',
    ),
  ).toHaveCount(1, { timeout: 5_000 })
  const narrow = await page.evaluate(() => {
    const toolbar = document.querySelector('.vditor-toolbar') as HTMLElement
    const more = toolbar.querySelector(
      '.vmarkd-toolbar-more > .vditor-hint',
    ) as HTMLElement
    return {
      emojiInMore: !!more.querySelector('[data-type="emoji"]'),
      // bold is last in the give-way order, so it must still be in the row while emoji is not
      boldInRow: !!toolbar.querySelector(
        ':scope > .vditor-toolbar__item > [data-type="bold"]',
      ),
      editModeInRow: !!toolbar.querySelector(
        ':scope > .vditor-toolbar__item [data-type="edit-mode"]',
      ),
      overflowTabbable: [...more.querySelectorAll('button')].some(
        (button) => button.tabIndex === 0,
      ),
      moreExpanded: toolbar
        .querySelector('.vmarkd-toolbar-more > button')
        ?.getAttribute('aria-expanded'),
    }
  })
  expect(narrow.emojiInMore).toBe(true)
  expect(narrow.boldInRow).toBe(true)
  expect(narrow.editModeInRow).toBe(true)
  expect(narrow.overflowTabbable).toBe(true)
  expect(narrow.moreExpanded).toBe('false')

  await page.setViewportSize({ width: 1400, height: 700 })
  await expect(
    page.locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]',
    ),
  ).toHaveCount(0, { timeout: 5_000 })
  const order = await page
    .locator('.vditor-toolbar > .vditor-toolbar__item')
    .evaluateAll((items) =>
      items
        .map((item) =>
          item.querySelector(':scope > [data-type]')?.getAttribute('data-type'),
        )
        .filter(Boolean),
    )
  expect(order.indexOf('emoji')).toBeLessThan(order.indexOf('headings'))
  expect(order.indexOf('headings')).toBeLessThan(order.indexOf('bold'))
})

// Task 504 regression: an open `more` menu is STALE once the overflow set changes — a widen
// returns items to the row, so an open menu shows a layout that no longer exists (the returned
// items vanish from it). The overflow pass must close it so the next click re-opens a menu that
// matches the row. Before this fix the panel was left open across the widen and the second click
// on `more` CLOSED it (Vditor's toggle) instead of reopening it — the toolbar-overflow.spec.ts
// (real VS Code) line-144 flake.
test('closes the more panel when overflow changes, and reopens on the next click', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.setViewportSize({ width: 360, height: 700 })
  await expect(
    page.locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]',
    ),
  ).not.toHaveCount(0, { timeout: 5_000 })

  const moreButton = page.locator('.vmarkd-toolbar-more > [data-type="more"]')
  const panel = page.locator('.vmarkd-toolbar-more > .vditor-hint')

  // first click opens the panel
  await moreButton.click()
  await expect(panel).toBeVisible()
  await expect(moreButton).toHaveAttribute('aria-expanded', 'true')

  // widen → items return to the row → the open panel is stale → the overflow pass closes it
  await page.setViewportSize({ width: 1400, height: 700 })
  await expect(
    page.locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]',
    ),
  ).toHaveCount(0, { timeout: 5_000 })
  await expect(panel).toBeHidden()
  await expect(moreButton).toHaveAttribute('aria-expanded', 'false')

  // second click reopens the (now-consistent) menu
  await moreButton.click()
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-type="settings"]')).toHaveText('Settings')
})

// The menu must open UNDER the dots and unfold RIGHTWARDS while there is room, flipping only at the
// webview's right edge (alignSubmenuPanel, toolbar-submenu-aria.ts). Two separate defects lived
// here: `position: static` on `.vmarkd-toolbar-more` (vscode-chrome.css) took the item out of the
// positioned-ancestor chain, so `--left`'s `right: 0` resolved against the VIEWPORT and the menu
// opened flush with the window edge; and Vditor's own toggleSubMenu (setToolbar.ts:113) applies
// `--left` on a hardcoded 250px-from-the-right threshold — wider than any of our menus — so the
// panel unfolded leftwards even with room to spare.
test('the more menu unfolds rightwards when it fits and flips at the edge', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  const moreButton = page.locator('.vmarkd-toolbar-more > [data-type="more"]')
  const panel = page.locator('.vmarkd-toolbar-more > .vditor-hint')
  const geometry = () =>
    page.evaluate(() => {
      const item = document.querySelector('.vmarkd-toolbar-more') as HTMLElement
      const open = item.querySelector('.vditor-hint') as HTMLElement
      const itemBox = item.getBoundingClientRect()
      const panelBox = open.getBoundingClientRect()
      return {
        itemLeft: itemBox.left,
        itemRight: itemBox.right,
        panelLeft: panelBox.left,
        panelRight: panelBox.right,
        limit: document.documentElement.clientWidth,
      }
    })

  // 940px is the discriminating width: the menu (106px here, nothing overflowed) still fits to the
  // right of More, but the trigger IS within Vditor's hardcoded 250px of the toolbar's right edge,
  // so its own heuristic would have flipped it. This is the reported case — room to spare and the
  // menu still unfolded leftwards.
  await page.setViewportSize({ width: 940, height: 700 })
  await moreButton.click()
  await expect(panel).toBeVisible()
  const roomy = await geometry()
  expect(Math.abs(roomy.panelLeft - roomy.itemLeft)).toBeLessThanOrEqual(1)
  expect(roomy.panelRight).toBeLessThanOrEqual(roomy.limit)

  // narrow enough that More ends up close to the right edge: the panel would run off-screen, so it
  // flips and right-aligns to the trigger instead. Close it first — a resize that does not change
  // the overflow set leaves the panel open, and the click below would then just toggle it shut.
  await moreButton.click()
  await expect(panel).toBeHidden()
  await page.setViewportSize({ width: 700, height: 700 })
  await moreButton.click()
  await expect(panel).toBeVisible()
  const cramped = await geometry()
  // premise: unfolding rightwards from here really would run off-screen (the menu is also WIDER
  // now — it holds the overflowed rows too), so the flip is the only way to keep it on screen
  expect(
    cramped.itemLeft + (cramped.panelRight - cramped.panelLeft),
  ).toBeGreaterThan(cramped.limit)
  expect(Math.abs(cramped.panelRight - cramped.itemRight)).toBeLessThanOrEqual(
    1,
  )
  expect(cramped.panelLeft).toBeGreaterThanOrEqual(0)
})

// Task 504 extension: the same stale-open rule covers the OTHER submenu triggers
// (emoji/headings/edit-mode, toolbar-submenu-aria.ts). An open panel must not survive an overflow
// change — it would travel with its item into or out of `more`. Reproduced here with emoji: its
// nested picker is opened INSIDE the more menu, then a widen returns emoji to the row; the picker
// must be closed (not carried back to the row still open).
test('closes an open emoji submenu when the overflow set changes', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.setViewportSize({ width: 460, height: 700 })
  const emojiItem = page.locator(
    '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item:has([data-type="emoji"])',
  )
  await expect(emojiItem).toHaveCount(1)

  // emoji sits inside the (closed) more menu; open more, then emoji's own picker.
  await page.locator('.vmarkd-toolbar-more > [data-type="more"]').click()
  const morePanel = page.locator('.vmarkd-toolbar-more > .vditor-hint')
  await expect(morePanel).toBeVisible()
  await emojiItem.locator('[data-type="emoji"]').click()
  const nested = emojiItem.locator('.vditor-panel')
  await expect(nested).toBeVisible()

  // widen → emoji returns to the row → overflow set changes → the open picker must close
  await page.setViewportSize({ width: 1400, height: 700 })
  await expect(
    page.locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]',
    ),
  ).toHaveCount(0, { timeout: 5_000 })
  // emoji is back in the row; re-scope to its panel there and assert it did not travel open.
  const nestedInRow = page.locator(
    '.vditor-toolbar > .vditor-toolbar__item:has(> [data-type="emoji"]) .vditor-panel',
  )
  await expect(nestedInRow).toBeHidden()
  await expect(page.locator('[data-type="emoji"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('sweeps widths monotonically and holds steady on a threshold', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)

  const overflowCount = () =>
    page.locator('[data-vmarkd-overflow="true"]').count()

  // Narrowing must never put an item BACK in the row (and widening never take one away): a
  // non-monotonic step is the signature of deciding against a width measured inside the panel.
  const counts: number[] = []
  const total = await page.locator('.vditor-toolbar__item').count()
  for (const width of [1400, 1100, 900, 700, 560, 460, 380, 260, 180]) {
    await page.setViewportSize({ width, height: 700 })
    await page.waitForTimeout(150)
    counts.push(await overflowCount())
    // `more` is the only route to everything else, so it must survive every width…
    await expect(page.locator('.vmarkd-toolbar-more')).toBeVisible()
    // …and nothing may be lost on the way: every item is either in the row or in the menu.
    const inRow = await page
      .locator('.vditor-toolbar > .vditor-toolbar__item')
      .count()
    expect(inRow + counts[counts.length - 1]).toBe(total)
  }
  for (let i = 1; i < counts.length; i++)
    expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])

  // Holding one width produces no further moves — the hysteresis band must absorb a width that
  // lands exactly on a give-way threshold.
  await page.setViewportSize({ width: 700, height: 700 })
  await page.waitForTimeout(200)
  const settled = await overflowCount()
  await page.waitForTimeout(600)
  expect(await overflowCount()).toBe(settled)
})

test('overflowed rows are labelled once and reachable by keyboard', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.setViewportSize({ width: 460, height: 700 })
  await expect(
    page.locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]:has([data-type="emoji"])',
    ),
  ).toHaveCount(1)

  // The panel is display:none until opened, so its rows only enter the a11y tree (and become
  // focusable) once `more` is triggered — from the keyboard, via the focused button.
  const moreButton = page.locator('.vmarkd-toolbar-more > [data-type="more"]')
  await expect(moreButton).toHaveAttribute('aria-expanded', 'false')
  await moreButton.focus()
  await page.keyboard.press('Enter')
  const panel = page.locator('.vmarkd-toolbar-more > .vditor-hint')
  await expect(panel).toBeVisible()
  await expect(moreButton).toHaveAttribute('aria-expanded', 'true')
  await expect(moreButton).toHaveAttribute('aria-haspopup', 'menu')

  // F5's open question: the row label is CSS generated content (`::after { content: attr(aria-label) }`)
  // on a button that already carries that aria-label. aria-label wins the accessible-name computation
  // outright, so the row is announced ONCE — asserted here rather than assumed.
  //
  // Assert that on the accessible NAME, not on raw occurrences of the string: an aria snapshot prints a
  // node's name (`- button "…"`) AND its child text nodes separately, and the visible label IS a child
  // text node (the ::after). Counting the bare string therefore always reads 2 and says nothing about
  // how often the row is announced. The second assertion pins the other half of the same property —
  // visible text identical to the accessible name, i.e. WCAG 2.5.3 Label in Name.
  const emojiLabel = await page
    .locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item [data-type="emoji"]',
    )
    .getAttribute('aria-label')
  const snapshot = await panel.ariaSnapshot()
  const escaped = (emojiLabel ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  expect(
    snapshot.match(new RegExp(`- button "${escaped}"`, 'g'))?.length ?? 0,
    'the row carries the label as its accessible name exactly once',
  ).toBe(1)
  expect(
    snapshot.match(new RegExp(`- text: ${escaped}`, 'g'))?.length ?? 0,
    'the visible label matches the accessible name (WCAG 2.5.3)',
  ).toBe(1)

  // Arrow keys walk the menu rows the same way they walk the row (H-subset of task 492).
  const focusedType = () =>
    page.evaluate(() => document.activeElement?.getAttribute('data-type'))
  await page
    .locator('.vmarkd-toolbar-more > .vditor-hint > * > button')
    .first()
    .focus()
  const first = await focusedType()
  await page.keyboard.press('ArrowDown')
  const second = await focusedType()
  expect(second).not.toBe(first)
  await page.keyboard.press('End')
  const last = await focusedType()
  expect(last).not.toBe(second)
  await page.keyboard.press('Home')
  expect(await focusedType()).toBe(first)
})

test('pinned actions give way last, in the decided order', async ({ page }) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)

  const rowNames = () =>
    page
      .locator('.vditor-toolbar > .vditor-toolbar__item')
      .evaluateAll((items) =>
        items
          .map((item) =>
            item
              .querySelector(':scope > [data-type]')
              ?.getAttribute('data-type'),
          )
          .filter(Boolean),
      )

  // Squeeze the row past the width where even the pinned band fits. The pinned items then give way
  // too — edit-in-vscode → preview → edit-mode — and `more` is the one true absolute (task 492's
  // "no scroll fallback" decision: one mechanism for every width).
  const survivors: string[][] = []
  for (const width of [420, 300, 220, 160]) {
    await page.setViewportSize({ width, height: 700 })
    await page.waitForTimeout(200)
    survivors.push(await rowNames())
    await expect(page.locator('.vmarkd-toolbar-more')).toBeVisible()
  }

  for (const names of survivors) expect(names).toContain('more')
  // Any pinned item still in the row implies every LATER one in the give-way order is too.
  for (const names of survivors) {
    if (names.includes('edit-in-vscode')) {
      expect(names).toContain('preview')
      expect(names).toContain('edit-mode')
    }
    if (names.includes('preview')) expect(names).toContain('edit-mode')
  }
  // The narrowest width sheds at least one pin — otherwise this test proves nothing.
  expect(survivors[survivors.length - 1].length).toBeLessThan(
    survivors[0].length,
  )
})

test('a nested panel opens inside the more menu without a stray arrow', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.setViewportSize({ width: 460, height: 700 })
  const emojiItem = page.locator(
    '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item:has([data-type="emoji"])',
  )
  await expect(emojiItem).toHaveCount(1)

  await page.locator('.vmarkd-toolbar-more > [data-type="more"]').click()
  await expect(
    page.locator('.vmarkd-toolbar-more > .vditor-hint'),
  ).toBeVisible()
  // The nested panel is a .vditor-panel, which Vditor's own `.vditor-hint .vditor-hint` flyout rule
  // does NOT cover — F4. Our added rule has to place it, and the `--arrow` must be gone (Vditor
  // drops that class for genuine level-2 items).
  expect(await emojiItem.locator('.vditor-panel--arrow').count()).toBe(0)

  await emojiItem.locator('[data-type="emoji"]').click()
  const nested = emojiItem.locator('.vditor-panel')
  await expect(nested).toBeVisible()
  const box = await nested.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  // Flown out to a real on-screen position, not stacked at 0/0 or pushed off the edge.
  expect(box?.width ?? 0).toBeGreaterThan(0)
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    (viewport?.width ?? 0) + 1,
  )

  // NOT asserted here: edit-mode nesting. It is the last pin to give way, so it only reaches the
  // menu below ~48px of row — measured — where the panel can no longer even be clicked. A real
  // webview floors around 220px, so that band is unreachable in practice; edit-mode's panel is a
  // .vditor-hint, already placed by Vditor's own nested rule (F4).
})

test('toolbar labels, redo shortcut, and custom icons stay usable', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)

  await expect(page.locator('[data-type="line"]')).toHaveAttribute(
    'aria-label',
    /Horizontal Rule/,
  )
  await expect(page.locator('[data-type="ordered-list"]')).toHaveAttribute(
    'aria-label',
    /Numbered List/,
  )
  await expect(page.locator('[data-type="redo"]')).toHaveAttribute(
    'aria-label',
    /Shift\+Ctrl\/Cmd\+Z/,
  )

  const customIconSizes = await page
    .locator('[data-type="edit-in-vscode"] svg')
    .evaluate((svg) => ({
      width: (svg as SVGElement).getBoundingClientRect().width,
      height: (svg as SVGElement).getBoundingClientRect().height,
    }))
  expect(customIconSizes).toEqual({ width: 16, height: 16 })

  await page.locator('[data-type="more"]').click()
  const panel = page.locator('.vmarkd-toolbar-more > .vditor-hint')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-type="settings"]')).toHaveText('Settings')
  await expect(panel.locator('[data-type="info"]')).toHaveText('About Vditor')
  await expect(panel.locator('[data-type="about"]')).toHaveText('About vMarkd')
})

// Task 492 Phase 5: aria-haspopup/aria-expanded + menu semantics for the toolbar's other three
// submenu triggers (emoji/headings/edit-mode) — the H-subset above only covers `more`.
test('emoji/headings/edit-mode triggers advertise their popup and expose menu semantics', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.setViewportSize({ width: 1400, height: 700 })

  for (const name of ['emoji', 'headings', 'edit-mode']) {
    const button = page.locator(`[data-type="${name}"]`)
    await expect(button).toHaveAttribute('aria-haspopup', 'menu')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  }

  // headings: a plain vditor-hint panel, rows are direct <button>s.
  await page.locator('[data-type="headings"]').click()
  await expect(page.locator('[data-type="headings"]')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  const headingsPanel = page.locator(
    '.vditor-toolbar__item:has(> [data-type="headings"]) > .vditor-hint',
  )
  await expect(headingsPanel).toHaveAttribute('role', 'menu')
  await expect(headingsPanel.locator('[data-tag="h1"]')).toHaveAttribute(
    'role',
    'menuitem',
  )
  // Headings.ts (unlike Emoji's toggleSubMenu) has no "second click closes it" branch — it only
  // closes via hidePanel(subToolbar) when a DIFFERENT subToolbar panel opens, or a row is picked.
  // Verify aria-expanded still mirrors that close path rather than assuming a toggle that isn't
  // there: opening `emoji` closes `headings` behind it (Headings.ts:51 / Emoji's own
  // hidePanel(subToolbar,hint,popover) call).
  await page.locator('[data-type="emoji"]').click()
  await expect(page.locator('[data-type="headings"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )

  // emoji: role=menu goes on the nested .vditor-emojis grid, not the outer arrow panel (the
  // tail tip/link beside it is not a menu row).
  await expect(page.locator('[data-type="emoji"]')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  const emojiItem = page.locator(
    '.vditor-toolbar__item:has(> [data-type="emoji"])',
  )
  await expect(emojiItem.locator('.vditor-emojis')).toHaveAttribute(
    'role',
    'menu',
  )
  await expect(emojiItem.locator('.vditor-panel')).not.toHaveAttribute(
    'role',
    'menu',
  )
  const emojiButtons = emojiItem.locator('.vditor-emojis > button')
  await expect(emojiButtons.first()).toHaveAttribute('role', 'menuitem')

  // …and it opens with no animation, like every sibling menu. Emoji is the one toolbar dropdown
  // Vditor builds as a `.vditor-panel` (Emoji.ts:16); that class carries a bouncy `scale-in`
  // (index.css:285-287) which the `.vditor-hint` menus (more/headings/edit-mode) do not, so the
  // picker used to pop while the others just appeared.
  await expect(emojiItem.locator('.vditor-panel')).toHaveCSS(
    'animation-name',
    'none',
  )
  await expect(headingsPanel).toHaveCSS('animation-name', 'none')

  // emoji DOES use toggleSubMenu (Emoji.ts), so a second click on its own trigger closes it —
  // asserted as the contrasting case to headings above.
  await page.locator('[data-type="emoji"]').click()
  await expect(page.locator('[data-type="emoji"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await page.locator('[data-type="emoji"]').click()

  // Arrow/Home/End walk the emoji grid the same way they walk `more`'s rows (down/right ≡ +1).
  const focusedKey = () =>
    page.evaluate(() => document.activeElement?.getAttribute('data-key'))
  await emojiButtons.first().focus()
  const first = await focusedKey()
  await page.keyboard.press('ArrowDown')
  expect(await focusedKey()).not.toBe(first)
  await page.keyboard.press('End')
  const last = await focusedKey()
  await page.keyboard.press('Home')
  expect(await focusedKey()).toBe(first)
  expect(last).not.toBe(first)
})

// Task 492 Phase 5, Part B: `upload` is now a real <button> (MenuItem.ts's div exception dropped
// via the build-time patch, esbuild-shared.mjs patchUploadTagName) with the `<input type=file>`
// moved to a hidden sibling (patchUploadHiddenInput) instead of nested inside it.
test('upload is a semantic button that still opens a file picker, and disabled state still blocks it', async ({
  page,
}) => {
  await page.goto('/toolbar-overflow.html')
  await page.waitForFunction(() => (window as any).__ready === true)

  const uploadButton = page.locator('[data-type="upload"]')
  await expect(uploadButton).toHaveJSProperty('tagName', 'BUTTON')
  // The file input must NOT be a descendant of the button (that would be invalid nesting and,
  // via input.click()'s bubbling synthetic click, an infinite re-entrant loop into this same
  // listener — see patchUploadHiddenInput's comment in esbuild-shared.mjs).
  await expect(uploadButton.locator('input[type="file"]')).toHaveCount(0)
  const hiddenInput = page.locator(
    '.vditor-toolbar__item:has(> [data-type="upload"]) > input[type="file"]',
  )
  await expect(hiddenInput).toHaveCount(1)
  await expect(hiddenInput).toBeHidden()
  await expect(hiddenInput).toHaveJSProperty('tabIndex', -1)

  const chooserPromise = page.waitForEvent('filechooser')
  await uploadButton.click()
  const chooser = await chooserPromise
  expect(chooser).toBeTruthy()

  // The disabled guard (Upload.ts's own CLASS_MENU_DISABLED check) must still block the click —
  // moving the input out must not have bypassed it.
  await page.evaluate(() => {
    document
      .querySelector('[data-type="upload"]')
      ?.classList.add('vditor-menu--disabled')
  })
  let secondChooserFired = false
  page.once('filechooser', () => {
    secondChooserFired = true
  })
  await uploadButton.click()
  await page.waitForTimeout(200)
  expect(secondChooserFired).toBe(false)
})
