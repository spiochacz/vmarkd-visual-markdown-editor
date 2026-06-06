import { describe, expect, it } from 'vitest'
import {
  buildWebviewHtml,
  sanitizeCss,
  type HtmlBuildParams,
} from '../../src/html-builder'

const NONCE = 'testNonce1234567890abcdef12345678'
const CSP_SRC = 'vscode-resource:'

function defaults(overrides: Partial<HtmlBuildParams> = {}): HtmlBuildParams {
  return {
    toUri: (f) => `https://ext/${f}`,
    baseHref: 'https://ext/workspace/',
    cspSource: CSP_SRC,
    nonce: NONCE,
    theme: 'light',
    config: {
      showToolbar: true,
      useVscodeThemeColor: true,
      enableFullWidth: false,
      highlightHeadings: true,
      showHeadingMarkers: true,
      fontSize: 'var(--vscode-editor-font-size, 14px)',
      instantPreview: true,
      allowRemoteImages: false,
      customCss: '',
      externalCss: '',
    },
    preRenderedHtml: undefined,
    savedMode: 'ir',
    i18nLang: 'en_US',
    ...overrides,
  }
}

function cspContent(html: string): string {
  return /content="([^"]*default-src[^"]*)"/.exec(html)?.[1] ?? ''
}

function imgSrcDirective(html: string): string {
  return /img-src ([^;]*);/.exec(cspContent(html))?.[1] ?? ''
}

