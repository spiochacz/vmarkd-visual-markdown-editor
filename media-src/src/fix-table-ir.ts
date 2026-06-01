/**
 * ir 模式下支持 table 编辑
 */
import { t } from './lang'
import { dispatchTableHotkey, type TableAction } from './table-hotkey'

const tablePanelId = 'fix-table-ir-wrapper'
let disableVscodeHotkeys = false

function formatHotkeyTip(hotkey: string) {
  if (navigator.platform.toLowerCase().includes('mac')) {
    return hotkey
  }

  return hotkey
    .replace(/⌘/g, 'Ctrl+')
    .replace(/⇧/g, 'Shift+')
    .replace(/⌥/g, 'Alt+')
    .replace(/\+/g, '+')
}

export function fixTableIr() {
  const eventRoot = vditor.vditor.ir.element

  function insertTablePanel() {
    let tablePanel = eventRoot.querySelector<HTMLDivElement>(`#${tablePanelId}`)
    if (!tablePanel) {
      tablePanel = document.createElement('div')
      tablePanel.id = tablePanelId
      // Exclude the panel subtree from the editable IR region — it is appended
      // into the contenteditable element, so without this its markup is
      // editable/selectable. Complementary to the mousedown preventDefault.
      tablePanel.contentEditable = 'false'
      tablePanel.style.userSelect = 'none'
      // Keep the wrapper OUT of the editable content flow. It is appended into
      // the contenteditable IR element; as a static block it reserves a line+
      // margin box (~58px) that shows up as an empty gap under the text whenever
      // you click/edit (the click handler creates it on first click). Anchor it
      // as a zero-size absolute box at the IR origin: it then reserves no flow
      // space, and the whitespace text nodes in its template can't form a stray
      // line box over the top content. The inner panel is itself
      // position:absolute (overflowing this 0×0 box, so still visible) and is
      // positioned via JS relative to eventRoot — landing on the clicked cell
      // exactly as before.
      tablePanel.style.position = 'absolute'
      tablePanel.style.top = '0'
      tablePanel.style.left = '0'
      tablePanel.style.width = '0'
      tablePanel.style.height = '0'
      eventRoot.appendChild(tablePanel)
      tablePanel.innerHTML = `<div
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
      // Keep the editor selection when an icon is clicked, otherwise the
      // button steals the caret and the table hotkey has no cell context.
      tablePanel.addEventListener('mousedown', (e) => e.preventDefault())
      tablePanel.addEventListener('click', (e) => {
        const icon = (e.target as HTMLElement).closest<HTMLElement>(
          '.vditor-icon',
        )
        if (!icon || !tablePanel.contains(icon)) return
        const type = icon.getAttribute('data-type') as TableAction
        const isMac = navigator.platform.toLowerCase().includes('mac')
        disableVscodeHotkeys = true
        try {
          dispatchTableHotkey(eventRoot, type, isMac)
        } finally {
          disableVscodeHotkeys = false
        }
        e.stopPropagation()
      })
    }
    tablePanel = tablePanel.children[0] as HTMLDivElement
    return tablePanel
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
      if (tablePanel.style.display !== 'block') {
        tablePanel.style.display = 'block'
      }
      tablePanel.style.top =
        cell.getBoundingClientRect().top -
        eventRoot.getBoundingClientRect().top +
        eventRoot.scrollTop -
        25 +
        'px'
      // track the clicked cell horizontally too, so the panel stays visible
      // regardless of the editor's left margin / full-width layout
      tablePanel.style.left =
        cell.getBoundingClientRect().left -
        eventRoot.getBoundingClientRect().left +
        eventRoot.scrollLeft +
        'px'
    } else {
      if (tablePanel.style.display !== 'none') {
        tablePanel.style.display = 'none'
      }
    }
  })
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
