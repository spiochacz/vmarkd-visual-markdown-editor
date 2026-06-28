import { describe, expect, it } from 'vitest'
import {
  buildWebviewHtml,
  sanitizeCss,
  serializeInitPayload,
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
      contentTheme: 'auto',
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
      // Exposes stopKeys so the bridge can drop keydown capture the moment the
      // editor mounts (else a Space in the editor is read as a PageDown scroll).
      expect(html).toContain('stopKeys')
    })

    it('includes toolbar placeholder when showToolbar is true', () => {
      const html = buildWebviewHtml(defaults({ preRenderedHtml: '<p>tb</p>' }))
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

    it('enables the matching GitHub theme link + markdown-body class (task 82)', () => {
      const html = buildWebviewHtml(
        defaults({
          config: { ...defaults().config, contentTheme: 'github-dark' },
        }),
      )
      // the dark link is active (not disabled), the others disabled
      expect(html).toMatch(
        /<link id="ct-github-dark"[^>]*github-markdown-dark\.css"\s*>/,
      )
      expect(html).toMatch(/<link id="ct-github-light"[^>]*disabled>/)
      expect(html).toMatch(/<link id="ct-material-dark"[^>]*disabled>/)
      // the class the theme stylesheets target
      expect(html).toMatch(/<body[^>]*class="markdown-body"/)
    })

    it('disables all content-theme links and omits markdown-body for auto', () => {
      const html = buildWebviewHtml(defaults())
      expect(html).toMatch(/<link id="ct-github-light"[^>]*disabled>/)
      expect(html).toMatch(/<link id="ct-github-dark"[^>]*disabled>/)
      expect(html).toMatch(/<link id="ct-material-dark"[^>]*disabled>/)
      expect(html).not.toContain('class="markdown-body"')
    })

    // The markdown-body class must be in the SERVER HTML for every named theme (not
    // just github) so the prerender teaser is themed from first paint — A1.
    it('emits the markdown-body class for non-github named themes too (task 82 / A1)', () => {
      for (const ct of [
        'material-dark',
        'vscode-light-2026',
        'vscode-dark-2026',
      ]) {
        const html = buildWebviewHtml(
          defaults({ config: { ...defaults().config, contentTheme: ct } }),
        )
        expect(html).toMatch(/<body[^>]*class="markdown-body"/)
        expect(html).toMatch(new RegExp(`<link id="ct-${ct}"[^>]*\\.css"\\s*>`))
      }
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
      expect(html).toMatch(/src="[^"]*main\.js[^"]*"/)
      expect(html).toMatch(/href="[^"]*main\.css[^"]*"/)
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
    expect(
      sanitizeCss('body{}</style><script>alert(1)</script>'),
    ).not.toContain('</style')
  })

  it('returns empty string for undefined', () => {
    expect(sanitizeCss(undefined)).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeCss('')).toBe('')
  })
})

// Task 38: inline init payload — the webview boots Vditor from this instead of the ready→init roundtrip.
describe('serializeInitPayload', () => {
  it('round-trips through JSON.parse', () => {
    const payload = {
      type: 'init',
      content: '# Hi\n\nsome *text*',
      theme: 'dark',
    }
    expect(JSON.parse(serializeInitPayload(payload))).toEqual(payload)
  })

  it('escapes < so document content cannot break out of the <script> element', () => {
    const evil = 'before </script><script>alert(1)</script> after'
    const out = serializeInitPayload({ content: evil })
    // no raw `</script>` survives in the serialized string (the HTML-injection vector)
    expect(out).not.toContain('</script>')
    expect(out).toContain('\\u003c')
    // …but it still parses back to the exact original content
    expect(JSON.parse(out).content).toBe(evil)
  })
})

describe('buildWebviewHtml inline init payload', () => {
  it('emits a #vmark-init JSON data island when initPayload is provided', () => {
    const json = serializeInitPayload({ type: 'init', content: '# A' })
    const html = buildWebviewHtml(defaults({ initPayload: json }))
    expect(html).toContain('id="vmark-init"')
    expect(html).toContain('type="application/json"')
    expect(html).toContain(`nonce="${NONCE}"`)
    // the data island must come BEFORE the bundle script so main.js can read it on load
    expect(html.indexOf('id="vmark-init"')).toBeLessThan(
      html.indexOf('main.js'),
    )
  })

  it('omits #vmark-init when no payload (roundtrip-only docs)', () => {
    expect(buildWebviewHtml(defaults())).not.toContain('id="vmark-init"')
  })

  it('does not let payload content break out of the script element', () => {
    const json = serializeInitPayload({ content: '</script><b>x</b>' })
    const html = buildWebviewHtml(defaults({ initPayload: json }))
    // exactly one real </script> belongs to the vmark-init block? at minimum the payload's
    // </script> must be escaped — assert the raw sequence from the content is gone.
    expect(html).not.toContain('</script><b>x</b>')
  })
})
