import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { activate, MarkdownEditorProvider } from '../../src/extension'
import { mock, ColorThemeKind, Uri, ViewColumn } from './vscode-mock'

function resolveProvider(
  fsPath = '/workspace/note.md',
  text = 'old content\n',
) {
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
      expect.arrayContaining(['vmarkd.openEditor', 'vmarkd.openTextEditor']),
    )
    expect(mock.calls.customEditor?.viewType).toBe('vmarkd.editor')
    expect(mock.calls.customEditor?.options.webviewOptions).toMatchObject({
      retainContextWhenHidden: true,
      enableFindWidget: true,
    })
  })

  it('marks the vmarkd.options key for settings sync', () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    expect(mock.calls.setKeysForSync).toContainEqual(
      expect.arrayContaining(['vmarkd.options', 'vmarkd.outlineWidth']),
    )
  })

  it('creates a levelled log channel and registers it for disposal (task 18 §2d)', () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    const ch = mock.calls.outputChannels.find((c) => c.name === 'vMarkd')
    expect(ch).toBeDefined()
    expect(ch!.options).toMatchObject({ log: true })
    // disposed with the extension (added to context.subscriptions)
    expect(context.subscriptions.length).toBeGreaterThan(0)
    context.subscriptions.forEach((d) => {
      d.dispose()
    })
    expect(ch!.disposed).toBe(true)
  })

  it('routes content-bearing debug logs at trace level only (task 18 §2d)', async () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    const open = mock.calls.registeredCommands.get('vmarkd.openEditor')!
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
      wiki: { enabled: true },
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
      'theme.highlightHeadings': true,
      'editor.headingMarkers': false,
      'editor.fontSize': 'vditor',
      'outline.position': 'left',
      'outline.openByDefault': true,
      'outline.highlight': false,
    })
    const { panel } = resolveProvider()
    await panel._receiveMessage({ command: 'ready' })
    expect(lastUpdate().options).toMatchObject({
      highlightHeadings: true,
      showHeadingMarkers: false,
      fontSize: 'vditor',
      outlinePosition: 'left',
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
    expect(mock.calls.appliedEdits[0].replacements[0].content).toBe(
      'new content\n',
    )
    expect(document.getText()).toBe('new content\n')
  })

  it('does NOT apply an edit when content is unchanged (CRLF-insensitive)', async () => {
    const { panel } = resolveProvider('/workspace/note.md', 'line a\nline b\n')
    await panel._receiveMessage({
      command: 'edit',
      content: 'line a\r\nline b\r\n',
    })
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

  it('copies HTML to the host clipboard and reports success (task 53 #1)', async () => {
    const { panel } = resolveProvider('/workspace/note.md', '# Hi\n')
    await panel._receiveMessage({
      command: 'copy-html',
      content: '<p>Hi</p>',
    })
    expect(mock.calls.clipboard).toEqual(['<p>Hi</p>'])
    expect(mock.calls.showInformation).toContain('Copy HTML successfully!')
  })

  it('copies Markdown to the host clipboard and reports success (task 53 #1)', async () => {
    const { panel } = resolveProvider('/workspace/note.md', '# Hi\n')
    await panel._receiveMessage({
      command: 'copy-markdown',
      content: '# Hi\n',
    })
    expect(mock.calls.clipboard).toEqual(['# Hi\n'])
    expect(mock.calls.showInformation).toContain('Copy Markdown successfully!')
  })

  it('persists vditor options on "save-options"', async () => {
    const { panel } = resolveProvider()
    await panel._receiveMessage({
      command: 'save-options',
      options: { mode: 'ir' },
    })
    expect(mock.calls.globalStateUpdates).toContainEqual({
      key: 'vmarkd.options',
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
      (u) => u.key === 'vmarkd.options',
    )!.value
    // the baked path is gone; stable prefs survive
    expect(saved.preview.theme.path).toBeUndefined()
    expect(saved.preview.theme.current).toBe('dark')
    expect(saved.mode).toBe('ir')
  })

  it('does not let a stale saved theme.path leak into the init options', async () => {
    const context = mock.createExtensionContext()
    // simulate dirty globalState carried over from an older install / Settings Sync
    await context.globalState.update('vmarkd.options', {
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
      panel as any,
    )
    await panel._receiveMessage({ command: 'ready' })
    const init = mock.calls.postMessage
      .filter((m) => m.command === 'update')
      .at(-1)
    expect(init.options.preview?.theme?.path).toBeUndefined()
    expect(init.options.preview?.theme?.current).toBe('dark') // kept
  })
})

describe('edit-in-vscode reveals the caret line (task 16)', () => {
  beforeEach(() => mock.reset())

  it('opens the source and selects the caret line reported by the webview', async () => {
    const text = 'first line\nsecond line here\nthird line\n'
    const { panel } = resolveProvider('/workspace/note.md', text)
    // the webview will answer get-cursor-offset with this line + text
    mock.setCursorReply({ line: 1, lineText: 'second line here' })

    await panel._receiveMessage({ command: 'edit-in-vscode' })

    const editor = mock.calls.shownTextEditors.at(-1)
    expect(editor).toBeDefined()
    expect(editor.selection.active.line).toBe(1)
    expect(editor.selection.active.character).toBe('second line here'.length)
    expect(editor.revealRange).toHaveBeenCalled()
  })

  it('still opens the source (at the top) when the cursor cannot be resolved', async () => {
    const { panel } = resolveProvider('/workspace/note.md', 'a\nb\n')
    mock.setCursorReply({ line: -1, lineText: '' })
    await panel._receiveMessage({ command: 'edit-in-vscode' })
    // falls back to just opening the editor — no selection jump, but it opens
    const editor = mock.calls.shownTextEditors.at(-1)
    expect(editor).toBeDefined()
    expect(editor.selection?.active.line ?? 0).toBe(0)
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
    const input = {
      theme: 'dark',
      mode: 'ir',
      preview: { theme: { current: 'dark' } },
    }
    const out = MarkdownEditorProvider.sanitizeVditorOptions(input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input) // returns a clone
  })

  it('is a no-op for nullish / non-object input', () => {
    expect(
      MarkdownEditorProvider.sanitizeVditorOptions(undefined),
    ).toBeUndefined()
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
    const { document } = resolveProvider('/workspace/note.md', 'old\n')

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

  it('a GitHub content theme pins the editor mode to its own light/dark (task 82)', () => {
    // github-dark under a LIGHT VS Code theme renders dark content (incl. code
    // blocks); the toolbar stays VS Code-coloured via mode-independent CSS vars.
    mock.setThemeKind(ColorThemeKind.Light)
    mock.setConfig({ 'theme.content': 'github-dark' })
    resolveProvider()
    mock.fireDidChangeActiveColorTheme()
    expect(mock.calls.postMessage).toContainEqual({
      command: 'set-theme',
      theme: 'dark',
    })
  })

  it('github-light pins light mode even under a dark VS Code theme (task 82)', () => {
    mock.setThemeKind(ColorThemeKind.Dark)
    mock.setConfig({ 'theme.content': 'github-light' })
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
      '/workspace/new.md',
    )
  })

  it('ignores renames of other files', () => {
    const { panel } = resolveProvider('/workspace/note.md', 'x\n')
    mock.fireDidRenameFiles(
      Uri.file('/workspace/other.md'),
      Uri.file('/workspace/renamed.md'),
    )
    expect(panel.title).toBe('note.md')
  })
})

describe('resolveCustomTextEditor — live config reload (tasks 12/26)', () => {
  beforeEach(() => mock.reset())

  it('pushes config-changed + reload-css on a vmarkd config change', async () => {
    resolveProvider()
    mock.setConfig({
      'editor.fullWidth': false,
      'editor.fontSize': '15',
      'css.custom': '/* x */',
    })
    mock.fireDidChangeConfiguration()

    const posted = mock.calls.postMessage
    const configChanged = posted.find((m) => m.command === 'config-changed')
    // carries body-attr options AND the constructor-only ones (re-init keys)
    expect(configChanged?.options).toMatchObject({
      enableFullWidth: false,
      fontSize: '15',
    })
    expect(configChanged?.options).toHaveProperty('showToolbar')
    expect(configChanged?.options).toHaveProperty('mermaidTheme')

    const cssMsgs = posted.filter((m) => m.command === 'reload-css')
    expect(cssMsgs.map((m) => m.id)).toEqual(
      expect.arrayContaining(['custom-css', 'external-css']),
    )
    expect(cssMsgs.find((m) => m.id === 'custom-css')?.css).toBe('/* x */')
  })

  it('ignores config changes outside the vmarkd section', async () => {
    resolveProvider()
    const before = mock.calls.postMessage.length
    mock.fireDidChangeConfiguration('editor')
    expect(mock.calls.postMessage.length).toBe(before)
  })

  it('config-changed carries contentTheme + the effective mode (task 82)', () => {
    mock.setThemeKind(ColorThemeKind.Light)
    resolveProvider()
    mock.setConfig({ 'theme.content': 'github-dark' })
    mock.fireDidChangeConfiguration()

    const configChanged = mock.calls.postMessage.find(
      (m) => m.command === 'config-changed',
    )
    // a GitHub theme themes the CONTENT (useVscodeThemeColor off → VS Code content
    // rules disabled) and pins the mode (dark) so content/code follow it.
    expect(configChanged?.options).toMatchObject({
      contentTheme: 'github-dark',
      useVscodeThemeColor: false,
    })
    expect(configChanged?.theme).toBe('dark')
  })
})

describe('openSourceToSide reveals the caret (tasks 16 + 36)', () => {
  beforeEach(() => {
    mock.reset()
    MarkdownEditorProvider.activePanels.clear()
  })

  // Register a fake vMarkd panel for /note.md whose webview replies to
  // get-cursor-offset with the given { line, lineText }, plus a matching text
  // document, and return the openSourceToSide command bound to that uri.
  function setup(reply: { line: number; lineText: string }, docText: string) {
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
            listeners.forEach((l) => {
              l({ command: 'cursor-offset', ...reply })
            })
          }
          return true
        }),
        onDidReceiveMessage: (cb: any) => {
          listeners.push(cb)
          return { dispose: vi.fn() }
        },
      },
    }
    MarkdownEditorProvider.activePanels.add({
      panel: panel as any,
      uri: docUri,
    })
    mock.setDocument(docUri.fsPath, docText)

    const cmd = mock.calls.registeredCommands.get('vmarkd.openSourceToSide')!
    return { run: () => cmd(docUri), docUri }
  }

  it('is registered on activate', () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    expect([...mock.calls.registeredCommands.keys()]).toContain(
      'vmarkd.openSourceToSide',
    )
  })

  it('opens the source beside and selects the caret line', async () => {
    const text = 'first line\nsecond line here\nthird\n'
    const { run } = setup({ line: 1, lineText: 'second line here' }, text)
    await run()

    const editor = mock.calls.shownTextEditors.at(-1)
    expect(editor).toBeDefined()
    expect(editor.options).toMatchObject({ viewColumn: ViewColumn.Beside })
    expect(editor.selection.anchor.line).toBe(1)
    expect(editor.selection.anchor.character).toBe(0)
    expect(editor.selection.active.line).toBe(1)
    expect(editor.selection.active.character).toBe('second line here'.length)
    expect(editor.revealRange).toHaveBeenCalled()
  })

  it('matches by line content when the reported line is off (Vditor reflow)', async () => {
    // On disk the heading has no blank line after it; Vditor's getValue() added
    // one, so the webview reports line 3 — but the on-disk line is 2. Matching by
    // content lands on the correct line regardless.
    const text = '# Title\nFirst paragraph.\nTarget line here.\nLast.\n'
    const { run } = setup({ line: 3, lineText: 'Target line here.' }, text)
    await run()
    const editor = mock.calls.shownTextEditors.at(-1)
    expect(editor.selection.active.line).toBe(2) // real line, not the reported 3
    expect(editor.selection.active.character).toBe('Target line here.'.length)
  })

  it('still opens the source (no jump) when the webview reports line -1', async () => {
    const { run } = setup({ line: -1, lineText: '' }, 'whatever\n')
    await run()
    // unified behavior: always open the editor; only the line jump is skipped
    const editor = mock.calls.shownTextEditors.at(-1)
    expect(editor).toBeDefined()
    expect(editor.selection).toBeUndefined() // no selection set
  })

  it('falls back to plain open (no caret query) when no vMarkd panel exists', async () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    mock.setDocument('/orphan.md', 'a\nb\n')
    const cmd = mock.calls.registeredCommands.get('vmarkd.openSourceToSide')!
    await cmd(Uri.file('/orphan.md'))
    // no panel → opens via vscode.openWith default; never queries the cursor
    expect(mock.calls.shownTextEditors).toHaveLength(0)
    expect(mock.calls.executeCommand).toContainEqual(
      expect.objectContaining({ command: 'vscode.openWith' }),
    )
  })
})
