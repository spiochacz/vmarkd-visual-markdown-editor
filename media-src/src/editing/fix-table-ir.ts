/**
 * ir 模式下支持 table 编辑
 */
import { t } from '../util/lang'
import { isMac } from '../util/platform'
import { dispatchTableHotkey, type TableAction } from './table-hotkey'

const tablePanelId = 'fix-table-ir-wrapper'
let disableVscodeHotkeys = false

function formatHotkeyTip(hotkey: string) {
  if (isMac()) {
    return hotkey
  }

  return hotkey
    .replace(/⌘/g, 'Ctrl+')
    .replace(/⇧/g, 'Shift+')
    .replace(/⌥/g, 'Alt+')
    .replace(/\+/g, '+')
}

// The table-alignment/row/column popover markup (task 470 — extracted out of
// insertTablePanel's body for readability; byte-identical to the previous
// inline template literal, including the hard-coded "left" `--current` class
// that markAlignCurrent below immediately corrects for the actual cell).
function buildTablePanelHtml(): string {
  return `<div
    class="vditor-panel vditor-panel--none vditor-panel-ir"
    data-top="73"
    style="left: 35px; top: 73px;display:none"
  >
   <button
      type="button"
    aria-label="${t('alignLeft')}<${formatHotkeyTip('⇧⌘L')}>"
      data-type="left"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n vditor-icon--current"
    >
      <svg><use xlink:href="#vditor-icon-align-left"></use></svg></button
    ><button
      type="button"
      aria-label="${t('alignCenter')}<${formatHotkeyTip('⇧⌘C')}>"
      data-type="center"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n"
    >
      <svg><use xlink:href="#vditor-icon-align-center"></use></svg></button
    ><button
      type="button"
      aria-label="${t('alignRight')}<${formatHotkeyTip('⇧⌘R')}>"
      data-type="right"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n"
    >
      <svg><use xlink:href="#vditor-icon-align-right"></use></svg></button
    ><button
      type="button"
      aria-label="${t('insertRowAbove')}<${formatHotkeyTip('⇧⌘F')}>"
      data-type="insertRowA"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n"
    >
      <svg><use xlink:href="#vditor-icon-insert-rowb"></use></svg></button
    ><button
      type="button"
      aria-label="${t('insertRowBelow')}<${formatHotkeyTip('⌘=')}>"
      data-type="insertRowB"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n"
    >
      <svg><use xlink:href="#vditor-icon-insert-row"></use></svg></button
    ><button
      type="button"
      aria-label="${t('insertColumnLeft')}<${formatHotkeyTip('⇧⌘G')}>"
      data-type="insertColumnL"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n"
    >
      <svg><use xlink:href="#vditor-icon-insert-columnb"></use></svg></button
    ><button
      type="button"
      aria-label="${t('insertColumnRight')}<${formatHotkeyTip('⇧⌘=')}>"
      data-type="insertColumnR"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n"
    >
      <svg><use xlink:href="#vditor-icon-insert-column"></use></svg></button
    ><button
      type="button"
      aria-label="${t('deleteRow')}<${formatHotkeyTip('⌘-')}>"
      data-type="deleteRow"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n"
    >
      <svg><use xlink:href="#vditor-icon-delete-row"></use></svg></button
    ><button
      type="button"
      aria-label="${t('deleteColumn')}<${formatHotkeyTip('⇧⌘-')}>"
      data-type="deleteColumn"
      class="vditor-icon vditor-tooltipped vditor-tooltipped__n"
    >
      <svg><use xlink:href="#vditor-icon-delete-column"></use></svg></button
    >
  </div>
  `
}

// Move the alignment `--current` highlight onto the left/center/right button that
// matches `align` (the cell's column alignment, stored by Vditor as the `align`
// attribute — absent/"left" = default). The HTML template hard-codes left as
// current; without this the highlight never tracks the actual cell.
function markAlignCurrent(root: HTMLElement, align: string | null) {
  const want = align === 'center' || align === 'right' ? align : 'left'
  for (const btn of root.querySelectorAll<HTMLElement>(
    '[data-type="left"],[data-type="center"],[data-type="right"]',
  )) {
    btn.classList.toggle(
      'vditor-icon--current',
      btn.getAttribute('data-type') === want,
    )
  }
}

