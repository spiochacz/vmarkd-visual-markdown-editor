import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownEditorProvider } from '../../src/extension'
import { mock } from './vscode-mock'

vi.mock('node:fs', async (importOriginal) => {
  const real = (await importOriginal()) as any
  return { ...real, readFileSync: vi.fn(() => '') }
})
import { readFileSync } from 'node:fs'
const mockReadFileSync = vi.mocked(readFileSync)

// Tests for custom CSS (vmarkd.css.custom) and external CSS files
// (vmarkd.css.external) — both the init HTML injection and the live reload
// push. Covers the feature from tasks 12/26 and the sanitization from task 18.

function resolveProvider(fsPath = '/workspace/note.md', text = '# Hi\n') {
  mock.setWorkspaceFolder('/workspace')
  const context = mock.createExtensionContext()
  const document = mock.createTextDocument(fsPath, text)
  const panel = mock.createWebviewPanel()
  const provider = new MarkdownEditorProvider(context as any)
  provider.resolveCustomTextEditor(document as any, panel as any)
  return { context, document, panel, provider }
}

function reloadCssMsgs() {
  return mock.calls.postMessage.filter((m: any) => m.command === 'reload-css')
}

describe('custom CSS — init HTML', () => {
  beforeEach(() => mock.reset())

  it('injects css.custom content into the initial HTML', () => {
    mock.setConfig({ 'css.custom': 'body { background: red; }' })
    const { panel } = resolveProvider()
    expect(panel.webview.html).toContain('body { background: red; }')
  })

  it('renders an empty <style> block when css.custom is unset', () => {
    const { panel } = resolveProvider()
    expect(panel.webview.html).toContain('<style id="custom-css">')
    const match = panel.webview.html.match(
      /<style id="custom-css">([\s\S]*?)<\/style>/,
    )
    expect(match).toBeTruthy()
    expect(match![1].trim()).toBe('')
  })

  it('custom-css <style> appears after external-css (custom wins on conflict)', () => {
    mock.setConfig({ 'css.custom': '/* custom */' })
    const { panel } = resolveProvider()
    const html = panel.webview.html
    expect(html.indexOf('id="external-css"')).toBeLessThan(
      html.indexOf('id="custom-css"'),
    )
  })
})

describe('external CSS files — init HTML', () => {
  beforeEach(() => mock.reset())
  afterEach(() => mockReadFileSync.mockReset())

  it('reads css.external files and injects their content into init HTML', () => {
    mock.setConfig({ 'css.external': ['/workspace/style.css'] })
    mockReadFileSync.mockReturnValue('.custom-class { color: blue; }')
    const { panel } = resolveProvider()
    expect(panel.webview.html).toContain('.custom-class { color: blue; }')
  })

  it('concatenates multiple external CSS files', () => {
    mock.setConfig({
      'css.external': ['/workspace/a.css', '/workspace/b.css'],
    })
    mockReadFileSync.mockImplementation((p: any) => {
      if (String(p).endsWith('a.css')) return '/* file-a */'
      if (String(p).endsWith('b.css')) return '/* file-b */'
      throw new Error('not found')
    })
    const { panel } = resolveProvider()
    expect(panel.webview.html).toContain('/* file-a */')
    expect(panel.webview.html).toContain('/* file-b */')
  })

  it('silently skips missing / unreadable external CSS files', () => {
    mock.setConfig({
      'css.external': ['/workspace/missing.css', '/workspace/ok.css'],
    })
    mockReadFileSync.mockImplementation((p: any) => {
      if (String(p).endsWith('ok.css')) return '/* ok */'
      throw new Error('ENOENT')
    })
    const { panel } = resolveProvider()
    expect(panel.webview.html).toContain('/* ok */')
    expect(panel.webview.html).not.toContain('ENOENT')
  })

  it('passes absolute paths directly to readFileSync', () => {
    mock.setConfig({ 'css.external': ['/workspace/styles/theme.css'] })
    mockReadFileSync.mockReturnValue('/* resolved */')
    resolveProvider()
    expect(mockReadFileSync).toHaveBeenCalledWith(
      '/workspace/styles/theme.css',
      'utf8',
    )
  })
})

describe('custom CSS — live reload', () => {
  beforeEach(() => mock.reset())

  it('pushes reload-css with updated css.custom on config change', () => {
    resolveProvider()
    mock.setConfig({ 'css.custom': '/* updated */' })
    mock.fireDidChangeConfiguration()

    const customMsg = reloadCssMsgs().find((m: any) => m.id === 'custom-css')
    expect(customMsg).toBeDefined()
    expect(customMsg!.css).toBe('/* updated */')
  })

  it('pushes empty string when css.custom is cleared', () => {
    mock.setConfig({ 'css.custom': '/* initial */' })
    resolveProvider()
    mock.setConfig({ 'css.custom': '' })
    mock.fireDidChangeConfiguration()

    const msgs = reloadCssMsgs().filter((m: any) => m.id === 'custom-css')
    expect(msgs.at(-1)!.css).toBe('')
  })

  it('always pushes both custom-css and external-css on a config change', () => {
    resolveProvider()
    mock.fireDidChangeConfiguration()
    const ids = reloadCssMsgs().map((m: any) => m.id)
    expect(ids).toContain('custom-css')
    expect(ids).toContain('external-css')
  })
})

describe('external CSS files — live reload via file watcher', () => {
  beforeEach(() => mock.reset())
  afterEach(() => mockReadFileSync.mockReset())

  it('pushes reload-css when an external CSS file changes on disk', () => {
    mock.setConfig({ 'css.external': ['/workspace/theme.css'] })
    mockReadFileSync.mockReturnValue('/* v1 */')
    resolveProvider()

    // Clear init messages to isolate the watcher push.
    mock.calls.postMessage.length = 0

    mockReadFileSync.mockReturnValue('/* v2 */')
    const watchers = mock.state.watchers
    expect(watchers.length).toBeGreaterThan(0)
    watchers.at(-1)!.fireChange()

    const extMsg = reloadCssMsgs().find((m: any) => m.id === 'external-css')
    expect(extMsg).toBeDefined()
    expect(extMsg!.css).toContain('/* v2 */')
  })

  it('creates file watchers for each external CSS path', () => {
    mock.setConfig({
      'css.external': ['/workspace/a.css', '/workspace/b.css'],
    })
    mockReadFileSync.mockReturnValue('')
    resolveProvider()
    expect(mock.state.watchers.length).toBeGreaterThanOrEqual(2)
  })

  it('does not create watchers when css.external is empty', () => {
    mock.setConfig({ 'css.external': [] })
    const before = mock.state.watchers.length
    resolveProvider()
    // Only the document file watcher, no CSS watchers.
    expect(mock.state.watchers.length).toBeLessThanOrEqual(before + 1)
  })
})
