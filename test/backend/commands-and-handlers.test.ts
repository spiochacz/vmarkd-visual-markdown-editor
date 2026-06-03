import { describe, it, expect, beforeEach } from 'vitest'
import { activate, MarkdownEditorProvider } from '../../src/extension'
import {
  mock,
  Uri,
  TabInputTextDiff,
  TabInputText,
  TabInputCustom,
  ViewColumn,
} from './vscode-mock'

const VIEW_TYPE = 'vmarkd.editor'

function activateAndGetCommand(id: string) {
  const context = mock.createExtensionContext()
  activate(context as any)
  return mock.calls.registeredCommands.get(id)!
}

function openWithCalls() {
  return mock.calls.executeCommand.filter(
    (c) => c.command === 'vscode.openWith',
  )
}

describe('command: vmarkd.openEditor', () => {
  beforeEach(() => mock.reset())

  it('opens an explicit markdown uri with the custom editor', async () => {
    const open = activateAndGetCommand('vmarkd.openEditor')
    const uri = Uri.file('/workspace/note.md')
    await open(uri)
    expect(openWithCalls()).toContainEqual({
      command: 'vscode.openWith',
      args: [uri, VIEW_TYPE],
    })
  })

  it('falls back to the active text editor when no uri is passed', async () => {
    const open = activateAndGetCommand('vmarkd.openEditor')
    mock.setActiveTextEditor(Uri.file('/workspace/active.md'))
    await open()
    expect(openWithCalls().at(-1)?.args[0].fsPath).toBe('/workspace/active.md')
  })

  it('errors when no markdown target can be found', async () => {
    const open = activateAndGetCommand('vmarkd.openEditor')
    await open()
    expect(openWithCalls()).toHaveLength(0)
    expect(mock.calls.showError.join(' ')).toContain(
      'Cannot find markdown file',
    )
  })

  it('rejects non-markdown files', async () => {
    const open = activateAndGetCommand('vmarkd.openEditor')
    await open(Uri.file('/workspace/notes.txt'))
    expect(openWithCalls()).toHaveLength(0)
    expect(mock.calls.showError.join(' ')).toContain('local markdown files')
  })

  it('refuses to open inside a diff editor', async () => {
    const open = activateAndGetCommand('vmarkd.openEditor')
    const uri = Uri.file('/workspace/note.md')
    mock.setActiveTab(new TabInputTextDiff(uri, Uri.file('/workspace/old.md')))
    await open(uri)
    expect(openWithCalls()).toHaveLength(0)
    expect(mock.calls.showError.join(' ')).toContain('diff editors')
  })
})

describe('command: vmarkd.openEditor — tab dedup (task 36)', () => {
  beforeEach(() => mock.reset())

  it('reveals an existing vMarkd tab in its column instead of duplicating', async () => {
    const open = activateAndGetCommand('vmarkd.openEditor')
    const uri = Uri.file('/workspace/note.md')
    mock.setTabGroups([
      {
        viewColumn: 1,
        inputs: [new TabInputText(Uri.file('/workspace/other.md'))],
      },
      { viewColumn: 2, inputs: [new TabInputCustom(uri, VIEW_TYPE)] },
    ])
    await open(uri)
    expect(openWithCalls()).toContainEqual({
      command: 'vscode.openWith',
      args: [uri, VIEW_TYPE, { viewColumn: 2 }],
    })
  })

  it('opens normally when only a text (not vMarkd) tab exists for the file', async () => {
    const open = activateAndGetCommand('vmarkd.openEditor')
    const uri = Uri.file('/workspace/note.md')
    mock.setTabGroups([{ viewColumn: 1, inputs: [new TabInputText(uri)] }])
    await open(uri)
    expect(openWithCalls()).toContainEqual({
      command: 'vscode.openWith',
      args: [uri, VIEW_TYPE],
    })
  })
})

describe('command: vmarkd.openSourceToSide (task 36)', () => {
  beforeEach(() => mock.reset())

  it('opens the source in the adjacent column when no source tab exists', async () => {
    const open = activateAndGetCommand('vmarkd.openSourceToSide')
    const uri = Uri.file('/workspace/note.md')
    await open(uri)
    expect(openWithCalls()).toContainEqual({
      command: 'vscode.openWith',
      args: [uri, 'default', { viewColumn: ViewColumn.Beside }],
    })
  })

  it('focuses an existing source tab in its own column (no duplicate)', async () => {
    const open = activateAndGetCommand('vmarkd.openSourceToSide')
    const uri = Uri.file('/workspace/note.md')
    mock.setTabGroups([
      { viewColumn: 1, inputs: [new TabInputCustom(uri, VIEW_TYPE)] },
      { viewColumn: 2, inputs: [new TabInputText(uri)] },
    ])
    await open(uri)
    expect(openWithCalls()).toContainEqual({
      command: 'vscode.openWith',
      args: [uri, 'default', { viewColumn: 2 }],
    })
  })

  it('rejects non-markdown files', async () => {
    const open = activateAndGetCommand('vmarkd.openSourceToSide')
    await open(Uri.file('/workspace/notes.txt'))
    expect(openWithCalls()).toHaveLength(0)
    expect(mock.calls.showError.join(' ')).toContain('local markdown files')
  })
})

