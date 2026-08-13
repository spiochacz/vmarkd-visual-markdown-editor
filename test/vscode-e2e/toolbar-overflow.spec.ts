import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { wf } from './webview-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.md')

test('responsive toolbar keeps pinned actions visible and restores overflow by keyboard', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = wf(workbox)
  const toolbar = frame.locator('.vditor-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 45_000 })
  // The sidebar + activity bar eat a fixed slice of the window, so without closing the sidebar a
  // 360px window leaves the webview at width 0 — measured — and the overflow correctly refuses to
  // decide there (the hidden-tab guard). Close it so the window width maps to a real webview width:
  // 700px window ≈ 350px webview, 1400px ≈ 1050px.
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeSidebar')
  })
  await workbox.setViewportSize({ width: 700, height: 800 })
  // The exact count depends on measured widths, so assert the give-way ORDER: emoji is first to go.
  await expect(
    toolbar.locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]:has([data-type="emoji"])',
    ),
  ).toHaveCount(1, { timeout: 10_000 })
  const overlap = await toolbar.evaluate((el) => {
    const more = el.querySelector('.vmarkd-toolbar-more') as HTMLElement
    const moreLeft = more.getBoundingClientRect().left
    const visible = [
      ...el.querySelectorAll(
        ':scope > .vditor-toolbar__item:not(.vmarkd-toolbar-more), :scope > .vditor-toolbar__divider',
      ),
    ].filter((node) => getComputedStyle(node).display !== 'none')
    return (
      Math.max(...visible.map((node) => node.getBoundingClientRect().right)) -
      moreLeft
    )
  })
  // More stays in normal flex flow, so its preceding sibling may touch it but must never overlap.
  expect(overlap).toBeLessThanOrEqual(0)
  const narrow = await toolbar.evaluate((toolbarEl) => {
    const more = toolbarEl.querySelector(
      '.vmarkd-toolbar-more > .vditor-hint',
    ) as HTMLElement
    const moreItem = toolbarEl.querySelector(
      '.vmarkd-toolbar-more',
    ) as HTMLElement
    return {
      emojiInMore: !!more.querySelector('[data-type="emoji"]'),
      // Exact separator accounting keeps the last formatting group in the row while it still fits.
      boldInRow: !!toolbarEl.querySelector(
        ':scope > .vditor-toolbar__item > [data-type="bold"]',
      ),
      pinnedInRow: ['edit-mode', 'preview', 'edit-in-vscode'].every(
        (name) =>
          !!toolbarEl.querySelector(
            `:scope > .vditor-toolbar__item [data-type="${name}"]`,
          ),
      ),
      overflowTabbable: [...more.querySelectorAll('button')].some(
        (button) => button.tabIndex === 0,
      ),
      moreHasPopup: moreItem
        .querySelector(':scope > [data-type]')
        ?.getAttribute('aria-haspopup'),
      // Vditor's own ≤520px rule bumps every item to `padding: 0 12px` exactly when space runs out
      // (index.css:492-494). This asserts our override wins INSIDE the real webview iframe, where
      // the media query resolves against the iframe width rather than the VS Code window.
      moreItemPadding: getComputedStyle(moreItem).paddingLeft,
      // Vditor kills tooltips at the same breakpoint (index.css:249-253); we re-enable them.
      tooltipContent: getComputedStyle(
        toolbarEl.querySelector(
          ':scope > .vditor-toolbar__item > .vditor-tooltipped',
        ) as HTMLElement,
        '::after',
      ).content,
    }
  })
  expect(narrow.emojiInMore).toBe(true)
  expect(narrow.boldInRow).toBe(true)
  expect(narrow.pinnedInRow).toBe(true)
  expect(narrow.overflowTabbable).toBe(true)
  expect(narrow.moreHasPopup).toBe('menu')
  expect(narrow.moreItemPadding).toBe('0px')
  expect(narrow.tooltipContent).not.toBe('none')
  await toolbar.locator('[data-type="more"]').click()
  await expect(
    toolbar.locator(
      '.vmarkd-toolbar-more [data-vmarkd-overflow="true"] [data-type="emoji"] svg > path',
    ),
  ).toHaveCount(1)

  await workbox.setViewportSize({ width: 1400, height: 800 })
  await expect(
    toolbar.locator(
      '.vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]',
    ),
  ).toHaveCount(0, { timeout: 10_000 })
  const order = await toolbar
    .locator(':scope > .vditor-toolbar__item')
    .evaluateAll((items) =>
      items
        .map((item) =>
          item.querySelector(':scope > [data-type]')?.getAttribute('data-type'),
        )
        .filter(Boolean),
    )
  expect(order.indexOf('emoji')).toBeLessThan(order.indexOf('headings'))
  expect(order.indexOf('headings')).toBeLessThan(order.indexOf('bold'))

  await expect(toolbar.locator('[data-type="line"]')).toHaveAttribute(
    'aria-label',
    /Horizontal Rule/,
  )
  await expect(toolbar.locator('[data-type="ordered-list"]')).toHaveAttribute(
    'aria-label',
    /Numbered List/,
  )
  await expect(toolbar.locator('[data-type="redo"]')).toHaveAttribute(
    'aria-label',
    /Shift\+Ctrl\/Cmd\+Z/,
  )
  await expect(toolbar.locator('[data-type="edit-in-vscode"] svg')).toHaveCSS(
    'width',
    '16px',
  )
  await expect(toolbar.locator('[data-type="edit-in-vscode"] svg')).toHaveCSS(
    'height',
    '16px',
  )
  await toolbar.locator('[data-type="more"]').click()
  const morePanel = toolbar.locator('.vmarkd-toolbar-more > .vditor-hint')
  await expect(morePanel).toBeVisible()
  // The panel must open UNDER the dots — unfolding rightwards while there is room, flipping to a
  // right-aligned unfold only at the webview's edge (alignSubmenuPanel, toolbar-submenu-aria.ts).
  // Real-webview net for two defects: `position: static` on `.vmarkd-toolbar-more`
  // (vscode-chrome.css) took the item out of the positioned-ancestor chain, so `--left`'s
  // `right: 0` resolved against the viewport and the menu opened flush with the window's right
  // edge; and Vditor's toggleSubMenu (setToolbar.ts:113) flips on a hardcoded 250px threshold,
  // wider than any of our menus, so it unfolded leftwards with room to spare.
  const anchored = await morePanel.evaluate((open: HTMLElement) => {
    const item = open.parentElement as HTMLElement
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
  const fitsRightwards =
    anchored.itemLeft + (anchored.panelRight - anchored.panelLeft) <=
    anchored.limit
  const anchorOffset = fitsRightwards
    ? Math.abs(anchored.panelLeft - anchored.itemLeft)
    : Math.abs(anchored.panelRight - anchored.itemRight)
  expect(anchorOffset).toBeLessThanOrEqual(1)
  expect(anchored.panelLeft).toBeGreaterThanOrEqual(0)
  expect(anchored.panelRight).toBeLessThanOrEqual(anchored.limit)
  await expect(morePanel.locator('[data-type="settings"]')).toHaveText(
    'Settings',
  )
  await expect(morePanel.locator('[data-type="info"]')).toHaveText(
    'About Vditor',
  )
  await expect(morePanel.locator('[data-type="about"]')).toHaveText(
    'About vMarkd',
  )
})