export function fixTableIr() {
  // Called once from finish-init.ts, strictly after the Vditor constructor returns — Vditor builds
  // all three mode DOM trees (wysiwyg/ir/sv) up front regardless of which is initially active, so
  // `.ir.element` always exists by then. Fail loud rather than silently no-op'ing the table panel
  // if that invariant is ever broken.
  const irElement = vditor.vditor.ir?.element
  if (!irElement)
    throw new Error('fixTableIr: IR editor element not initialized')
  // Re-bind to a plainly-`HTMLElement`-typed const: the guard above only narrows `irElement` in
  // THIS scope — it doesn't propagate into the nested `function` declarations below (insertTablePanel
  // etc.), which TS type-checks as their own scope. Giving `eventRoot` a non-union type at its own
  // declaration (rather than relying on carried-over narrowing) is what those nested functions see.
  const eventRoot: HTMLElement = irElement
  // The `.vditor-ir` container around the editable <pre>: the panel's mount point and the origin of its positioning.
  const panelHost: HTMLElement = eventRoot.parentElement ?? eventRoot

  function insertTablePanel() {
    let tablePanel = panelHost.querySelector<HTMLDivElement>(`#${tablePanelId}`)
    if (!tablePanel) {
      tablePanel = document.createElement('div')
      tablePanel.id = tablePanelId
      // A sibling of the editable element inside `.vditor-ir` (`position: relative`), never inside
      // it. A zero-size absolute box at the container origin is the anchor; the inner panel is
      // absolutely positioned relative to the container by placePanel.
      tablePanel.contentEditable = 'false'
      tablePanel.style.userSelect = 'none'
      tablePanel.style.position = 'absolute'
      tablePanel.style.top = '0'
      tablePanel.style.left = '0'
      tablePanel.style.width = '0'
      tablePanel.style.height = '0'
      panelHost.appendChild(tablePanel)
      tablePanel.innerHTML = buildTablePanelHtml()
      // Stable `const` for the closures below — `tablePanel` itself is reassigned to
      // `.children[0]` right after this if-block (every call, see below), and a closure reading a
      // mutated `let` sees its value AT INVOCATION time, not at closure-creation time. `wrapper`
      // stays the outer 0×0 anchor forever; containment/query results are identical either way
      // (wrapper ⊇ innerPanel ⊇ the buttons), so this only fixes strictNullChecks' inability to
      // narrow a captured `let` — it does not change which elements match.
      const wrapper = tablePanel
      // Keep the editor selection when an icon is clicked, otherwise the
      // button steals the caret and the table hotkey has no cell context.
      wrapper.addEventListener('mousedown', (e) => e.preventDefault())
      wrapper.addEventListener('click', (e) => {
        const icon = (e.target as HTMLElement).closest<HTMLElement>(
          '.vditor-icon',
        )
        if (!icon || !wrapper.contains(icon)) return
        const type = icon.getAttribute('data-type') as TableAction
        disableVscodeHotkeys = true
        try {
          dispatchTableHotkey(eventRoot, type, isMac())
        } finally {
          disableVscodeHotkeys = false
        }
        // reflect a left/center/right click on the highlight immediately
        if (type === 'left' || type === 'center' || type === 'right') {
          markAlignCurrent(wrapper, type)
        }
        e.stopPropagation()
      })
    }
    tablePanel = tablePanel.children[0] as HTMLDivElement
    return tablePanel
  }

  // The cell and inner panel the panel currently belongs to (null = hidden), so a scroll can re-place it.
  let panelCell: HTMLElement | null = null
  let panelEl: HTMLElement | null = null

  // Place the panel by `cell` in `.vditor-ir` container coordinates; hidden while the cell is
  // scrolled out of view. Both boxes are measured before any write (one layout per call).
  function placePanel(panel: HTMLElement, cell: HTMLElement) {
    panelCell = cell
    panelEl = panel
    const cellRect = cell.getBoundingClientRect()
    const rootRect = panelHost.getBoundingClientRect()
    const visible =
      cellRect.bottom > rootRect.top && cellRect.top < rootRect.bottom
    const display = visible ? 'block' : 'none'
    if (panel.style.display !== display) panel.style.display = display
    if (!visible) return
    panel.style.top = `${cellRect.top - rootRect.top - 25}px`
    // track the clicked cell horizontally too, so the panel stays visible
    // regardless of the editor's left margin / full-width layout
    panel.style.left = `${cellRect.left - rootRect.left}px`
  }

  eventRoot.addEventListener('click', (_e) => {
    if (vditor.getCurrentMode() !== 'ir') return
    const tablePanel = insertTablePanel()
    const anchorNode = window.getSelection()?.anchorNode
    const anchorEl =
      anchorNode instanceof HTMLElement
        ? anchorNode
        : (anchorNode?.parentElement ?? null)
    // Walk up to the enclosing cell — the caret may sit inside inline content
    // (e.g. a <code> span when the cell is only inline code), so
    // anchorNode.parentElement is not always the TD/TH/TR itself.
    const cell = anchorEl?.closest<HTMLElement>('td, th, tr') ?? null
    if (cell) {
      placePanel(tablePanel, cell)
      // highlight the alignment button that matches THIS cell's column alignment
      const td = anchorEl?.closest<HTMLElement>('td, th')
      markAlignCurrent(tablePanel, td?.getAttribute('align') ?? null)
    } else {
      panelCell = null
      panelEl = null
      if (tablePanel.style.display !== 'none') {
        tablePanel.style.display = 'none'
      }
    }
  })
  // The editable <pre> scrolls inside `.vditor-ir` and the panel is outside it, so re-place the panel
  // against its cell on every scroll.
  eventRoot.addEventListener(
    'scroll',
    () => {
      if (panelCell?.isConnected && panelEl) placePanel(panelEl, panelCell)
    },
    { passive: true },
  )
  // don't bubble keyboardEvent to vscode when trigger vditor table hot keys, prevent hotkey conflicts with vscode
  const stopEvent = (e: KeyboardEvent) => {
    if (disableVscodeHotkeys) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  eventRoot.addEventListener('keydown', stopEvent)
  eventRoot.addEventListener('keyup', stopEvent)
}