describe('command: vmarkd.openInSplit', () => {
  beforeEach(() => mock.reset())

  it('opens the visual editor beside the current view', async () => {
    const open = activateAndGetCommand('vmarkd.openInSplit')
    const uri = Uri.file('/workspace/note.md')
    await open(uri)
    expect(openWithCalls()).toContainEqual({
      command: 'vscode.openWith',
      args: [uri, VIEW_TYPE, ViewColumn.Beside],
    })
  })

  it('falls back to the active text editor when no uri is passed', async () => {
    const open = activateAndGetCommand('vmarkd.openInSplit')
    mock.setActiveTextEditor(Uri.file('/workspace/active.md'))
    await open()
    const call = openWithCalls().at(-1)
    expect(call?.args[0].fsPath).toBe('/workspace/active.md')
    expect(call?.args[2]).toBe(ViewColumn.Beside)
  })

  it('rejects non-markdown files', async () => {
    const open = activateAndGetCommand('vmarkd.openInSplit')
    await open(Uri.file('/workspace/notes.txt'))
    expect(openWithCalls()).toHaveLength(0)
    expect(mock.calls.showError.join(' ')).toContain('local markdown files')
  })

  it('refuses to open inside a diff editor', async () => {
    const open = activateAndGetCommand('vmarkd.openInSplit')
    const uri = Uri.file('/workspace/note.md')
    mock.setActiveTab(new TabInputTextDiff(uri, Uri.file('/workspace/old.md')))
    await open(uri)
    expect(openWithCalls()).toHaveLength(0)
    expect(mock.calls.showError.join(' ')).toContain('diff editors')
  })
})

describe('command: vmarkd.openTextEditor', () => {
  beforeEach(() => mock.reset())

  it('reopens the uri in the default (text) editor', async () => {
    const openText = activateAndGetCommand('vmarkd.openTextEditor')
    const uri = Uri.file('/workspace/note.md')
    await openText(uri)
    expect(mock.calls.executeCommand).toContainEqual({
      command: 'vscode.openWith',
      args: [uri, 'default'],
    })
  })
})

describe('command: vmarkd.openSettings', () => {
  beforeEach(() => mock.reset())

  it('opens the Settings UI filtered to this extension', async () => {
    const openSettings = activateAndGetCommand('vmarkd.openSettings')
    await openSettings()
    expect(mock.calls.executeCommand).toContainEqual({
      command: 'workbench.action.openSettings',
      args: ['@ext:spiochacz.vmarkd'],
    })
  })
})

function resolveProvider(fsPath = '/workspace/note.md', text = '# doc\n') {
  mock.setWorkspaceFolder('/workspace')
  const context = mock.createExtensionContext()
  const document = mock.createTextDocument(fsPath, text)
  const panel = mock.createWebviewPanel()
  new MarkdownEditorProvider(context as any).resolveCustomTextEditor(
    document as any,
    panel as any,
  )
  return { document, panel }
}

describe('message handler: upload', () => {
  beforeEach(() => mock.reset())

  it('writes the decoded files under the assets folder and reports back', async () => {
    const { panel } = resolveProvider('/workspace/note.md')
    await panel._receiveMessage({
      command: 'upload',
      files: [{ base64: 'aGk=', name: 'img.png' }], // "hi"
    })

    expect(
      mock.calls.fsDirsCreated.some((u) => u.fsPath === '/workspace/assets'),
    ).toBe(true)

    expect(mock.calls.fsWrites).toHaveLength(1)
    expect(mock.calls.fsWrites[0].uri.fsPath).toBe('/workspace/assets/img.png')
    expect(Buffer.from(mock.calls.fsWrites[0].content).toString('utf8')).toBe(
      'hi',
    )

    expect(mock.calls.postMessage).toContainEqual({
      command: 'uploaded',
      files: ['assets/img.png'],
    })
  })

  it('refuses to write and warns when the workspace is untrusted', async () => {
    mock.setTrusted(false)
    const { panel } = resolveProvider('/workspace/note.md')
    await panel._receiveMessage({
      command: 'upload',
      files: [{ base64: 'aGk=', name: 'img.png' }],
    })
    expect(mock.calls.fsWrites).toHaveLength(0)
    expect(mock.calls.showWarning.length).toBeGreaterThan(0)
  })
})

describe('message handler: open-settings', () => {
  beforeEach(() => mock.reset())

  it('runs the openSettings command (toolbar gear → settings)', async () => {
    const { panel } = resolveProvider()
    await panel._receiveMessage({ command: 'open-settings' })
    expect(mock.calls.executeCommand).toContainEqual({
      command: 'vmarkd.openSettings',
      args: [],
    })
  })
})

describe('message handler: open-link', () => {
  beforeEach(() => mock.reset())

  it('opens an http(s) link in the external browser (env.openExternal)', async () => {
    const { panel } = resolveProvider()
    await panel._receiveMessage({
      command: 'open-link',
      href: 'https://example.com/page',
    })
    // external URLs go to the system browser, NOT vscode.open
    expect(mock.calls.openExternal.map((u) => u.toString())).toContain(
      'https://example.com/page',
    )
    expect(
      mock.calls.executeCommand.find((c) => c.command === 'vscode.open'),
    ).toBeUndefined()
  })

  it('resolves a relative link against the document directory', async () => {
    const { panel } = resolveProvider('/workspace/note.md')
    await panel._receiveMessage({ command: 'open-link', href: 'docs/page.md' })
    const call = mock.calls.executeCommand.find(
      (c) => c.command === 'vscode.open',
    )
    expect(call).toBeDefined()
    expect(call!.args[0].fsPath).toBe('/workspace/docs/page.md')
  })
})
