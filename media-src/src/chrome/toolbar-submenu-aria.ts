// Task 492 Phase 5 — completes the toolbar's submenu ARIA beyond the H-subset (Phase 1, which
// built aria-haspopup/aria-expanded for `more` alone — toolbar-overflow.ts). `emoji`, `headings`,
// and `edit-mode` each own a nested panel the same way `more` does (F4,
// tasks/492-toolbar-layout-usability.md): appended as a child of the trigger's OWN item element by
// Vditor's Emoji.ts/Headings.ts/EditMode.ts (toolbar/index.ts for `more`), and toggled via Vditor's
// own toggleSubMenu writing `panel.style.display` directly — there is no other event to hook, hence
// the MutationObserver below (same approach as the H-subset's own).
//
// The panel persists across an overflow move (F2: items are relocated whole, never rebuilt), so
// locating it from the trigger's own current parent — rather than a fixed row position — keeps
// working whether the item currently sits in the row or has been moved into `more`.

export const SUBMENU_TRIGGER_NAMES = [
  'more',
  'emoji',
  'headings',
  'edit-mode',
] as const

/** Find one trigger's own nested panel (F4): the sibling of its button, inside the
 *  `.vditor-toolbar__item` wrapper they share. `toolbarEl.querySelector` walks the whole subtree,
 *  so this resolves correctly whether the item is in the row or inside `more`. */
export function submenuPanel(
  toolbarEl: HTMLElement,
  name: (typeof SUBMENU_TRIGGER_NAMES)[number],
): HTMLElement | null {
  const button = toolbarEl.querySelector(`[data-type="${name}"]`)
  if (!(button instanceof HTMLElement)) return null
  const item = button.parentElement
  if (!item) return null
  const panel = Array.from(item.children).find(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el !== button &&
      (el.classList.contains('vditor-hint') ||
        el.classList.contains('vditor-panel')),
  )
  return panel ?? null
}

/** The scope actually holding the actionable rows. Only `emoji` nests them a level deeper, inside
 *  `.vditor-emojis` — a sibling of `.vditor-emojis__tail` (a footer tip/link, not a menu item;
 *  Emoji.ts). `headings`/`edit-mode`/`more` have no such wrapper: the panel's direct children ARE
 *  the rows. */
function menuScope(panel: HTMLElement): HTMLElement {
  const grid = panel.querySelector(':scope > .vditor-emojis')
  return grid instanceof HTMLElement ? grid : panel
}

/** One row's actionable button. `more`'s rows wrap it in a bare `<div>` (F1's level-2 shape,
 *  MenuItem.ts:22); `headings`/`edit-mode`/the emoji grid have the `<button>` as the direct child
 *  already. A divider row (e.g. `more`'s `both` separator) has neither and is filtered out by the
 *  caller. */
function menuRowButton(child: Element): HTMLElement | null {
  if (child instanceof HTMLElement && child.tagName === 'BUTTON') return child
  const nested = child.firstElementChild
  return nested instanceof HTMLElement && nested.tagName === 'BUTTON'
    ? nested
    : null
}

/** Every actionable row inside one open panel, in DOM order. Shared by the keyboard navigation
 *  (escape-toolbar.ts) and the role assignment below. */
export function submenuMenuItems(panel: HTMLElement): HTMLElement[] {
  return Array.from(menuScope(panel).children)
    .map(menuRowButton)
    .filter((el): el is HTMLElement => el !== null)
}

/** Shared by `more`'s own trigger (toolbar-overflow.ts) and the three triggers this module installs:
 *  `aria-haspopup` is static, `aria-expanded` mirrors the panel's `display` — Vditor's own
 *  toggleSubMenu/hidePanel write that directly, so a MutationObserver on `style` is the only hook. */
export function updateSubmenuExpanded(
  button: HTMLElement,
  panel: HTMLElement,
): void {
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute(
    'aria-expanded',
    panel.style.display === 'block' ? 'true' : 'false',
  )
}

/** Decide which way an OPEN top-level dropdown unfolds, replacing Vditor's fixed heuristic:
 *  toggleSubMenu (setToolbar.ts:113) tags a panel `vditor-panel--left` (`right: 0`, so it unfolds
 *  leftwards) whenever its trigger sits within a hardcoded 250px of the toolbar's right edge —
 *  wider than any of our menus, so `more` (always the last item) unfolded leftwards even with room
 *  to spare on its right. Measure instead: keep the natural left-aligned unfold, and flip only when
 *  the panel would actually run past the webview's right edge.
 *
 *  Only top-level dropdowns (panel's item is a direct child of the toolbar row) are re-decided. A
 *  panel belonging to an overflowed item is a SIDE flyout inside the more menu, where `--left`
 *  means `right: 100%` instead (vscode-chrome.css) — a different axis, left to Vditor. */
export function alignSubmenuPanel(panel: HTMLElement): void {
  const item = panel.parentElement
  if (!item?.parentElement?.classList.contains('vditor-toolbar')) return
  if (panel.style.display !== 'block') return
  const width = panel.getBoundingClientRect().width
  const { left } = item.getBoundingClientRect()
  const overflowsRight = left + width > document.documentElement.clientWidth
  panel.classList.toggle('vditor-panel--left', overflowsRight)
}

/** Close every open toolbar submenu panel (`more` + `emoji`/`headings`/`edit-mode`). The overflow
 *  pass (toolbar-overflow.ts) calls this whenever the overflow set changes: the layout each open
 *  panel describes is then stale — the more menu would show items that already returned to the row,
 *  and an open emoji/headings/edit-mode panel would travel with its item into or out of `more`.
 *  Each trigger's own MutationObserver (see installToolbarSubmenuAria below) then mirrors the
 *  display back to `aria-expanded="false"`. */
export function closeSubmenuPanels(toolbarEl: HTMLElement): void {
  for (const name of SUBMENU_TRIGGER_NAMES) {
    const panel = submenuPanel(toolbarEl, name)
    if (panel) panel.style.display = 'none'
  }
}

const ARIA_TRIGGER_NAMES = ['emoji', 'headings', 'edit-mode'] as const

/** Install `aria-haspopup`/`aria-expanded` (mirroring the H-subset's `more` trigger,
 *  toolbar-overflow.ts) plus `role="menu"`/`role="menuitem"` on the `emoji`, `headings`, and
 *  `edit-mode` submenu panels — Phase 5 of tasks/492-toolbar-layout-usability.md. `more`'s own panel
 *  is deliberately left alone here: it predates this module, already has its aria-expanded half
 *  wired in toolbar-overflow.ts, and adding role="menu" to it was not part of what Phase 5 asked
 *  for (only "the OTHER three submenu triggers"). */
export function installToolbarSubmenuAria(toolbarEl: HTMLElement): () => void {
  const observers: MutationObserver[] = []
  for (const name of ARIA_TRIGGER_NAMES) {
    const button = toolbarEl.querySelector(`[data-type="${name}"]`)
    const panel = submenuPanel(toolbarEl, name)
    if (!(button instanceof HTMLElement) || !panel) continue

    menuScope(panel).setAttribute('role', 'menu')
    for (const item of submenuMenuItems(panel))
      item.setAttribute('role', 'menuitem')

    updateSubmenuExpanded(button, panel)
    const observer = new MutationObserver(() => {
      updateSubmenuExpanded(button, panel)
      alignSubmenuPanel(panel)
    })
    observer.observe(panel, { attributes: true, attributeFilter: ['style'] })
    observers.push(observer)
  }
  return () => {
    for (const observer of observers) observer.disconnect()
  }
}
