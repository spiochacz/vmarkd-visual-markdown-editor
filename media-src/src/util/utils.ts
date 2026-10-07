// Small cross-cutting webview fixups. Split per 185/3g: responsive tables →
// responsive-tables.ts, link/wiki-chip routing → link-click-fix.ts, toolbar
// persistence → toolbar-actions.ts, the vscode handle + window globals →
// vscode-api.ts (imported here so existing side-effect importers keep working);
// the unused confirm() dialog was dropped.

import './vscode-api'

// 文件转base64用于传输 — strip the `data:*;base64,` prefix, returning just the payload.
export const fileToBase64 = async (file: Blob): Promise<string> => {
  return new Promise<string>((res, rej) => {
    const reader = new FileReader()
    reader.onload = (evt) => {
      const result = evt.target?.result
      if (typeof result !== 'string') {
        rej(new Error('fileToBase64: unexpected non-string FileReader result'))
        return
      }
      res(result.split(',')[1] ?? '')
    }
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

/** error:
 We don't execute document.execCommand() this time, because it is called recursively.
(anonymous) @ main.js:32449
(anonymous) @ main.js:842
(anonymous) @ host.js:27
see: https://github.com/nwjs/nw.js/issues/3403 */
export function fixCut() {
  const _exec = document.execCommand.bind(document)
  document.execCommand = (cmd, ...args) => {
    if (cmd === 'delete') {
      setTimeout(() => {
        return _exec(cmd, ...args)
      })
      // `delete` must run in the next task to avoid Vditor's re-entrant execCommand guard;
      // report that the deferred command was accepted so the DOM API's boolean contract remains
      // intact even though the underlying result is unavailable until the callback runs.
      return true
    } else {
      return _exec(cmd, ...args)
    }
  }
}
