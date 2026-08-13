// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  SUBMENU_TRIGGER_NAMES,
  alignSubmenuPanel,
  closeSubmenuPanels,
  installToolbarSubmenuAria,
  submenuMenuItems,
  submenuPanel,
} from './toolbar-submenu-aria'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Mirrors the real DOM shapes closely enough for this module (F4/F1 in
 *  tasks/492-toolbar-layout-usability.md): `more`'s rows are `<div><button></div>` (level-2
 *  MenuItem.ts shape), `headings`/`edit-mode` are plain direct `<button>`s (Headings.ts/EditMode.ts),
 *  and `emoji` nests its buttons one level deeper inside `.vditor-emojis`, alongside a non-menu
 *  `.vditor-emojis__tail` sibling (Emoji.ts). */
function buildToolbar() {
  const toolbar = document.createElement('div')
  toolbar.className = 'vditor-toolbar'

  const item = (name: string, panel: HTMLElement) => {
    const wrapper = document.createElement('div')
    wrapper.className = 'vditor-toolbar__item'
    const button = document.createElement('button')
    button.dataset.type = name
    wrapper.append(button, panel)
    return { wrapper, button, panel }
  }

  const morePanel = document.createElement('div')
  morePanel.className = 'vditor-hint vditor-panel--arrow'
  morePanel.innerHTML =
    '<div><button data-type="settings">Settings</button></div>' +
    '<div class="vditor-toolbar__divider"></div>' +
    '<div><button data-type="info">About</button></div>'
  const more = item('more', morePanel)

  const emojiPanel = document.createElement('div')
  emojiPanel.className = 'vditor-panel vditor-panel--arrow'
  emojiPanel.innerHTML =
    '<div class="vditor-emojis">' +
    '<button data-value=":smile: " data-key=":smile:">🙂</button>' +
    '<button data-value=":tada: " data-key=":tada:">🎉</button>' +
    '</div><div class="vditor-emojis__tail"><span class="vditor-emojis__tip"></span></div>'
  const emoji = item('emoji', emojiPanel)

  const headingsPanel = document.createElement('div')
  headingsPanel.className = 'vditor-hint vditor-panel--arrow'
  headingsPanel.innerHTML =
    '<button data-tag="h1">Heading 1</button><button data-tag="h2">Heading 2</button>'
  const headings = item('headings', headingsPanel)

  const editModePanel = document.createElement('div')
  editModePanel.className = 'vditor-hint vditor-panel--arrow'
  editModePanel.innerHTML =
    '<button data-mode="wysiwyg">WYSIWYG</button><button data-mode="ir">IR</button>'
  const editMode = item('edit-mode', editModePanel)

  toolbar.append(
    emoji.wrapper,
    headings.wrapper,
    editMode.wrapper,
    more.wrapper,
  )
  document.body.append(toolbar)
  return { toolbar, more, emoji, headings, editMode }
}

describe('submenuPanel / submenuMenuItems', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('resolves every known trigger to its own nested panel', () => {
    const { toolbar, more, emoji, headings, editMode } = buildToolbar()
    expect(submenuPanel(toolbar, 'more')).toBe(more.panel)
    expect(submenuPanel(toolbar, 'emoji')).toBe(emoji.panel)
    expect(submenuPanel(toolbar, 'headings')).toBe(headings.panel)
    expect(submenuPanel(toolbar, 'edit-mode')).toBe(editMode.panel)
    expect(SUBMENU_TRIGGER_NAMES).toEqual([
      'more',
      'emoji',
      'headings',
      'edit-mode',
    ])
  })

  it('returns null for a trigger the toolbar does not have', () => {
    const { toolbar } = buildToolbar()
    toolbar.querySelector('[data-type="emoji"]')?.remove()
    expect(submenuPanel(toolbar, 'emoji')).toBeNull()
  })

  it('collects more/headings/edit-mode rows from the panel itself, skipping dividers', () => {
    const { more, headings, editMode } = buildToolbar()
    expect(submenuMenuItems(more.panel).map((el) => el.dataset.type)).toEqual([
      'settings',
      'info',
    ])
    expect(
      submenuMenuItems(headings.panel).map((el) => el.dataset.tag),
    ).toEqual(['h1', 'h2'])
    expect(
      submenuMenuItems(editMode.panel).map((el) => el.dataset.mode),
    ).toEqual(['wysiwyg', 'ir'])
  })

  it('collects emoji rows from the nested .vditor-emojis grid, excluding the tail', () => {
    const { emoji } = buildToolbar()
    const items = submenuMenuItems(emoji.panel)
    expect(items.map((el) => el.dataset.key)).toEqual([':smile:', ':tada:'])
    expect(items.every((el) => el.closest('.vditor-emojis__tail'))).toBe(false)
  })
})

describe('closeSubmenuPanels', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('closes every submenu panel, open or not', () => {
    const { toolbar, more, emoji, headings, editMode } = buildToolbar()
    emoji.panel.style.display = 'block'
    headings.panel.style.display = 'block'
    closeSubmenuPanels(toolbar)
    expect(emoji.panel.style.display).toBe('none')
    expect(headings.panel.style.display).toBe('none')
    expect(editMode.panel.style.display).toBe('none')
    expect(more.panel.style.display).toBe('none')
  })

  it('is idempotent and skips a trigger the toolbar does not have', () => {
    const { toolbar, emoji, headings } = buildToolbar()
    toolbar.querySelector('[data-type="emoji"]')?.remove()
    emoji.panel.style.display = 'block'
    headings.panel.style.display = 'block'
    closeSubmenuPanels(toolbar)
    closeSubmenuPanels(toolbar) // second pass must not throw or change anything
    expect(emoji.panel.style.display).toBe('block') // trigger removed → left alone
    expect(headings.panel.style.display).toBe('none')
  })
})