describe('buildWebviewHtml', () => {
  describe('CSP', () => {
    it('emits default-src none scoped to cspSource', () => {
      const html = buildWebviewHtml(defaults())
      const csp = cspContent(html)
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain(CSP_SRC)
    })

    it('omits remote https: from img-src by default', () => {
      const html = buildWebviewHtml(defaults())
      const img = imgSrcDirective(html)
      expect(img).not.toContain('https:')
      expect(img).toContain('data:')
      expect(img).toContain('blob:')
      expect(img).toContain(CSP_SRC)
    })

    it('allows remote https: when allowRemoteImages is on', () => {
      const html = buildWebviewHtml(
        defaults({
          config: { ...defaults().config, allowRemoteImages: true },
        }),
      )
      expect(imgSrcDirective(html)).toContain('https:')
    })

    it('puts the nonce on every script tag and in script-src', () => {
      const html = buildWebviewHtml(defaults())
      expect(cspContent(html)).toContain(`'nonce-${NONCE}'`)
      const scripts = html.match(/<script[^>]*>/g) || []
      expect(scripts.length).toBeGreaterThanOrEqual(2)
      for (const tag of scripts) {
        expect(tag).toContain(`nonce="${NONCE}"`)
      }
    })

    it('hardens frame-src, object-src, and base-uri', () => {
      const csp = cspContent(buildWebviewHtml(defaults()))
      expect(csp).toContain("frame-src 'none'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain('base-uri')
    })
  })

  describe('prerender overlay', () => {
    it('omits overlay when preRenderedHtml is undefined', () => {
      const html = buildWebviewHtml(defaults({ preRenderedHtml: undefined }))
      expect(html).not.toContain('vmarkd-prerender')
      expect(html).not.toContain('vditorContentTheme')
    })

    it('includes overlay when preRenderedHtml is provided', () => {
      const html = buildWebviewHtml(
        defaults({ preRenderedHtml: '<h1>Hello</h1>' }),
      )
      expect(html).toContain('id="vmarkd-prerender"')
      expect(html).toContain('Hello')
      expect(html).toContain('id="vditorContentTheme"')
      expect(html).toContain('vmarkd-prerender-spinner')
    })

    it('uses vditor-ir class for IR mode', () => {
      const html = buildWebviewHtml(
        defaults({ preRenderedHtml: '<p>test</p>', savedMode: 'ir' }),
      )
      expect(html).toContain('vditor-ir')
      expect(html).not.toContain('vditor-wysiwyg')
    })

    it('uses vditor-wysiwyg class for WYSIWYG mode', () => {
      const html = buildWebviewHtml(
        defaults({ preRenderedHtml: '<p>test</p>', savedMode: 'wysiwyg' }),
      )
      expect(html).toContain('vditor-wysiwyg')
    })

    it('skips overlay when instantPreview is disabled even with preRenderedHtml', () => {
      const html = buildWebviewHtml(
        defaults({
          preRenderedHtml: '<h1>Visible?</h1>',
          config: { ...defaults().config, instantPreview: false },
        }),
      )
      expect(html).not.toContain('vmarkd-prerender')
      expect(html).not.toContain('Visible?')
    })

    it('adds vditor--dark class in dark theme', () => {
      const html = buildWebviewHtml(
        defaults({ preRenderedHtml: '<p>dark</p>', theme: 'dark' }),
      )
      expect(html).toContain('vditor--dark')
    })

    it('includes scroll capture script when overlay is present', () => {
      const html = buildWebviewHtml(
        defaults({ preRenderedHtml: '<p>scroll</p>' }),
      )
      expect(html).toContain('__vmarkdScroll')
      expect(html).toContain(`nonce="${NONCE}"`)
    })

    it('includes toolbar placeholder when showToolbar is true', () => {
      const html = buildWebviewHtml(
        defaults({ preRenderedHtml: '<p>tb</p>' }),
      )
      expect(html).toContain('vditor-toolbar')
    })

    it('omits toolbar placeholder when showToolbar is false', () => {
      const html = buildWebviewHtml(
        defaults({
          preRenderedHtml: '<p>tb</p>',
          config: { ...defaults().config, showToolbar: false },
        }),
      )
      expect(html).not.toContain('vditor-toolbar')
    })
  })

  describe('body attributes', () => {
    it('sets data-use-vscode-theme-color from config', () => {
      const html = buildWebviewHtml(
        defaults({
          config: { ...defaults().config, useVscodeThemeColor: true },
        }),
      )
      expect(html).toContain('data-use-vscode-theme-color="1"')
    })

    it('sets data-full-width from config', () => {
      const html = buildWebviewHtml(
        defaults({
          config: { ...defaults().config, enableFullWidth: true },
        }),
      )
      expect(html).toContain('data-full-width="1"')
    })

    it('sets data-heading-markers="0" when disabled', () => {
      const html = buildWebviewHtml(
        defaults({
          config: { ...defaults().config, showHeadingMarkers: false },
        }),
      )
      expect(html).toContain('data-heading-markers="0"')
    })

    it('sets --me-font-size from config.fontSize', () => {
      const html = buildWebviewHtml(
        defaults({ config: { ...defaults().config, fontSize: '18px' } }),
      )
      expect(html).toContain('--me-font-size:18px')
    })
  })

  describe('assets and structure', () => {
    it('renders main.js and main.css', () => {
      const html = buildWebviewHtml(defaults())
      expect(html).toMatch(/src="[^"]*main\.js"/)
      expect(html).toMatch(/href="[^"]*main\.css"/)
    })

    it('loads i18n bundle before main.js', () => {
      const html = buildWebviewHtml(defaults())
      expect(html).toContain('i18n/en_US.js')
      expect(html.indexOf('en_US.js')).toBeLessThan(html.indexOf('main.js'))
    })

    it('loads the icon sprite script', () => {
      const html = buildWebviewHtml(defaults())
      expect(html).toContain('vditor-icons.js')
      expect(html).toContain('id="vditorIconScript"')
    })

    it('sets the base href', () => {
      const html = buildWebviewHtml(defaults({ baseHref: 'https://x/dir/' }))
      expect(html).toContain('<base href="https://x/dir/"')
    })
  })

  describe('CSS injection', () => {
    it('includes external-css and custom-css style tags', () => {
      const html = buildWebviewHtml(
        defaults({
          config: {
            ...defaults().config,
            customCss: '/* custom */',
            externalCss: '/* external */',
          },
        }),
      )
      expect(html).toContain('<style id="external-css">')
      expect(html).toContain('/* external */')
      expect(html).toContain('<style id="custom-css">')
      expect(html).toContain('/* custom */')
    })

    it('external-css loads before custom-css so custom wins cascade', () => {
      const html = buildWebviewHtml(defaults())
      expect(html.indexOf('id="external-css"')).toBeLessThan(
        html.indexOf('id="custom-css"'),
      )
    })
  })
})

describe('sanitizeCss', () => {
  it('strips </style closing-tag sequence case-insensitively', () => {
    expect(sanitizeCss('a</STYLE >b')).toBe('a >b')
    expect(sanitizeCss('body{}</style><script>alert(1)</script>')).not.toContain(
      '</style',
    )
  })

  it('returns empty string for undefined', () => {
    expect(sanitizeCss(undefined)).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeCss('')).toBe('')
  })
})
