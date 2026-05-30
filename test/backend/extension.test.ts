import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { activate, MarkdownEditorProvider } from '../../src/extension'
import { mock, ColorThemeKind, Uri } from './vscode-mock'

function resolveProvider(fsPath = '/workspace/note.md', text = 'old content\n') {
  mock.setWorkspaceFolder('/workspace')
  const context = mock.createExtensionContext()
  const document = mock.createTextDocument(fsPath, text)
  const panel = mock.createWebviewPanel()
  const provider = new MarkdownEditorProvider(context as any)
  provider.resolveCustomTextEditor(document as any, panel as any)
  return { context, document, panel, provider }
}

function lastUpdate() {
  const updates = mock.calls.postMessage.filter((m) => m.command === 'update')
  return updates[updates.length - 1]
}

describe('activate()', () => {
  beforeEach(() => mock.reset())

  it('registers the open/edit commands and the custom editor provider', () => {
    const context = mock.createExtensionContext()
    activate(context as any)

    expect([...mock.calls.registeredCommands.keys()]).toEqual(
      expect.arrayContaining([
        'markdown-editor.openEditor',
        'markdown-editor.openTextEditor',
      ])
    )
    expect(mock.calls.customEditor?.viewType).toBe('markdown-editor.editor')
    expect(mock.calls.customEditor?.options.webviewOptions).toMatchObject({
      retainContextWhenHidden: true,
      enableFindWidget: true,
    })
  })

  it('marks the vditor.options key for settings sync', () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    expect(mock.calls.setKeysForSync).toContainEqual(['vditor.options'])
  })
})

describe('resolveCustomTextEditor — init handshake', () => {
  beforeEach(() => mock.reset())

  it('replies to "ready" with the full init payload', async () => {
    const { panel } = resolveProvider('/workspace/note.md', '# Hello\n')
    await panel._receiveMessage({ command: 'ready' })

    const init = lastUpdate()
    expect(init).toMatchObject({
      command: 'update',
      type: 'init',
      content: '# Hello\n',
      options: { useVscodeThemeColor: true, enableFullWidth: true },
      wiki: { enabled: false },
    })
    expect(init.cdn).toContain('/ext/media/vditor')
  })

  it('reports a dark theme when the active color theme is dark', async () => {
    mock.setThemeKind(ColorThemeKind.Dark)
    const { panel } = resolveProvider()
    await panel._receiveMessage({ command: 'ready' })
    expect(lastUpdate().theme).toBe('dark')
  })

  it('reports a light theme otherwise', async () => {
    mock.setThemeKind(ColorThemeKind.Light)
    const { panel } = resolveProvider()
    await panel._receiveMessage({ command: 'ready' })
    expect(lastUpdate().theme).toBe('light')
  })
})

describe('resolveCustomTextEditor — webview → editor sync', () => {
  beforeEach(() => mock.reset())

  it('applies an edit when the webview content differs', async () => {
    const { panel, document } = resolveProvider('/workspace/note.md', 'old\n')
    await panel._receiveMessage({ command: 'edit', content: 'new content\n' })

    expect(mock.calls.appliedEdits).toHaveLength(1)
    expect(mock.calls.appliedEdits[0].replacements[0].content).toBe('new content\n')
    expect(document.getText()).toBe('new content\n')
  })

  it('does NOT apply an edit when content is unchanged (CRLF-insensitive)', async () => {
    const { panel } = resolveProvider('/workspace/note.md', 'line a\nline b\n')
    await panel._receiveMessage({ command: 'edit', content: 'line a\r\nline b\r\n' })
    expect(mock.calls.appliedEdits).toHaveLength(0)
  })

  it('saves the document after applying on a "save" message', async () => {
    const { panel, document } = resolveProvider('/workspace/note.md', 'old\n')
    await panel._receiveMessage({ command: 'save', content: 'persisted\n' })

    expect(mock.calls.appliedEdits).toHaveLength(1)
    expect(document.getText()).toBe('persisted\n')
    // save() syncs the saved snapshot — document is no longer dirty.
    expect(document.isDirty).toBe(false)
  })

  it('persists vditor options on "save-options"', async () => {
    const { panel } = resolveProvider()
    await panel._receiveMessage({ command: 'save-options', options: { mode: 'ir' } })
    expect(mock.calls.globalStateUpdates).toContainEqual({
      key: 'vditor.options',
      value: { mode: 'ir' },
    })
  })
})

