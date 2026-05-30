import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MarkdownEditorProvider } from '../../src/extension'
import { mock } from './vscode-mock'

function resolveProvider(text = 'old\n') {
  mock.setWorkspaceFolder('/workspace')
  const context = mock.createExtensionContext()
  const document = mock.createTextDocument('/workspace/note.md', text)
  const panel = mock.createWebviewPanel()
  const provider = new MarkdownEditorProvider(context as any)
  provider.resolveCustomTextEditor(document as any, panel as any)
  return { context, document, panel, provider }
}

describe('resolveCustomTextEditor — disposal', () => {
  beforeEach(() => mock.reset())
  afterEach(() => vi.useRealTimers())

  it('disposes the file watcher when the panel is disposed', () => {
    const { panel } = resolveProvider()
    expect(mock.state.watchers).toHaveLength(1)
    expect(mock.state.watchers[0].disposed).toBe(false)

    panel._fireDispose()
    expect(mock.state.watchers[0].dispose).toHaveBeenCalled()
    expect(mock.state.watchers[0].disposed).toBe(true)
  })

  it('detaches all document listeners so post-dispose events are inert', () => {
    const { panel, document } = resolveProvider()
    panel._fireDispose()

    const before = mock.calls.postMessage.length
    ;(document as any).__setText('changed after dispose\n')
    mock.fireDidChangeTextDocument(document)

    expect(mock.calls.postMessage.length).toBe(before)
  })

  it('clears a pending debounce timer on dispose (no late post)', async () => {
    vi.useFakeTimers()
    const { panel, document } = resolveProvider()

    // Schedule a webview update, then dispose before the 75ms timer fires.
    ;(document as any).__setText('changed on disk\n')
    mock.fireDidChangeTextDocument(document)
    panel._fireDispose()

    await vi.advanceTimersByTimeAsync(200)
    expect(
      mock.calls.postMessage.filter((m) => m.command === 'update')
    ).toHaveLength(0)
  })
})
