import { describe, it, expect, beforeEach } from 'vitest'
import { MarkdownEditorProvider } from '../../src/extension'
import { mock, ThemeIcon, Uri } from './vscode-mock'

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

  it('sets a markdown ThemeIcon on the editor tab', () => {
    const { panel } = resolveAndGetHtml()
    expect(panel.iconPath).toBeInstanceOf(ThemeIcon)
    expect((panel.iconPath as ThemeIcon).id).toBe('markdown')
  })

  it('applies the scoped webview options (scripts on, command URIs off — task 27)', () => {
    const { panel } = resolveAndGetHtml()
    expect(panel.webview.options).toMatchObject({
      enableScripts: true,
      enableCommandUris: false,
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

  it('injects the Vditor i18n bundle before main.js (sync toolbar build)', () => {
    const { html } = resolveAndGetHtml()
    // matches the VS Code UI language (mock env.language = 'en' -> en_US)
    expect(html).toMatch(
      /id="vditorI18nScript[^"]*"[^>]+src="[^"]*i18n\/en_US\.js"/,
    )
    // must load before the bundle so window.VditorI18n is set when Vditor inits
    expect(html.indexOf('i18n/en_US.js')).toBeLessThan(html.indexOf('main.js'))
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

  it('emits id-tagged external-css + custom-css <style> nodes for live swap (tasks 12/26)', () => {
    const { html } = resolveAndGetHtml('/* sentinel */ body{}')
    expect(html).toContain('<style id="external-css">')
    expect(html).toContain('<style id="custom-css">')
    // external loads first so customCss (later) wins on conflicts
    expect(html.indexOf('id="external-css"')).toBeLessThan(
      html.indexOf('id="custom-css"'),
    )
    expect(html).toContain('/* sentinel */ body{}')
  })
})

describe('security: scoped localResourceRoots (task 18 §2a)', () => {
  beforeEach(() => mock.reset())

  it('scopes the webview to the extension media dir + the workspace folder', () => {
    const { panel } = resolveAndGetHtml()
    const roots = (panel.webview.options as any).localResourceRoots as Uri[]
    const paths = roots.map((r) => r.fsPath)
    expect(paths).toContain('/ext/media')
    expect(paths).toContain('/workspace')
    // the whole-disk root (and per-drive roots) must be gone
    expect(paths).not.toContain('/')
    expect(paths.some((p) => /^[A-Z]:\//.test(p))).toBe(false)
  })

  it('falls back to the document directory when there is no workspace', () => {
    const roots = MarkdownEditorProvider.webviewRoots(
      Uri.file('/ext'),
      Uri.file('/notes/sub/note.md'),
    )
    const paths = roots.map((r) => r.fsPath)
    expect(paths).toEqual(['/ext/media', '/notes/sub'])
  })

  it('uses only the media root for a non-file (untitled) document with no workspace', () => {
    const roots = MarkdownEditorProvider.webviewRoots(
      Uri.file('/ext'),
      Uri.parse('untitled:Untitled-1'),
    )
    expect(roots.map((r) => r.fsPath)).toEqual(['/ext/media'])
  })
})

describe('security: augment webview options + drop command URIs (task 27)', () => {
  beforeEach(() => mock.reset())

  it('augments rather than wholesale-replaces VS Code default webview options', () => {
    mock.setWorkspaceFolder('/workspace')
    const context = mock.createExtensionContext()
    const document = mock.createTextDocument('/workspace/note.md', '# Hi\n')
    const panel = mock.createWebviewPanel()
    // VS Code pre-populates sensible defaults before resolveCustomTextEditor runs.
    panel.webview.options = {
      enableForms: true,
      portMapping: [{ webviewPort: 3000, extensionHostPort: 3000 }],
    }
    new MarkdownEditorProvider(context as any).resolveCustomTextEditor(
      document as any,
      panel as any,
    )
    const opts = panel.webview.options as any
    // our controlled fields applied…
    expect(opts.enableScripts).toBe(true)
    expect(opts.enableCommandUris).toBe(false) // navigation is postMessage-only
    expect(Array.isArray(opts.localResourceRoots)).toBe(true)
    // …and the pre-existing defaults survive (augment, not replace)
    expect(opts.enableForms).toBe(true)
    expect(opts.portMapping).toEqual([
      { webviewPort: 3000, extensionHostPort: 3000 },
    ])
  })

  it('getWebviewOptions does not set command URIs and omits panel-level keys', () => {
    const opts: any = MarkdownEditorProvider.getWebviewOptions(
      Uri.file('/ext'),
      Uri.file('/workspace/note.md'),
    )
    expect(opts.enableCommandUris).toBe(false)
    expect(opts.enableScripts).toBe(true)
    // retainContextWhenHidden is panel-level (set at registration), not here
    expect('retainContextWhenHidden' in opts).toBe(false)
  })
})

describe('security: customCss/external CSS sanitization (task 18 §2b)', () => {
  beforeEach(() => mock.reset())

  it('neutralizes a </style> breakout in customCss', () => {
    const { html } = resolveAndGetHtml(
      'body{}</style><script>alert(1)</script>',
    )
    // no premature </style> closes our block to start a real <script> element
    expect(html).not.toContain('</style><script>')
    // the payload survives only as inert CSS text inside our controlled block:
    // up to the first (our) </style>, the injected closing sequence is gone
    const block = html.slice(html.indexOf('<style id="custom-css">'))
    const inner = block.slice(0, block.indexOf('</style>'))
    expect(inner).not.toContain('</style')
    expect(inner).toContain('alert(1)') // present, but inert (inside <style>)
  })

  it('sanitizeCss strips the closing-tag sequence case-insensitively', () => {
    expect(MarkdownEditorProvider.sanitizeCss('a</STYLE >b')).toBe('a >b')
    expect(MarkdownEditorProvider.sanitizeCss(undefined)).toBe('')
  })
})

describe('security: Content-Security-Policy + nonce (task 18 §2c)', () => {
  beforeEach(() => mock.reset())

  it('emits a CSP meta scoped to the webview origin with default-src none', () => {
    const { html } = resolveAndGetHtml()
    const csp = /content="([^"]*default-src[^"]*)"/.exec(html)?.[1]
    expect(csp).toBeDefined()
    expect(csp).toContain("default-src 'none'")
    // scoped to cspSource (the mock returns 'vscode-resource:')
    expect(csp).toContain('vscode-resource:')
  })

  it('puts a matching nonce on every script tag and in script-src', () => {
    const { html } = resolveAndGetHtml()
    const nonce = /script-src [^"]*'nonce-([A-Za-z0-9]+)'/.exec(html)?.[1]
    expect(nonce).toBeTruthy()
    const scriptTags = html.match(/<script[^>]*>/g) || []
    expect(scriptTags.length).toBeGreaterThanOrEqual(2)
    for (const tag of scriptTags) {
      expect(tag).toContain(`nonce="${nonce}"`)
    }
  })
})
