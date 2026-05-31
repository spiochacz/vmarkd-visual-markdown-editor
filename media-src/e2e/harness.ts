import '../src/preload'
import Vditor from 'vditor'
import { fixTableIr } from '../src/fix-table-ir'
import { dispatchTableHotkey, TableAction } from '../src/table-hotkey'
import { setupCustomRenderer } from '../src/custom-renderer'
import * as sourceMap from '../src/source-map'
import * as diffMarkers from '../src/diff-markers'

// Minimal page that instantiates Vditor in IR mode with a known table and
// wires fix-table-ir, mirroring how main.ts sets things up. Exposed globals
// let the Playwright test drive and read the editor.
const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: location.origin + '/vditor',
  value:
    '| Header One | Header Two |\n| - | - |\n| value one | value two |\n',
  after() {
    ;(window as any).vditor = editor
    ;(window as any).vditorTest = editor
    setupCustomRenderer(editor, { enabled: false })
    fixTableIr()
    const isMac = navigator.platform.toLowerCase().includes('mac')
    ;(window as any).__dispatchTableHotkey = (type: TableAction) =>
      dispatchTableHotkey(editor.vditor.ir.element, type, isMac)
    ;(window as any).__sourceMap = sourceMap
    ;(window as any).__diffMarkers = diffMarkers
    ;(window as any).__ready = true
  },
})
