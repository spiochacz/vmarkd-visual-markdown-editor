// Phase 5 (task 492) factored the aria-haspopup/aria-expanded pair out to toolbar-submenu-aria.ts
// so the `emoji`/`headings`/`edit-mode` triggers there can share it instead of re-deriving it.
import {
  alignSubmenuPanel,
  closeSubmenuPanels,
  updateSubmenuExpanded,
} from './toolbar-submenu-aria'

interface OverflowCluster {
  name: string
  width: number
}

export interface OverflowInput {
  available: number
  pinnedWidth: number
  clusters: OverflowCluster[]
}

export interface OverflowResult {
  visible: string[]
  overflowed: string[]
}

const HYSTERESIS_PX = 8

/** Decide which give-way clusters can remain in the toolbar row. */
export function computeOverflow({
  available,
  pinnedWidth,
  clusters,
}: OverflowInput): OverflowResult {
  const names = clusters.map(({ name }) => name)
  if (available <= 0) return { visible: names, overflowed: [] }

  const remaining = Math.max(0, available - pinnedWidth)
  let remainingWidth = clusters.reduce((sum, cluster) => sum + cluster.width, 0)
  const visible: string[] = []
  const overflowed: string[] = []
  for (const cluster of clusters) {
    if (remainingWidth >= remaining + HYSTERESIS_PX) {
      overflowed.push(cluster.name)
      remainingWidth -= cluster.width
    } else {
      visible.push(cluster.name)
    }
  }
  return { visible, overflowed }
}

const CLUSTER_ORDER: readonly string[][] = [
  ['emoji'],
  ['undo', 'redo'],
  ['outline'],
  ['reflow-line-breaks'],
  ['insert-before', 'insert-after'],
  ['outdent', 'indent'],
  ['quote'],
  ['line'],
  ['code', 'inline-code'],
  ['upload'],
  ['table'],
  ['list', 'ordered-list'],
  ['check'],
  ['headings'],
  ['bold', 'italic'],
  ['strike'],
  ['link'],
]

/** A cluster is identified by its first member, so the decision function stays string-keyed without
 *  encoding the member list into the key. */
const clusterMembers = (id: string): readonly string[] =>
  CLUSTER_ORDER.find((names) => names[0] === id) ?? []

/** Give-way order for the pinned band, used only once even the pinned items no longer fit. Any
 *  `.right`-classed item the toolbar grows later (the wiki pair is authored that way,
 *  `toolbar.ts:144-172`) is pinned too and gives way ahead of these — never silently un-droppable,
 *  which would strand `more` off the edge at the narrowest widths. */
const PINNED_ORDER = ['edit-in-vscode', 'preview', 'edit-mode']

/** Every name this module knows how to place. `toolbar.ts` is the sole author of the row, and
 *  nothing links the two lists at compile time — an item added or renamed there would silently stop
 *  overflowing (it would just sit in the row forever). Exported so a unit test can cross-check it
 *  against `createToolbar()` and fail loudly instead. */
export const KNOWN_TOOLBAR_ITEMS: readonly string[] = [
  ...CLUSTER_ORDER.flat(),
  ...PINNED_ORDER,
  'more',
]
const OVERFLOW_MARKER = 'vmarkd-toolbar-overflow-divider'

type RovingRefresh = (toolbar: HTMLElement) => void

interface ToolbarItem {
  name: string
  element: HTMLElement
  tooltipClasses: string[]
}

