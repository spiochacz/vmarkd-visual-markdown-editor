// Task 532 — the chromium side of the cross-stage parity gate (parity.spec.ts).
//
// Not a bundle: unlike the other `*-harness.ts` files this runs in Node and builds the PAGE. It calls
// the host's own `buildWebviewHtml` (same <link> order, content-theme links, body attributes, init
// payload, hljs preload, instant-paint overlay) with the host's own Node-Lute `renderForMode`, and
// the page then loads the PRODUCTION bundle (media/dist/main.js + main.css, so `node build.mjs` first)
// through serve.mjs's /media/ route. What the real webview adds on top and this reproduces by hand:
// the `--vscode-*` variables and VS Code's injected default stylesheet (the cascade the other
// harnesses omit — see content-theme.spec.ts's installRealWebviewBaseline). What it cannot see: the
// custom-editor resource/CSP pipeline and anything else only the real VS Code does — that is the
// parity-matrix spec's job.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  isLuteWarm,
  prewarmLute,
  renderForMode,
} from '../../src/lute/lute-host'
import { escapeTableSpanPipes } from '../../src/markdown/table-pipe-escape'
import {
  resolveCodeStyle,
  resolveFontSize,
  resolveMarkdownPreviewFontFamily,
} from '../../src/shared/theme-registry'
import {
  buildWebviewHtml,
  hasCodeFence,
  serializeInitPayload,
} from '../../src/webview-host/html-builder'
import type { ParityConfig } from '../../test/parity/configs'
import { resolveParityConfig } from '../../test/parity/configs'

export const REPO_ROOT = path.resolve(__dirname, '../..')
export const CANON_PATH = path.join(
  REPO_ROOT,
  'test/vscode-e2e/fixtures/parity-canon.md',
)

// Dark Modern's values for the variables the content CSS reads. Only consistency matters (stages are
// compared with each other, never against VS Code), but they are realistic so `auto` colours resolve.
const VSCODE_VARS = `:root{
--vscode-font-family:-apple-system,BlinkMacSystemFont,'Segoe WPC','Segoe UI',system-ui,'Ubuntu','Droid Sans',sans-serif;
--vscode-font-weight:normal;--text-link-decoration:none;--vscode-scrollbarSlider-background:#79797966;--vscode-font-size:13px;--vscode-editor-font-size:14px;
--vscode-editor-font-family:'Droid Sans Mono','monospace',monospace;--monaco-monospace-font:'Droid Sans Mono','monospace',monospace;
--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#cccccc;--vscode-foreground:#cccccc;
--vscode-textLink-foreground:#4daafc;--vscode-textLink-activeForeground:#4daafc;
--vscode-textPreformat-foreground:#d0d0d0;--vscode-textPreformat-background:#3c3c3c;
--vscode-textBlockQuote-background:#2b2b2b;--vscode-textBlockQuote-border:#616161;
--vscode-textCodeBlock-background:#2b2b2b;--vscode-panel-border:#2b2b2b;
--vscode-editorWidget-background:#202020;--vscode-editorWidget-border:#454545;
--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-checkbox-background:#313131;
--vscode-button-background:#0078d4;--vscode-focusBorder:#0078d4;--vscode-descriptionForeground:#9d9d9d;
}`

// VS Code's webview default sheet, copied from the workbench (1.129 pre/index.html `_defaultStyles`).
// It sits in `@layer vscode-default`, i.e. BELOW every unlayered author rule — an unlayered copy would
// beat the extension's CSS and measure a cascade that does not exist in the real webview.
const VSCODE_DEFAULT_CSS = `@layer vscode-default {
html{scrollbar-color:var(--vscode-scrollbarSlider-background) var(--vscode-editor-background)}
body{overscroll-behavior-x:none;background-color:transparent;color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);font-weight:var(--vscode-font-weight);font-size:var(--vscode-font-size);margin:0;padding:0 20px}
img,video{max-width:100%;max-height:100%}
a,a code{color:var(--vscode-textLink-foreground)}
p>a{text-decoration:var(--text-link-decoration)}
a:hover{color:var(--vscode-textLink-activeForeground)}
a:focus,input:focus,select:focus,textarea:focus{outline:1px solid -webkit-focus-ring-color;outline-offset:-1px}
code{font-family:var(--monaco-monospace-font);color:var(--vscode-textPreformat-foreground);background-color:var(--vscode-textPreformat-background);padding:1px 3px;border-radius:4px}
pre code{padding:0}
blockquote{background:var(--vscode-textBlockQuote-background);border-color:var(--vscode-textBlockQuote-border)}
kbd{background-color:var(--vscode-keybindingLabel-background);color:var(--vscode-keybindingLabel-foreground);border-style:solid;border-width:1px;border-radius:3px;vertical-align:middle;padding:1px 3px}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-corner{background-color:var(--vscode-editor-background)}
::-webkit-scrollbar-thumb{background-color:var(--vscode-scrollbarSlider-background)}
}`

