export type TableAction =
  | 'left'
  | 'center'
  | 'right'
  | 'insertRowA'
  | 'insertRowB'
  | 'insertColumnL'
  | 'insertColumnR'
  | 'deleteRow'
  | 'deleteColumn'

type ShortcutDef = { key: string; shift: boolean; macKey?: string }

// Faithful 1:1 mapping of the former user-event handleMap. `macKey` captures
// the cases where the mac variant uses a different character than non-mac.
const SHORTCUTS: Record<TableAction, ShortcutDef> = {
  left: { key: 'l', shift: true },
  center: { key: 'c', shift: true },
  right: { key: 'r', shift: true },
  insertRowA: { key: 'f', shift: true },
  insertRowB: { key: '=', shift: false },
  deleteRow: { key: '-', shift: false },
  insertColumnL: { key: 'g', shift: true },
  insertColumnR: { key: '+', macKey: '=', shift: true },
  deleteColumn: { key: '_', macKey: '-', shift: true },
}

export function resolveShortcut(
  type: TableAction,
  isMac: boolean,
): { key: string; shift: boolean } {
  const def = SHORTCUTS[type]
  return { key: isMac && def.macKey ? def.macKey : def.key, shift: def.shift }
}

// Vditor matches these hotkeys on keydown via event.key + modifiers
// (isCtrl = ctrlKey || metaKey), so dispatching a native KeyboardEvent on the
// IR element is enough to trigger the table action.
export function dispatchTableHotkey(
  el: HTMLElement,
  type: TableAction,
  isMac: boolean,
) {
  const { key, shift } = resolveShortcut(type, isMac)
  el.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      shiftKey: shift,
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    }),
  )
}
