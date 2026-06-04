import '../src/preload'
import Vditor from 'vditor/src/index'
import { createPendingEdit } from '../src/pending-edit'
import { setupSaveFlushKeybind } from '../src/save-flush'
import '../src/utils' // sets window.vscode from the spec's acquireVsCodeApi stub

// Real Vditor (IR) wired exactly as main.ts for the Ctrl/Cmd+S flush (task 58):
// edits are debounced via createPendingEdit; a capture-phase save keybind flushes
// the pending edit so a save inside the debounce window posts current content.
let editor: Vditor

const pendingEdit = createPendingEdit({
  wait: 250,
  getValue: () => editor.getValue(),
  post: (content) =>
    (window as any).vscode.postMessage({ command: 'edit', content }),
})

editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value: 'start\n',
  customWysiwygToolbar: () => {},
  input(text?: string) {
    pendingEdit.schedule(typeof text === 'string' ? text : editor.getValue())
  },
  after() {
    ;(window as any).vditor = editor
    ;(window as any).vditorTest = editor
    ;(window as any).__ready = true
  },
})

setupSaveFlushKeybind(window, () => pendingEdit.flush())
