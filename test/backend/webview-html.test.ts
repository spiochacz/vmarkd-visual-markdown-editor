import { describe, it, expect, beforeEach } from 'vitest'
import { MarkdownEditorProvider } from '../../src/extension'
import { mock } from './vscode-mock'

function resolveAndGetHtml(customCss = '') {
  mock.setConfig({ customCss })
  mock.setWorkspaceFolder('/workspace')
  const context = mock.createExtensionContext()
  const document = mock.createTextDocument('/workspace/note.md', '# Hello\n')
  const panel = mock.createWebviewPanel()
  const provider = new MarkdownEditorProvider(context as any)
  provider.resolveCustomTextEditor(document as any, panel as any)
  return { panel, html: panel.webview.html }
}

describe('_getHtmlForWebview (via resolveCustomTextEditor)', () => {
  beforeEach(() => mock.reset())

  it('sets the panel title to the file basename', () => {
    const { panel } = resolveAndGetHtml()
    expect(panel.title).toBe('note.md')
  })

  it('applies the scoped webview options', () => {
    const { panel } = resolveAndGetHtml()
    expect(panel.webview.options).toMatchObject({
      enableScripts: true,
      retainContextWhenHidden: true,
      enableCommandUris: true,
    })
  })

  it('renders the app mount point and bundled assets', () => {
    const { html } = resolveAndGetHtml()
    expect(html).toContain('<div id="app">')
    expect(html).toMatch(/<script[^>]+src="[^"]*main\.js"/)
    expect(html).toMatch(/<link[^>]+href="[^"]*main\.css"/)
  })

  it('loads the Vditor icon sprite script before the bundle', () => {
    const { html } = resolveAndGetHtml()
    expect(html).toMatch(/id="vditorIconScript"[^>]+src="[^"]*ant\.js"/)
  })

  it('sets a base href rooted at the document directory', () => {
    const { html } = resolveAndGetHtml()
    const base = /<base href="([^"]+)"/.exec(html)?.[1]
    expect(base).toBeDefined()
    expect(base).toContain('/workspace')
    expect(base!.endsWith('/')).toBe(true)
  })

  it('injects configured customCss into a <style> block', () => {
    const sentinel = '/* sentinel-custom-css */ body { color: red; }'
    const { html } = resolveAndGetHtml(sentinel)
    expect(html).toContain(sentinel)
  })
})