/** The host's Node Lute is warmed asynchronously (setTimeout 0); wait for it like the unit tests do. */
async function warmLute(): Promise<void> {
  prewarmLute(REPO_ROOT)
  for (let i = 0; i < 100 && !isLuteWarm(); i++)
    await new Promise((r) => setTimeout(r, 50))
  if (!isLuteWarm()) throw new Error('parity harness: host Lute never warmed')
}

/** The complete HTML the host would serve for the canon under `config` — overlay held after boot. */
export async function buildParityPage(
  config: ParityConfig,
  origin: string,
): Promise<string> {
  const markdown = readFileSync(CANON_PATH, 'utf8')
  const r = resolveParityConfig(config)
  await warmLute()
  const toUri = (f: string) => `${origin}/${f}`
  const reflow = r.reflow
  const preRenderedHtml = renderForMode(
    REPO_ROOT,
    markdown,
    'ir',
    false,
    reflow,
  )
  if (!preRenderedHtml) throw new Error('parity harness: no overlay HTML')
  const options = {
    contentTheme: r.contentTheme,
    useVscodeThemeColor: r.contentTheme === 'auto',
    markdownPreviewFontFamily: resolveMarkdownPreviewFontFamily(undefined),
    enableFullWidth: r.fullWidth,
    codeBlockLineNumbers: false,
    mermaidTheme: 'auto',
    mermaidLayout: 'dagre',
    echartsTheme: 'auto',
    d2Layout: 'dagre',
    d2Theme: 'auto',
    d2Sketch: false,
    geoBasemap: 'auto',
    showToolbar: true,
    highlightHeadings: false,
    showHeadingMarkers: r.headingMarkers,
    fontSize: 'editor',
    outlinePosition: 'right',
    showOutlineByDefault: false,
    outlineHighlight: true,
    codeTheme: r.codeTheme,
    streamLargeFiles: true,
    contentVisibility: true,
    linkOpenWithModifier: false,
    pasteUrlAsLink: true,
    allowRemoteImages: false,
    wikiEnabled: false,
    reflowLineBreaks: r.reflow,
    defaultMode: 'ir',
    assetsVersion: 'parity',
  }
  const held = process.env.VMARKD_PRERENDER_PARITY_HOLD
  process.env.VMARKD_PRERENDER_PARITY_HOLD = '1'
  try {
    const html = buildWebviewHtml({
      toUri,
      baseHref: `${origin}/`,
      cspSource: origin,
      nonce: 'parity',
      theme: r.themeKind,
      config: {
        showToolbar: true,
        contentTheme: r.contentTheme,
        useVscodeThemeColor: r.contentTheme === 'auto',
        markdownPreviewFontFamily: resolveMarkdownPreviewFontFamily(undefined),
        enableFullWidth: r.fullWidth,
        highlightHeadings: false,
        showHeadingMarkers: r.headingMarkers,
        fontSize: resolveFontSize('editor', r.contentTheme),
        codeStyle: resolveCodeStyle(r.themeKind, r.codeTheme, r.contentTheme),
        allowRemoteImages: false,
        customCss: '',
        externalCss: '',
      },
      preRenderedHtml,
      docHasCodeFence: hasCodeFence(markdown),
      savedMode: 'ir',
      i18nLang: 'en_US',
      initPayload: serializeInitPayload({
        type: 'init',
        content: escapeTableSpanPipes(markdown),
        cdn: toUri('media/vditor'),
        options,
        theme: r.themeKind,
        wiki: { enabled: false },
      }),
    })
    // The webview's cascade base: variables + VS Code's default sheet, BEFORE every extension link.
    return html.replace(
      '<head>',
      `<head><style id="vscode-injected-default">${VSCODE_VARS}\n${VSCODE_DEFAULT_CSS}</style>`,
    )
  } finally {
    if (held === undefined) delete process.env.VMARKD_PRERENDER_PARITY_HOLD
    else process.env.VMARKD_PRERENDER_PARITY_HOLD = held
  }
}
