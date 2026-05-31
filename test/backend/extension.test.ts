import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { activate, MarkdownEditorProvider } from '../../src/extension'
import { mock, ColorThemeKind, Uri, ViewColumn } from './vscode-mock'

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

  it('creates a levelled log channel and registers it for disposal (task 18 §2d)', () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    const ch = mock.calls.outputChannels.find((c) => c.name === 'vMarkd')
    expect(ch).toBeDefined()
    expect(ch!.options).toMatchObject({ log: true })
    // disposed with the extension (added to context.subscriptions)
    expect(context.subscriptions.length).toBeGreaterThan(0)
    context.subscriptions.forEach((d) => d.dispose())
    expect(ch!.disposed).toBe(true)
  })

  it('routes content-bearing debug logs at trace level only (task 18 §2d)', async () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    const open = mock.calls.registeredCommands.get('markdown-editor.openEditor')!
    await open(Uri.file('/workspace/secret.md'))
    const ch = mock.calls.outputChannels.find((c) => c.name === 'vMarkd')!
    // nothing logged above trace — content never surfaces at the default level
    expect(ch.logs.length).toBeGreaterThan(0)
    expect(ch.logs.every((l) => l.level === 'trace')).toBe(true)
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

  it('passes the outline settings into the init options', async () => {
    mock.setConfig({
      highlightHeadings: true,
      showHeadingMarkers: false,
      fontSize: 'vditor',
      outlinePosition: 'left',
      outlineWidth: 320,
      showOutlineByDefault: true,
      outlineHighlight: false,
    })
    const { panel } = resolveProvider()
    await panel._receiveMessage({ command: 'ready' })
    expect(lastUpdate().options).toMatchObject({
      highlightHeadings: true,
      showHeadingMarkers: false,
      fontSize: 'vditor',
      outlinePosition: 'left',
      outlineWidth: 320,
      showOutlineByDefault: true,
      outlineHighlight: false,
    })
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

  it('strips baked version-specific resource URLs before persisting options (colors-401 bug)', async () => {
    const { panel } = resolveProvider()
    await panel._receiveMessage({
      command: 'save-options',
      options: {
        mode: 'ir',
        preview: {
          theme: {
            current: 'dark',
            path: 'https://x.vscode-cdn.net/home/u/.vscode-server/extensions/spiochacz.vmarkd-0.4.0/media/vditor/dist/css/content-theme',
          },
        },
      },
    })
    const saved = mock.calls.globalStateUpdates.find(
      (u) => u.key === 'vditor.options'
    )!.value
    // the baked path is gone; stable prefs survive
    expect(saved.preview.theme.path).toBeUndefined()
    expect(saved.preview.theme.current).toBe('dark')
    expect(saved.mode).toBe('ir')
  })

  it('does not let a stale saved theme.path leak into the init options', async () => {
    const context = mock.createExtensionContext()
    // simulate dirty globalState carried over from an older install / Settings Sync
    await context.globalState.update('vditor.options', {
      mode: 'ir',
      preview: {
        theme: {
          current: 'dark',
          path: '.vscode-server/extensions/spiochacz.vmarkd-0.4.0/media/vditor/dist/css/content-theme',
        },
      },
    })
    mock.setWorkspaceFolder('/workspace')
    const document = mock.createTextDocument('/workspace/note.md', '# Hi\n')
    const panel = mock.createWebviewPanel()
    new MarkdownEditorProvider(context as any).resolveCustomTextEditor(
      document as any,
      panel as any
    )
    await panel._receiveMessage({ command: 'ready' })
    const init = mock.calls.postMessage
      .filter((m) => m.command === 'update')
      .at(-1)
    expect(init.options.preview?.theme?.path).toBeUndefined()
    expect(init.options.preview?.theme?.current).toBe('dark') // kept
  })
})

describe('sanitizeVditorOptions (colors-401 bug)', () => {
  it('removes any baked webview-resource URL anywhere in the object', () => {
    const cleaned = MarkdownEditorProvider.sanitizeVditorOptions({
      mode: 'ir',
      cdn: 'https://x.vscode-resource.vscode-cdn.net/.../media/vditor',
      preview: {
        hljs: { style: 'github-dark' },
        theme: {
          current: 'dark',
          path: 'https://x.vscode-cdn.net/home/u/.vscode-server/extensions/spiochacz.vmarkd-0.4.0/x',
        },
      },
    })
    expect(cleaned.cdn).toBeUndefined()
    expect(cleaned.preview.theme.path).toBeUndefined()
    expect(cleaned.preview.theme.current).toBe('dark')
    expect(cleaned.preview.hljs.style).toBe('github-dark')
    expect(cleaned.mode).toBe('ir')
  })

  it('does not mutate the input and passes through clean options', () => {
    const input = { theme: 'dark', mode: 'ir', preview: { theme: { current: 'dark' } } }
    const out = MarkdownEditorProvider.sanitizeVditorOptions(input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input) // returns a clone
  })

  it('is a no-op for nullish / non-object input', () => {
    expect(MarkdownEditorProvider.sanitizeVditorOptions(undefined)).toBeUndefined()
    expect(MarkdownEditorProvider.sanitizeVditorOptions(null as any)).toBeNull()
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

describe('resolveCustomTextEditor — live config reload (tasks 12/26)', () => {
  beforeEach(() => mock.reset())

  it('pushes config-changed + reload-css on a markdown-editor config change', async () => {
    resolveProvider()
    mock.setConfig({ enableFullWidth: false, fontSize: '15', customCss: '/* x */' })
    mock.fireDidChangeConfiguration()

    const posted = mock.calls.postMessage
    const configChanged = posted.find((m) => m.command === 'config-changed')
    // carries body-attr options AND the constructor-only ones (re-init keys)
    expect(configChanged?.options).toMatchObject({
      enableFullWidth: false,
      fontSize: '15',
    })
    expect(configChanged?.options).toHaveProperty('showToolbar')
    expect(configChanged?.options).toHaveProperty('wordCount')
    expect(configChanged?.options).toHaveProperty('mermaidTheme')

    const cssMsgs = posted.filter((m) => m.command === 'reload-css')
    expect(cssMsgs.map((m) => m.id)).toEqual(
      expect.arrayContaining(['custom-css', 'external-css'])
    )
    expect(cssMsgs.find((m) => m.id === 'custom-css')?.css).toBe('/* x */')
  })

  it('ignores config changes outside the markdown-editor section', async () => {
    resolveProvider()
    const before = mock.calls.postMessage.length
    mock.fireDidChangeConfiguration('editor')
    expect(mock.calls.postMessage.length).toBe(before)
  })
})

describe('revealInSource command (task 16)', () => {
  beforeEach(() => {
    mock.reset()
    MarkdownEditorProvider.activePanels.clear()
  })

  // Register a fake active panel whose webview replies to get-cursor-offset with
  // the given offset, plus a matching text document, and return the reveal cmd.
  function setup(replyOffset: number, docText: string) {
    const context = mock.createExtensionContext()
    activate(context as any)

    const listeners: Array<(m: any) => void> = []
    const docUri = Uri.file('/note.md')
    const panel = {
      active: true,
      webview: {
        postMessage: vi.fn((msg: any) => {
          if (msg.command === 'get-cursor-offset') {
            // host registers its reply listener before posting → reply now
            listeners.forEach((l) =>
              l({ command: 'cursor-offset', offset: replyOffset })
            )
          }
          return true
        }),
        onDidReceiveMessage: (cb: any) => {
          listeners.push(cb)
          return { dispose: vi.fn() }
        },
      },
    }
    MarkdownEditorProvider.activePanels.add({ panel: panel as any, uri: docUri })
    mock.setDocument(docUri.fsPath, docText)

    const reveal = mock.calls.registeredCommands.get(
      'markdown-editor.revealInSource'
    )!
    return { reveal, docUri }
  }

  it('is registered on activate', () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    expect([...mock.calls.registeredCommands.keys()]).toContain(
      'markdown-editor.revealInSource'
    )
  })

  it('opens the source beside and selects the caret line', async () => {
    const text = 'first line\nsecond line here\nthird\n'
    // offset 14 → inside "second line here" (line 1)
    const { reveal } = setup(14, text)
    await reveal()

    const editor = mock.calls.shownTextEditors.at(-1)
    expect(editor).toBeDefined()
    expect(editor.options).toMatchObject({ viewColumn: ViewColumn.Beside })
    expect(editor.selection.anchor.line).toBe(1)
    expect(editor.selection.anchor.character).toBe(0)
    expect(editor.selection.active.line).toBe(1)
    expect(editor.selection.active.character).toBe('second line here'.length)
    expect(editor.revealRange).toHaveBeenCalled()
  })

  it('aborts (opens nothing) when the webview reports offset -1', async () => {
    const { reveal } = setup(-1, 'whatever\n')
    await reveal()
    expect(mock.calls.shownTextEditors).toHaveLength(0)
  })

  it('aborts quietly when there is no active panel', async () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    const reveal = mock.calls.registeredCommands.get(
      'markdown-editor.revealInSource'
    )!
    await reveal()
    expect(mock.calls.shownTextEditors).toHaveLength(0)
  })
})