function directToolbarItems(toolbar: HTMLElement): ToolbarItem[] {
  const items: ToolbarItem[] = []
  for (const child of Array.from(toolbar.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (!child.classList.contains('vditor-toolbar__item')) continue
    const button = child.querySelector(':scope > [data-type]')
    const name = button?.getAttribute('data-type')
    if (!name) continue
    const tooltipClasses =
      button?.className
        .split(/\s+/)
        .filter((className) => className.startsWith('vditor-tooltipped')) ?? []
    items.push({ name, element: child, tooltipClasses })
  }
  return items
}

function rowWidth(item: ToolbarItem): number {
  return Math.ceil(item.element.getBoundingClientRect().width)
}

function itemNamesInCluster(
  items: ToolbarItem[],
  names: string[],
): ToolbarItem[] {
  return names
    .map((name) => items.find((item) => item.name === name))
    .filter((item): item is ToolbarItem => Boolean(item))
}

function setArrowPanel(item: ToolbarItem, moved: boolean): void {
  const panel = Array.from(item.element.children).find(
    (candidate) =>
      candidate.classList.contains('vditor-hint') ||
      candidate.classList.contains('vditor-panel'),
  )
  panel?.classList.toggle('vditor-panel--arrow', !moved)
}

function setOverflowRow(item: ToolbarItem, moved: boolean): void {
  const button = itemButton(item)
  if (!button) return
  for (const className of item.tooltipClasses) {
    button.classList.toggle(className, !moved)
  }
}

function itemButton(item: ToolbarItem): HTMLElement | null {
  const button = item.element.querySelector(':scope > [data-type]')
  return button instanceof HTMLElement ? button : null
}

/** VS Code's webview occasionally leaves a reparented `<use>` blank even though its sprite symbol
 * is present. Menu rows therefore receive the symbol's concrete paths; restoring the row puts its
 * original lightweight `<use>` markup back. */
function inlineOverflowIcon(item: ToolbarItem): void {
  const svg = itemButton(item)?.querySelector(':scope > svg')
  if (!(svg instanceof SVGSVGElement) || svg.dataset.vmarkdOverflowIcon) return
  const use = svg.querySelector(':scope > use')
  const reference = use?.getAttribute('href') ?? use?.getAttribute('xlink:href')
  if (!reference?.startsWith('#')) return
  const symbol = document.querySelector(reference)
  if (!(symbol instanceof SVGElement) || symbol.localName !== 'symbol') return

  svg.dataset.vmarkdOverflowIcon = svg.innerHTML
  const viewBox = symbol.getAttribute('viewBox')
  if (viewBox) svg.dataset.vmarkdOverflowViewBox = viewBox
  svg.setAttribute('viewBox', viewBox ?? '0 0 16 16')
  svg.innerHTML = symbol.innerHTML
}

function restoreOverflowIcon(item: ToolbarItem): void {
  const svg = itemButton(item)?.querySelector(':scope > svg')
  if (!(svg instanceof SVGSVGElement) || !svg.dataset.vmarkdOverflowIcon) return
  svg.innerHTML = svg.dataset.vmarkdOverflowIcon
  svg.removeAttribute('viewBox')
  delete svg.dataset.vmarkdOverflowIcon
  delete svg.dataset.vmarkdOverflowViewBox
}

/** Put a restored item back at its authored index, measured against the row's authored child list
 *  (items AND dividers) captured at install — the live child list shifts as items move, so an index
 *  read from it would drift. */
function authoredInsert(
  toolbar: HTMLElement,
  item: ToolbarItem,
  authoredOrder: readonly HTMLElement[],
): void {
  const next = authoredOrder
    .slice(authoredOrder.indexOf(item.element) + 1)
    .find((sibling) => sibling.parentElement === toolbar)
  toolbar.insertBefore(item.element, next ?? null)
}

/** Hide a divider whose group has gone: one with no visible item on either side would otherwise
 *  leave the row starting, ending, or double-broken by a stray rule. */
function updateSeparators(
  authoredOrder: readonly HTMLElement[],
  overflowed: ReadonlySet<string>,
): void {
  const isItem = (el: HTMLElement) =>
    el.classList.contains('vditor-toolbar__item')
  const name = (el: HTMLElement) =>
    el.querySelector(':scope > [data-type]')?.getAttribute('data-type') ?? ''
  // `more` never counts as content: a divider whose only neighbour is the menu itself is dangling.
  const visibleItem = (el: HTMLElement) =>
    isItem(el) && !overflowed.has(name(el)) && name(el) !== 'more'

  const isDivider = (el: HTMLElement) =>
    el.classList.contains('vditor-toolbar__divider')
  // Only the ADJACENT groups matter: looking further out would keep a divider alive because some
  // distant group survived, which is how you end up with two rules side by side.
  const runHasVisible = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < authoredOrder.length; i += step) {
      const el = authoredOrder[i]
      if (isDivider(el)) return false
      if (visibleItem(el)) return true
    }
    return false
  }

  authoredOrder.forEach((child, index) => {
    if (!isDivider(child)) return
    const keep = runHasVisible(index - 1, -1) && runHasVisible(index + 1, 1)
    child.style.display = keep ? '' : 'none'
  })
}