// Task 504 extension: the stale-open rule now covers the OTHER submenu triggers (emoji/headings/
// edit-mode, toolbar-submenu-aria.ts) — an open panel must not survive an overflow change, or it
// would travel with its item into or out of `more`. Real-webview net for the harness test of the
// same name: emoji's picker is opened INSIDE the more menu, a widen returns emoji to the row, and
// the picker must be closed (not carried back open).
test('an open emoji submenu closes when its item moves between row and more', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = wf(workbox)
  const toolbar = frame.locator('.vditor-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 45_000 })
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeSidebar')
  })
  await workbox.setViewportSize({ width: 700, height: 800 })
  // emoji is first to overflow (same give-way order the test above asserts).
  await expect(
    toolbar.locator(
      '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]:has([data-type="emoji"])',
    ),
  ).toHaveCount(1, { timeout: 10_000 })

  // open more, then emoji's own picker inside it.
  await toolbar.locator('[data-type="more"]').click()
  const emojiItem = toolbar.locator(
    '.vmarkd-toolbar-more > .vditor-hint > .vditor-toolbar__item:has([data-type="emoji"])',
  )
  await emojiItem.locator('[data-type="emoji"]').click()
  const emojiPanel = emojiItem.locator('.vditor-panel')
  await expect(emojiPanel).toBeVisible()

  // widen → emoji returns to the row → the open picker must close, not travel back open.
  await workbox.setViewportSize({ width: 1400, height: 800 })
  await expect(
    toolbar.locator(
      '.vditor-hint > .vditor-toolbar__item[data-vmarkd-overflow="true"]',
    ),
  ).toHaveCount(0, { timeout: 10_000 })
  const emojiPanelInRow = toolbar.locator(
    '.vditor-toolbar > .vditor-toolbar__item:has(> [data-type="emoji"]) .vditor-panel',
  )
  await expect(emojiPanelInRow).toBeHidden()
  await expect(toolbar.locator('[data-type="emoji"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

// Task 492 Phase 5: aria-haspopup/aria-expanded + menu semantics for the toolbar's other three
// submenu triggers, and `upload` as a real button. Kept in its OWN test() rather than appended to
// the one above: that test already opens/closes `more` mid-run, and this phase's verification must
// not be coupled to an unrelated pre-existing flake in that interaction (see the task file's Phase 5
// section — reproduces identically with every Phase 5 file reverted, so it predates this phase). The
// chromium harness (media-src/e2e/toolbar-overflow.spec.ts) covers open/close + keyboard-nav in
// depth; this is the mandatory real-webview smoke check, in the real CSP/custom-editor pipeline.
test('emoji/headings/edit-mode advertise their popup and menu semantics; upload is a real button', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = wf(workbox)
  const toolbar = frame.locator('.vditor-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 45_000 })
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeSidebar')
  })
  await workbox.setViewportSize({ width: 1400, height: 800 })

  for (const name of ['emoji', 'headings', 'edit-mode']) {
    const button = toolbar.locator(`[data-type="${name}"]`)
    await expect(button).toHaveAttribute('aria-haspopup', 'menu')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  }
  await toolbar.locator('[data-type="headings"]').click()
  const headingsPanel = toolbar.locator(
    '.vditor-toolbar__item:has(> [data-type="headings"]) > .vditor-hint',
  )
  await expect(headingsPanel).toBeVisible()
  await expect(headingsPanel).toHaveAttribute('role', 'menu')
  await expect(headingsPanel.locator('[data-tag="h1"]')).toHaveAttribute(
    'role',
    'menuitem',
  )
  await expect(toolbar.locator('[data-type="headings"]')).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  // Every toolbar dropdown appears instantly, emoji included. It is the one Vditor builds as a
  // `.vditor-panel` (Emoji.ts:16) rather than a `.vditor-hint`, and that class carries a bouncy
  // `scale-in` (index.css:285-287) — so the picker popped while its sibling menus did not.
  await toolbar.locator('[data-type="emoji"]').click()
  const emojiPanel = toolbar.locator(
    '.vditor-toolbar__item:has(> [data-type="emoji"]) > .vditor-panel',
  )
  await expect(emojiPanel).toBeVisible()
  await expect(emojiPanel).toHaveCSS('animation-name', 'none')
  await expect(headingsPanel).toHaveCSS('animation-name', 'none')
  await toolbar.locator('[data-type="emoji"]').click()

  // `upload` is a real <button> (esbuild-shared.mjs's patchUploadTagName/patchUploadHiddenInput —
  // MenuItem.ts's div exception dropped, the file input moved to a hidden sibling instead of nested
  // inside it), verified here in the real webview's CSP/custom-editor pipeline, including that it
  // still opens a real OS file picker.
  const uploadButton = toolbar.locator('[data-type="upload"]')
  await expect(uploadButton).toHaveJSProperty('tagName', 'BUTTON')
  await expect(uploadButton.locator('input[type="file"]')).toHaveCount(0)
  const hiddenUploadInput = toolbar.locator(
    '.vditor-toolbar__item:has(> [data-type="upload"]) > input[type="file"]',
  )
  await expect(hiddenUploadInput).toHaveCount(1)
  await expect(hiddenUploadInput).toBeHidden()

  const chooserPromise = workbox.waitForEvent('filechooser')
  await uploadButton.click()
  const chooser = await chooserPromise
  expect(chooser).toBeTruthy()
})
