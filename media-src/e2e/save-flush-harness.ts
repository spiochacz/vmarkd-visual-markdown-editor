import '../src/preload'
import Vditor from 'vditor/src/index'
import { createPendingEdit } from '../src/pending-edit'
import { setupSaveFlushKeybind } from '../src/save-flush'
import { setBusyCursor, nextPaint } from '../src/busy-cursor'
import '../src/utils' // sets window.vscode from the spec's acquireVsCodeApi stub

// Real Vditor (IR) wired exactly as main.ts for the edit-sync (tasks 58 + 68):
// the webview owns the markdown serialize (Vditor's per-input serialize is patched
// out). onIdle (debounced) serialises + posts, wrapping the slow serialize in a
// busy cursor on large docs; onFlush (Ctrl/Cmd+S) posts synchronously before save.
// `?large=1` forces the large-doc path so the busy-cursor behaviour is testable.
const forceLarge = new URLSearchParams(location.search).get('large') === '1'
let editor: Vditor

// Record busy toggles so the spec can assert the serialize was wrapped.
;(window as any).__busyLog = []
const setBusy = (on: boolean) => {
  ;(window as any).__busyLog.push(on)
  setBusyCursor(on)
}
const postEdit = () =>
  (window as any).vscode.postMessage({
    command: 'edit',
    content: editor.getValue(),
  })

const pendingEdit = createPendingEdit({
  wait: 250,
  onIdle: async () => {
    if (forceLarge) {
      setBusy(true)
      await nextPaint()
      try {
        postEdit()
      } finally {
        setBusy(false)
      }
    } else {
      postEdit()
    }
  },
  onFlush: () => postEdit(),
})

editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value: 'start\n',
  customWysiwygToolbar: () => {},
  input() {
    pendingEdit.schedule()
  },
  after() {
    ;(window as any).vditor = editor
    ;(window as any).vditorTest = editor
    ;(window as any).__ready = true
  },
})

setupSaveFlushKeybind(window, () => pendingEdit.flush())
