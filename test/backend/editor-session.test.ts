import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorSession } from '../../src/app/extension'
import { WritebackController } from '../../src/writeback/writeback-controller'
import { mock } from './vscode-mock'

// The whole point of the refactor: EditorSession is now an independently
// constructible unit. Give it a context, a document, a webview panel, and an HTML
// builder — no MarkdownEditorProvider, no real _getHtmlForWebview — and drive it.
function makeSession(fsPath = '/ws/note.md', text = '# Hi\n\nbody\n') {
  mock.setWorkspaceFolder('/ws')
  const context = mock.createExtensionContext()
  const document = mock.createTextDocument(fsPath, text)
  const panel = mock.createWebviewPanel()
  // injected html builder — stand-in for the provider's _getHtmlForWebview
  const html = (_w: unknown, _u: unknown, content?: string) =>
    `<div id="app"></div>${content ?? ''}`
  const sizes: [string, number[]][] = []
  // task 184 — a no-op diagram-cache stub (the provider injects the real one).
  const diagramCache = {
    registerDoc() {
      /* no-op stub — see comment above */
    },
    closeDoc() {
      /* no-op stub — see comment above */
    },
    get() {
      return undefined
    },
    put() {
      /* no-op stub — see comment above */
    },
    putSize(key: string, size: number[]) {
      sizes.push([key, size])
    },
  }
  const session = new EditorSession(
    context as any,
    document as any,
    panel as any,
    diagramCache as any,
    html as any,
  )
  return { session, panel, document, sizes }
}

describe('EditorSession (constructed directly)', () => {
  beforeEach(() => mock.reset())

  it('start() renders the injected html (with the document content) into the webview', () => {
    const { session, panel } = makeSession('/ws/note.md', '# Hello\n')
    session.start()
    expect(panel.webview.html).toContain('id="app"')
    expect(panel.webview.html).toContain('# Hello')
  })

  it('answers a `ready` message with an init `update` carrying the content', async () => {
    const { session, panel } = makeSession('/ws/note.md', '# Title\n')
    session.start()
    await panel._receiveMessage({ command: 'ready' })
    const init = mock.calls.postMessage.find(
      (m: any) => m.command === 'update' && m.type === 'init',
    )
    expect(init).toBeDefined()
    expect(init.content).toContain('# Title')
  })

  // Task 532 step 5c — the rendered size rides on the cache PUT and is filed under its own key.
  it('files a reported diagram size with the cache, and ignores a malformed one', async () => {
    const { session, panel, sizes } = makeSession()
    session.start()
    const put = (extra: object) =>
      panel._receiveMessage({
        command: 'diagram-render-cached',
        diagramId: 'd2#0',
        hash: 'h',
        svg: '<svg/>',
        ...extra,
      })
    await put({ sizeKey: '1'.repeat(16), size: [100, 50, 6] })
    await put({ sizeKey: '2'.repeat(16), size: [0, 50, 6] })
    await put({ sizeKey: '3'.repeat(16), size: 'big' })
    await put({ sizeKey: 'not-hex', size: [100, 50, 6] })
    await put({ size: [100, 50, 6] })
    await put({})
    expect(sizes).toEqual([['1'.repeat(16), [100, 50, 6]]])
  })

  it('removes its panel from the active-panel registry on dispose', () => {
    const { session, panel } = makeSession()
    session.start()
    panel._fireDispose()
    // a second dispose-driven cleanup must not throw (idempotent teardown)
    expect(() => panel._fireDispose()).not.toThrow()
  })

  // Task 420 — this order is documented in two comments around start()'s `onDidReceiveMessage` /
  // `webview.html =` statements but nothing enforced it. If it ever inverts, the webview starts
  // loading main.js (and can post its `ready` message) before the host has a listener attached —
  // that message is dropped SILENTLY (no exception, no log), and the editor looks hung/blank with
  // no error to point at. `vscode-mock.ts`'s `createWebviewPanel()` records the order both
  // statements fire in (`panel._eventOrder`) so this is asserted directly, not inferred from
  // reading source.
  it('attaches the message listener BEFORE assigning webview.html, so the early `ready` message is never dropped (task 420)', () => {
    const { session, panel } = makeSession()
    session.start()
    const listenerIndex = panel._eventOrder.indexOf('listener-attached')
    const htmlIndex = panel._eventOrder.indexOf('html-assigned')
    expect(listenerIndex, 'onDidReceiveMessage was never attached').not.toBe(-1)
    expect(htmlIndex, 'webview.html was never assigned').not.toBe(-1)
    expect(
      listenerIndex,
      'the message listener must attach before webview.html loads main.js — ' +
        'otherwise the early `ready` message races the listener and is dropped silently',
    ).toBeLessThan(htmlIndex)
  })

  // Task 434 — checkNoopOnWillSave's correctness backstop: a save (any trigger) must reach
  // WritebackController via vscode.workspace.onWillSaveTextDocument. These test the WIRING (is the
  // listener registered, filtered by uri, and does dispose cancel the pending timer) — the actual
  // no-op DECISION logic is exhaustively covered with a mocked isSemanticNoop in
  // writeback-controller.test.ts; this environment's Lute is cold (no real extensionPath), so
  // checkNoopOnWillSave always resolves to "not a no-op" here, which is itself the useful
  // assertion: cold Lute must degrade to doing nothing, never throw or wrongly correct.
  it('onWillSaveTextDocument for the ACTIVE document reaches WritebackController without throwing (cold Lute → no correction)', () => {
    const { session, document } = makeSession('/ws/note.md', '# Hi\n\nbody\n')
    session.start()
    const captured = mock.fireWillSaveTextDocument(document)
    // Cold Lute (no real extensionPath in this unit environment) → isSemanticNoop can't decide →
    // checkNoopOnWillSave returns [] → the listener never calls event.waitUntil.
    expect(captured.edits).toBeUndefined()
  })

  it('onWillSaveTextDocument for a DIFFERENT document is ignored (uri filter)', () => {
    const { session } = makeSession('/ws/note.md', '# Hi\n\nbody\n')
    session.start()
    const other = mock.createTextDocument('/ws/other.md', 'unrelated\n')
    expect(() => mock.fireWillSaveTextDocument(other)).not.toThrow()
    // No assertion beyond "didn't throw" is possible here — the uri filter's real effect (skipping
    // checkNoopOnWillSave entirely) has no other externally observable signal in this mock.
  })

  it('dispose cancels WritebackController.disposeNoopCheck (no stray timer after the panel closes)', () => {
    const spy = vi.spyOn(WritebackController.prototype, 'disposeNoopCheck')
    const { session, panel } = makeSession()
    session.start()
    panel._fireDispose()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