/** Install responsive toolbar reparenting. The observer watches a stable ancestor, never the row. */
export function installToolbarOverflow(
  toolbar: HTMLElement,
  refreshRoving: RovingRefresh,
): () => void {
  const moreItem = directToolbarItems(toolbar).find(
    (item) => item.name === 'more',
  )
  const morePanel = moreItem?.element.querySelector(':scope > .vditor-hint')
  const moreButton = moreItem ? itemButton(moreItem) : null
  // No "more" item configured on this toolbar — nothing to reparent, so
  // hand back a no-op unsubscribe rather than forcing callers to null-check.
  if (!moreItem || !(morePanel instanceof HTMLElement) || !moreButton)
    return () => {
      /* no-op disposer */
    }

  moreItem.element.classList.add('vmarkd-toolbar-more')
  const items = directToolbarItems(toolbar).filter(
    (item) => item.name !== 'more',
  )
  const authoredOrder = Array.from(toolbar.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  const marker = document.createElement('div')
  marker.className = `vditor-toolbar__divider ${OVERFLOW_MARKER}`
  // A `.right`-classed item the toolbar grows later is pinned too, but must still be droppable —
  // it gives way ahead of the named pins rather than becoming a fourth immovable object.
  const pinnedNames = [
    ...items
      .filter(
        (item) =>
          item.element.classList.contains('right') &&
          !PINNED_ORDER.includes(item.name),
      )
      .map((item) => item.name),
    ...PINNED_ORDER.filter((name) => items.some((item) => item.name === name)),
  ]

  /** Put an item back in the row exactly as authored — the inverse of every move-into-`more` step. */
  const restoreItem = (item: ToolbarItem) => {
    restoreOverflowIcon(item)
    setArrowPanel(item, false)
    setOverflowRow(item, false)
    delete item.element.dataset.vmarkdOverflow
    authoredInsert(toolbar, item, authoredOrder)
  }

  let widths = new Map<string, number>()
  let clusterData: OverflowCluster[] = []
  // Separator widths include their horizontal margins. They are cached, but counted only when the
  // corresponding separator remains visible for a candidate row layout.
  let separatorWidths = new Map<HTMLElement, number>()
  let frame = 0
  let disposed = false
  // Last applied decision, so an unchanged one costs nothing but the (cached-width) arithmetic.
  let lastSignature: string | null = null
  let lastAvailable: number | null = null

  // Measure only while every item is still in the row — an item inside `more` reports its panel
  // width, not its row width, and deciding against that width flips it in and out every frame.
  const measure = () => {
    widths = new Map(items.map((item) => [item.name, rowWidth(item)]))
    widths.set('more', rowWidth(moreItem))
    separatorWidths = new Map(
      Array.from(toolbar.children)
        .filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.classList.contains('vditor-toolbar__divider'),
        )
        .map((child) => {
          const style = getComputedStyle(child)
          const margin =
            Number.parseFloat(style.marginLeft) +
            Number.parseFloat(style.marginRight)
          return [
            child,
            Math.ceil(child.getBoundingClientRect().width + margin),
          ]
        }),
    )
    clusterData = CLUSTER_ORDER.map((names) => ({
      name: names[0],
      width: itemNamesInCluster(items, names).reduce(
        (sum, item) => sum + (widths.get(item.name) ?? 0),
        0,
      ),
    })).filter(({ width }) => width > 0)
  }

  // Cached widths only go stale when the items themselves change size, which in a VS Code webview
  // means a font-size or zoom change — not a resize. Both are covered by this probe.
  const metricsProbe = () =>
    `${getComputedStyle(toolbar).fontSize}|${window.devicePixelRatio}`
  let measuredAt = ''

  /** Re-measure from a row that holds everything: an item inside `more` reports its panel width, so
   *  measuring the current layout would poison the cache. Runs inside the same rAF as the decision
   *  that follows it, so the fully-restored row is never painted. */
  const remeasure = () => {
    for (const item of items) {
      setArrowPanel(item, false)
      setOverflowRow(item, false)
      delete item.element.dataset.vmarkdOverflow
      authoredInsert(toolbar, item, authoredOrder)
    }
    marker.remove()
    measure()
    measuredAt = metricsProbe()
    lastSignature = null
    lastAvailable = null
  }

  const projectedRowWidth = (overflowed: ReadonlySet<string>) => {
    const isDivider = (el: HTMLElement) =>
      el.classList.contains('vditor-toolbar__divider')
    const name = (el: HTMLElement) =>
      el.querySelector(':scope > [data-type]')?.getAttribute('data-type') ?? ''
    const visibleItem = (el: HTMLElement) =>
      el.classList.contains('vditor-toolbar__item') &&
      !overflowed.has(name(el)) &&
      name(el) !== 'more'
    const runHasVisible = (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < authoredOrder.length; i += step) {
        const element = authoredOrder[i]
        if (isDivider(element)) return false
        if (visibleItem(element)) return true
      }
      return false
    }

    return authoredOrder.reduce((sum, child, index) => {
      if (isDivider(child)) {
        return runHasVisible(index - 1, -1) && runHasVisible(index + 1, 1)
          ? sum + (separatorWidths.get(child) ?? 0)
          : sum
      }
      const itemName = name(child)
      return itemName && (!overflowed.has(itemName) || itemName === 'more')
        ? sum + (widths.get(itemName) ?? 0)
        : sum
    }, 0)
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one layout pass deliberately coordinates measurement, give-way decisions, DOM moves, and accessibility refresh
  const apply = () => {
    frame = 0
    if (disposed) return
    const container = toolbar.parentElement ?? toolbar
    const containerWidth = container.getBoundingClientRect().width
    const toolbarStyle = getComputedStyle(toolbar)
    const horizontalPadding =
      Number.parseFloat(toolbarStyle.paddingLeft) +
      Number.parseFloat(toolbarStyle.paddingRight)
    const toolbarContentWidth =
      toolbar.clientWidth > 0
        ? Math.max(0, toolbar.clientWidth - horizontalPadding)
        : containerWidth
    const available = Math.min(containerWidth, toolbarContentWidth)
    if (available <= 0) return
    if (metricsProbe() !== measuredAt) remeasure()

    // On a live shrink, preserve the current group selection until the existing More trigger has
    // actually reached the right edge. Recomputing from the authored row here would hide the next
    // cluster early, leaving a growing gap after More. Widening still recomputes immediately so
    // overflowed items can return as soon as they fit.
    if (
      lastSignature !== null &&
      lastAvailable !== null &&
      available < lastAvailable
    ) {
      const toolbarRight = toolbar.getBoundingClientRect().right
      const moreRight = moreItem.element.getBoundingClientRect().right
      if (moreRight <= toolbarRight + 0.5) {
        lastAvailable = available
        return
      }
    }

    const overflowed = new Set<string>()
    for (const cluster of clusterData) {
      if (projectedRowWidth(overflowed) <= available) break
      for (const name of clusterMembers(cluster.name)) overflowed.add(name)
    }

    if (projectedRowWidth(overflowed) > available) {
      // Below the width where even the pinned band fits, the pins give way too — `more` is the one
      // item that never does, because it is the only route to everything already inside it.
      const stillPinned = new Set(pinnedNames)
      for (const name of pinnedNames) {
        if (projectedRowWidth(overflowed) <= available) break
        stillPinned.delete(name)
        overflowed.add(name)
      }
    }

    // The observer watches a content-driven ancestor, so this pass's own DOM writes can re-trigger
    // it. Skipping the write phase when the decision is unchanged both stops that from compounding
    // and keeps a resize DRAG from reparenting ~20 items on every frame for no visible change.
    const signature = Array.from(overflowed).sort().join(',')
    if (signature === lastSignature) {
      lastAvailable = available
      return
    }
    lastSignature = signature
    lastAvailable = available
    // The overflow set changed — items moved into or out of `more`, so every open submenu panel is
    // stale: the more menu would show items that already returned to the row, and an open
    // emoji/headings/edit-mode panel would travel with its item into or out of `more`. Close them
    // all so the next click re-opens a menu that matches the row. Task 504: the more panel alone
    // was left open across a widen and the second toggle click closed it instead of reopening it —
    // the same rule now covers the other three submenu triggers too.
    closeSubmenuPanels(toolbar)

    for (const item of items) {
      if (item.element.parentElement === morePanel) item.element.remove()
    }
    if (overflowed.size > 0) {
      // Overflowed items go ABOVE the menu's authored rows, separated by the divider, so Settings /
      // About keep a stable position no matter how many items are currently overflowed.
      if (!marker.isConnected)
        morePanel.insertBefore(marker, morePanel.firstChild)
    } else if (marker.isConnected) {
      marker.remove()
    }
    for (const item of items) {
      if (overflowed.has(item.name)) {
        inlineOverflowIcon(item)
        setArrowPanel(item, true)
        setOverflowRow(item, true)
        item.element.dataset.vmarkdOverflow = 'true'
        morePanel.insertBefore(item.element, marker)
      } else {
        restoreItem(item)
      }
    }
    updateSeparators(authoredOrder, overflowed)
    refreshRoving(toolbar)
    updateSubmenuExpanded(moreButton, morePanel)
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply)
  }
  measure()
  measuredAt = metricsProbe()
  schedule()
  const stable = toolbar.parentElement ?? toolbar
  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => apply())
  resizeObserver?.observe(stable)
  // In VS Code the parent can keep its width while the retained webview changes
  // its own layout width. Observe both boxes so the give-way pass runs in the
  // same resize cycle instead of briefly painting More beyond the right edge.
  if (stable !== toolbar) resizeObserver?.observe(toolbar)
  resizeObserver?.observe(document.documentElement)
  resizeObserver?.observe(document.body)
  window.addEventListener('resize', apply)
  const moreStateObserver = new MutationObserver(() => {
    updateSubmenuExpanded(moreButton, morePanel)
    alignSubmenuPanel(morePanel)
  })
  moreStateObserver.observe(morePanel, {
    attributes: true,
    attributeFilter: ['style'],
  })

  return () => {
    disposed = true
    if (frame) cancelAnimationFrame(frame)
    resizeObserver?.disconnect()
    window.removeEventListener('resize', apply)
    moreStateObserver.disconnect()
    for (const item of items) {
      if (item.element.parentElement === morePanel) item.element.remove()
      restoreItem(item)
    }
    marker.remove()
    // Hand the row back exactly as authored — including any divider this hid.
    updateSeparators(authoredOrder, new Set())
    lastSignature = null
    lastAvailable = null
  }
}