describe('resolveCustomTextEditor — editor → webview sync', () => {
  beforeEach(() => mock.reset())
  afterEach(() => vi.useRealTimers())

  it('does not echo the webview edit back to the webview', async () => {
    vi.useFakeTimers()
    const { panel, document } = resolveProvider('/workspace/note.md', 'old\n')
    await panel._receiveMessage({ command: 'edit', content: 'new\n' })

    const before = mock.calls.postMessage.length
    // The applyEdit triggers a document change carrying the same content.
    mock.fireDidChangeTextDocument(document)
    await vi.advanceTimersByTimeAsync(100)

    const echoes = mock.calls.postMessage
      .slice(before)
      .filter((m) => m.command === 'update')
    expect(echoes).toHaveLength(0)
  })

  it('pushes external file changes to the webview after the debounce', async () => {
    vi.useFakeTimers()
    const { panel, document } = resolveProvider('/workspace/note.md', 'old\n')

    // Simulate an out-of-band edit (git checkout, external editor, …).
    ;(document as any).__setText('changed on disk\n')
    mock.fireDidChangeTextDocument(document)

    expect(mock.calls.postMessage).toHaveLength(0) // debounced, not yet sent
    await vi.advanceTimersByTimeAsync(75)

    expect(lastUpdate()).toMatchObject({
      command: 'update',
      content: 'changed on disk\n',
    })
  })

  it('disposes the panel when its document is closed', () => {
    const { panel, document } = resolveProvider()
    mock.fireDidCloseTextDocument(document)
    expect(panel.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('resolveCustomTextEditor — live theme switch', () => {
  beforeEach(() => mock.reset())

  it('posts set-theme dark when the active theme becomes dark', () => {
    mock.setThemeKind(ColorThemeKind.Dark)
    resolveProvider()
    mock.fireDidChangeActiveColorTheme()
    expect(mock.calls.postMessage).toContainEqual({
      command: 'set-theme',
      theme: 'dark',
    })
  })

  it('posts set-theme light otherwise', () => {
    mock.setThemeKind(ColorThemeKind.Light)
    resolveProvider()
    mock.fireDidChangeActiveColorTheme()
    expect(mock.calls.postMessage).toContainEqual({
      command: 'set-theme',
      theme: 'light',
    })
  })
})

describe('resolveCustomTextEditor — rename tracking (task 14)', () => {
  beforeEach(() => mock.reset())

  it('follows a direct rename: retitles, rebinds the watcher, guards close', () => {
    const { panel, document } = resolveProvider('/workspace/old.md', 'x\n')
    const firstWatcher = mock.state.watchers[0]

    mock.fireDidRenameFiles(document.uri, Uri.file('/workspace/new.md'))

    expect(panel.title).toBe('new.md')
    expect(firstWatcher.disposed).toBe(true)
    expect(mock.state.watchers).toHaveLength(2)

    // The old document uri closing must NOT dispose the panel after a rename.
    mock.fireDidCloseTextDocument(document)
    expect(panel.dispose).not.toHaveBeenCalled()
  })

  it('directs subsequent webview edits to the renamed uri', async () => {
    const { panel, document } = resolveProvider('/workspace/old.md', 'old\n')
    mock.fireDidRenameFiles(document.uri, Uri.file('/workspace/new.md'))

    await panel._receiveMessage({ command: 'edit', content: 'changed\n' })
    expect(mock.calls.appliedEdits).toHaveLength(1)
    expect(mock.calls.appliedEdits[0].replacements[0].uri.fsPath).toBe(
      '/workspace/new.md'
    )
  })

  it('ignores renames of other files', () => {
    const { panel } = resolveProvider('/workspace/note.md', 'x\n')
    mock.fireDidRenameFiles(
      Uri.file('/workspace/other.md'),
      Uri.file('/workspace/renamed.md')
    )
    expect(panel.title).toBe('note.md')
  })
})
