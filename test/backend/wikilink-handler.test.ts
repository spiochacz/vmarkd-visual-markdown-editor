import { beforeEach, describe, expect, it } from 'vitest'
import { MarkdownEditorProvider } from '../../src/extension'
import { _resetCacheMap } from '../../src/wiki-cache'
import { FileType, mock, Uri } from './vscode-mock'

// Drives the `open-wikilink` webview message — the wiki-link click flow in
// _getHtmlForWebview's onDidReceiveMessage (resolveWikiLink + the five outcomes:
// disabled / invalid / missing(+create) / ambiguous(+pick) / resolved).
const F = FileType.File
const D = FileType.Directory
const VIEW = 'vmarkd.editor'

function mountFs(tree: Record<string, [string, number][]>) {
  mock.setReadDirectory(async (uri: Uri) => tree[uri.fsPath] ?? [])
}

function openWiki(fsPath = '/ws/wiki/Home.md') {
  mock.setWorkspaceFolder('/ws')
  const context = mock.createExtensionContext()
  const document = mock.createTextDocument(fsPath, '# Home\n')
  const panel = mock.createWebviewPanel()
  new MarkdownEditorProvider(context as any).resolveCustomTextEditor(
    document as any,
    panel as any,
  )
  return panel
}

function openWithCalls() {
  return mock.calls.executeCommand.filter(
    (c) => c.command === 'vscode.openWith',
  )
}

describe('message handler: open-wikilink', () => {
  beforeEach(() => {
    mock.reset()
    _resetCacheMap()
  })

  it('opens a uniquely-resolved page in the custom editor', async () => {
    mountFs({
      '/ws/wiki': [
        ['Home.md', F],
        ['Other Page.md', F],
      ],
    })
    const panel = openWiki()
    await panel._receiveMessage({
      command: 'open-wikilink',
      target: 'Other Page',
    })
    expect(
      openWithCalls().some(
        (c) =>
          c.args[0].fsPath === '/ws/wiki/Other Page.md' && c.args[1] === VIEW,
      ),
    ).toBe(true)
  })

  it('errors and opens nothing when the file is not in a wiki (disabled)', async () => {
    mountFs({})
    const panel = openWiki('/ws/docs/note.md')
    await panel._receiveMessage({ command: 'open-wikilink', target: 'Home' })
    expect(mock.calls.showError.length).toBeGreaterThan(0)
    expect(openWithCalls()).toHaveLength(0)
  })

  it('errors on an empty/invalid target', async () => {
    mountFs({ '/ws/wiki': [['Home.md', F]] })
    const panel = openWiki()
    await panel._receiveMessage({ command: 'open-wikilink', target: '   ' })
    expect(mock.calls.showError.length).toBeGreaterThan(0)
    expect(openWithCalls()).toHaveLength(0)
  })

  it('creates a missing page (with a title heading) on confirm, then opens it', async () => {
    mountFs({ '/ws/wiki': [['Home.md', F]] })
    mock.setWarningResponse('Create Page')
    mock.setTrusted(true)
    const panel = openWiki()
    await panel._receiveMessage({
      command: 'open-wikilink',
      target: 'New Topic',
    })
    const write = mock.calls.fsWrites.find(
      (w) => w.uri.fsPath === '/ws/wiki/new-topic.md',
    )
    expect(write).toBeDefined()
    expect(Buffer.from(write!.content).toString()).toBe('# New Topic\n')
    expect(
      openWithCalls().some((c) => c.args[0].fsPath === '/ws/wiki/new-topic.md'),
    ).toBe(true)
  })

  it('creates nothing when the missing-page prompt is dismissed', async () => {
    mountFs({ '/ws/wiki': [['Home.md', F]] })
    mock.setWarningResponse(undefined)
    const panel = openWiki()
    await panel._receiveMessage({
      command: 'open-wikilink',
      target: 'New Topic',
    })
    expect(mock.calls.fsWrites).toHaveLength(0)
    expect(openWithCalls()).toHaveLength(0)
  })

  it('lets the user pick among ambiguous matches, then opens the choice', async () => {
    mountFs({
      '/ws/wiki': [
        ['Home.md', F],
        ['a', D],
        ['b', D],
      ],
      '/ws/wiki/a': [['Page.md', F]],
      '/ws/wiki/b': [['Page.md', F]],
    })
    mock.setQuickPickResponse({ uri: Uri.file('/ws/wiki/b/Page.md') })
    const panel = openWiki()
    await panel._receiveMessage({ command: 'open-wikilink', target: 'Page' })
    expect(
      openWithCalls().some((c) => c.args[0].fsPath === '/ws/wiki/b/Page.md'),
    ).toBe(true)
  })
})

// Regression guard: the `list-wiki-pages` command must stay registered under that
// exact key. A field-promotion refactor once rewrote the map key to
// 'list-this.wiki-pages', silently unregistering the command — uncaught because it
// had no test. These cover the picker flow end to end.
describe('message handler: list-wiki-pages', () => {
  beforeEach(() => {
    mock.reset()
    _resetCacheMap()
  })

  it('lists the wiki pages and opens the chosen one', async () => {
    mountFs({
      '/ws/wiki': [
        ['Home.md', F],
        ['Other Page.md', F],
      ],
    })
    mock.setQuickPickResponse({ uri: Uri.file('/ws/wiki/Other Page.md') })
    const panel = openWiki()
    await panel._receiveMessage({ command: 'list-wiki-pages' })
    expect(
      openWithCalls().some(
        (c) =>
          c.args[0].fsPath === '/ws/wiki/Other Page.md' && c.args[1] === VIEW,
      ),
    ).toBe(true)
  })

  it('opens nothing when the file is not inside a wiki', async () => {
    mountFs({})
    const panel = openWiki('/ws/docs/note.md')
    await panel._receiveMessage({ command: 'list-wiki-pages' })
    expect(openWithCalls()).toHaveLength(0)
  })
})