describe('installToolbarSubmenuAria', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('sets aria-haspopup/aria-expanded on emoji/headings/edit-mode, and leaves more alone', () => {
    const { toolbar, more, emoji, headings, editMode } = buildToolbar()
    installToolbarSubmenuAria(toolbar)

    for (const { button } of [emoji, headings, editMode]) {
      expect(button.getAttribute('aria-haspopup')).toBe('menu')
      expect(button.getAttribute('aria-expanded')).toBe('false')
    }
    // Phase 5 scope is explicitly "the OTHER three" — more's own H-subset wiring is
    // toolbar-overflow.ts's job, not this module's.
    expect(more.button.hasAttribute('aria-haspopup')).toBe(false)
    expect(more.button.hasAttribute('aria-expanded')).toBe(false)
  })

  it('marks role=menu on the actionable scope and role=menuitem on each row', () => {
    const { toolbar, emoji, headings, editMode, more } = buildToolbar()
    installToolbarSubmenuAria(toolbar)

    // emoji: role=menu goes on the .vditor-emojis GRID, not the outer panel (the tail is not a
    // menu item and must not be swept into the accessible menu).
    const grid = emoji.panel.querySelector('.vditor-emojis') as HTMLElement
    expect(grid.getAttribute('role')).toBe('menu')
    expect(emoji.panel.getAttribute('role')).toBeNull()
    for (const row of submenuMenuItems(emoji.panel))
      expect(row.getAttribute('role')).toBe('menuitem')

    // headings/edit-mode: the panel itself IS the scope (no wrapper to nest into).
    expect(headings.panel.getAttribute('role')).toBe('menu')
    expect(editMode.panel.getAttribute('role')).toBe('menu')
    for (const row of submenuMenuItems(headings.panel))
      expect(row.getAttribute('role')).toBe('menuitem')

    // more: untouched (see previous test's rationale).
    expect(more.panel.getAttribute('role')).toBeNull()
  })

  it('mirrors aria-expanded when Vditor toggles the panel open/closed', async () => {
    const { toolbar, headings } = buildToolbar()
    installToolbarSubmenuAria(toolbar)

    headings.panel.style.display = 'block'
    await flush()
    expect(headings.button.getAttribute('aria-expanded')).toBe('true')

    headings.panel.style.display = 'none'
    await flush()
    expect(headings.button.getAttribute('aria-expanded')).toBe('false')
  })

  it('stops reacting once disposed', async () => {
    const { toolbar, emoji } = buildToolbar()
    const dispose = installToolbarSubmenuAria(toolbar)
    dispose()

    emoji.panel.style.display = 'block'
    await flush()
    expect(emoji.button.getAttribute('aria-expanded')).toBe('false')
  })

  it('skips a trigger the toolbar does not have without throwing', () => {
    const toolbar = document.createElement('div')
    toolbar.className = 'vditor-toolbar'
    document.body.append(toolbar)
    expect(() => installToolbarSubmenuAria(toolbar)).not.toThrow()
  })
})

/** jsdom has no layout, so every box the decision reads is stubbed explicitly. */
function stubBox(el: HTMLElement, left: number, width: number): void {
  el.getBoundingClientRect = () =>
    ({ left, right: left + width, width }) as DOMRect
}

function stubViewport(width: number): void {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: width,
  })
}

describe('alignSubmenuPanel', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('unfolds rightwards while the panel fits on screen', () => {
    const { more } = buildToolbar()
    more.panel.classList.add('vditor-panel--left')
    more.panel.style.display = 'block'
    stubBox(more.wrapper, 780, 25)
    stubBox(more.panel, 0, 106)
    stubViewport(900)

    alignSubmenuPanel(more.panel)
    expect(more.panel.classList.contains('vditor-panel--left')).toBe(false)
  })

  it('flips to a right-aligned unfold when it would run off the right edge', () => {
    const { more } = buildToolbar()
    more.panel.style.display = 'block'
    stubBox(more.wrapper, 646, 25)
    stubBox(more.panel, 0, 189)
    stubViewport(700)

    alignSubmenuPanel(more.panel)
    expect(more.panel.classList.contains('vditor-panel--left')).toBe(true)
  })

  it('leaves a closed panel and a nested flyout alone', () => {
    const { more, emoji } = buildToolbar()
    stubViewport(900)

    // closed: nothing to place, and its box would measure 0 anyway
    more.panel.classList.add('vditor-panel--left')
    stubBox(more.wrapper, 780, 25)
    stubBox(more.panel, 0, 106)
    alignSubmenuPanel(more.panel)
    expect(more.panel.classList.contains('vditor-panel--left')).toBe(true)

    // overflowed into `more`: `--left` there means `right: 100%` (a side flyout), a different axis
    more.panel.append(emoji.wrapper)
    emoji.panel.style.display = 'block'
    emoji.panel.classList.add('vditor-panel--left')
    stubBox(emoji.wrapper, 10, 25)
    stubBox(emoji.panel, 0, 106)
    alignSubmenuPanel(emoji.panel)
    expect(emoji.panel.classList.contains('vditor-panel--left')).toBe(true)
  })
})
