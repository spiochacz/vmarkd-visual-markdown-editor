/**
 * ir 模式下支持 table 编辑
 */
import { keyboard } from '@testing-library/user-event/dist/keyboard'
import { t } from './lang'

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
      tablePanel.addEventListener('click', (e) => {
        const icon = (e.target as HTMLElement).closest<HTMLElement>(
          '.vditor-icon'
        )
        if (!icon || !tablePanel.contains(icon)) return
        let type = icon.getAttribute('data-type')
        const handleMap = {
          left: [
            '{ctrl}{shift}l{/shift}{/ctrl}',
            '{meta}{shift}l{/shift}{/meta}',
          ],
          center: [
            '{ctrl}{shift}c{/shift}{/ctrl}',
            '{meta}{shift}c{/shift}{/meta}',
          ],
          right: [
            '{ctrl}{shift}r{/shift}{/ctrl}',
            '{meta}{shift}r{/shift}{/meta}',
          ],
          insertRowA: [
            '{ctrl}{shift}f{/shift}{/ctrl}',
            '{meta}{shift}f{/shift}{/meta}',
          ],
          insertRowB: ['{ctrl}={/ctrl}', '{meta}={/meta}'],
          deleteRow: ['{ctrl}-{/ctrl}', '{meta}-{/meta}'],
          insertColumnL: [
            '{ctrl}{shift}g{/shift}{/ctrl}',
            '{meta}{shift}g{/shift}{/meta}',
          ],
          insertColumnR: [
            '{ctrl}{shift}+{/shift}{/ctrl}',
            '{meta}{shift}={/shift}{/meta}',
          ],
          deleteColumn: [
            '{ctrl}{shift}_{/shift}{/ctrl}',
            '{meta}{shift}-{/shift}{/meta}',
          ], // 有的是+ 有的是=; -/_ 都是为了fix不同平 bug
        }
        let k =
          handleMap[type][
            navigator.platform.toLowerCase().includes('mac') ? 1 : 0
          ]
        disableVscodeHotkeys = true
        Promise.resolve(
          keyboard(k, {
            document: {
              body: eventRoot,
            } as any,
          })
        ).finally(() => {
          disableVscodeHotkeys = false
        })
        e.stopPropagation()
      })
    }
    tablePanel = tablePanel.children[0] as HTMLDivElement
    return tablePanel
  }

  eventRoot.addEventListener('click', (e) => {
    if (vditor.getCurrentMode() !== 'ir') return
    const tablePanel = insertTablePanel()
    let clickEl = window.getSelection().anchorNode.parentElement
    if (['TD', 'TH', 'TR'].includes(clickEl.tagName)) {
      if (tablePanel.style.display !== 'block') {
        tablePanel.style.display = 'block'
      }
      tablePanel.style.top =
        clickEl.getBoundingClientRect().top -
        eventRoot.getBoundingClientRect().top +
        eventRoot.scrollTop -
        25 +
        'px'
    } else {
      if (tablePanel.style.display !== 'none') {
        tablePanel.style.display = 'none'
      }
    }
  })
  // don't bubble keyboardEvent to vscode when trigger vditor table hot keys, prevent hotkey conflicts with vscode
  let stopEvent = (e: KeyboardEvent) => {
    if (disableVscodeHotkeys) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  eventRoot.addEventListener('keydown', stopEvent)
  eventRoot.addEventListener('keyup', stopEvent)
}
