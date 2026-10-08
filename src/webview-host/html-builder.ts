import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { CONTENT_THEMES, codeStyleHref } from '../shared/theme-registry'

interface HtmlBuildConfig {
  showToolbar: boolean
  useVscodeThemeColor: boolean
  contentTheme: string
  enableFullWidth: boolean
  highlightHeadings: boolean
  showHeadingMarkers: boolean
  markdownPreviewFontFamily: string
  fontSize: string
  // The RESOLVED highlight.js style name (theme-registry's resolveCodeStyle — explicit `theme.code`,
  // else the content theme's pairing). Task 431: the host emits the hljs stylesheet link itself so it
  // is loading from the first paint instead of appearing only when Vditor's setCodeTheme runs in
  // after(). Resolved by the caller through the SHARED registry function — never re-derived here.
  codeStyle: string
  allowRemoteImages: boolean
  customCss: string
  externalCss: string
}

export interface HtmlBuildParams {
  toUri: (relativePath: string) => string
  baseHref: string
  cspSource: string
  nonce: string
  theme: 'dark' | 'light'
  config: HtmlBuildConfig
  preRenderedHtml: string | undefined
  // Whether the FULL document has a code block (computed by the caller from document.getText(), NOT the
  // truncated preRenderedHtml — a fence below MAX_PRERENDER_CHARS must still preload hljs). Task 170 bonus.
  docHasCodeFence?: boolean
  // Whether the FULL document has math (hasMath). When true the host preloads KaTeX before main.js so
  // the instant-paint overlay can typeset its formulas synchronously (task 532 step 4) instead of
  // showing raw TeX until Vditor's lazy mathRender runs. Omitted = no preload.
  docHasMath?: boolean
  savedMode: 'ir' | 'wysiwyg' | 'sv'
  i18nLang: string
  // Task 38: the initial `update`/init payload, pre-serialized + escaped via serializeInitPayload,
  // inlined as a `<script type="application/json" id="vmark-init">` so the webview can boot Vditor
  // synchronously on first paint instead of waiting for the `ready→init` host roundtrip. Undefined
  // for docs that keep the roundtrip (wiki files — need async pageKeys; large docs — avoid doubling
  // the HTML, the prerender teaser already embeds the rendered content).
  initPayload?: string
}

export function sanitizeCss(css: string | undefined): string {
  return (css || '').replace(/<\/style/gi, '')
}

// Does the markdown source hold a highlightable code block? A fenced block (```/~~~, CommonMark allows up
// to 3 leading spaces) or a raw <code>/<pre> HTML tag. Used to gate the hljs preload over the FULL document
// (document.getText()) — NOT the truncated preRenderedHtml, so a fence below MAX_PRERENDER_CHARS still
// preloads hljs (task 170 bonus). Inline `code` (single backticks) is deliberately NOT matched — it isn't
// syntax-highlighted, so it shouldn't pull the 2.1 MB hljs bundle.
export function hasCodeFence(markdown: string): boolean {
  return (
    /^[ \t]{0,3}(`{3,}|~{3,})/m.test(markdown) ||
    /<(?:code|pre)[\s>/]/i.test(markdown)
  )
}

// Does the markdown source hold math? A `$$` block, an inline `$…$` pair on one line, or a ```math
// fence. Gates the KaTeX preload over the FULL document (same reasoning as hasCodeFence). Deliberately
// generous — a false positive costs one ~310 KB script parse, a false negative leaves raw TeX in the
// overlay, which is only the old behaviour.
export function hasMath(markdown: string): boolean {
  return (
    /\$\$/.test(markdown) ||
    /\$[^\s$][^\n$]*\$/.test(markdown) ||
    /^[ \t]{0,3}(`{3,}|~{3,})\s*math\b/m.test(markdown)
  )
}

// Task 38: serialize the inline init payload for a `<script type="application/json">` data island.
// Escaping `<` → `<` (valid inside a JSON string) prevents a `</script>` sequence in document
// content from terminating the script element early — the only HTML-injection vector for a
// non-executed JSON script block. The webview reads it with JSON.parse (not eval), so no other escape
// is needed. Keep in sync with the reader in media-src/src/main.ts.
export function serializeInitPayload(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c')
}

function buildCspMeta(
  cspSource: string,
  nonce: string,
  allowRemoteImages: boolean,
): string {
  const imgSrc = `${cspSource} data: blob:${allowRemoteImages ? ' https:' : ''}`
  return (
    `<meta http-equiv="Content-Security-Policy" content="` +
    `default-src 'none'; ` +
    `img-src ${imgSrc}; ` +
    `media-src ${cspSource} data: blob:; ` +
    `font-src ${cspSource} data:; ` +
    `style-src ${cspSource} 'unsafe-inline'; ` +
    // 'unsafe-eval' is REQUIRED, verified empirically (185/3i): narrowing to 'wasm-unsafe-eval'
    // broke the renderers in the real-VS-Code suite — wavedrom eval()s its relaxed-JSON source,
    // vega-embed compiles expressions via eval/new Function (three.js carries eval too). The
    // WASM engines (d2 TinyGo, viz/plantuml) would be fine with 'wasm-unsafe-eval' alone, so
    // re-attempt the narrowing only if wavedrom/vega ever gain strict-parse modes.
    `script-src 'nonce-${nonce}' ${cspSource} 'unsafe-eval'; ` +
    `connect-src ${cspSource} data:; ` +
    // No blob: — nothing spawns a blob Worker anymore (185/3i): elk runs its in-process fake
    // worker (elk-entry.ts), viz 3.x / plantuml TeaVM are in-process WASM, and `new Worker` is
    // absent from media/dist/main.js. Kept as an explicit directive so a future worker use is a
    // conscious CSP decision, not a script-src fallback.
    `worker-src ${cspSource}; ` +
    `frame-src 'none'; object-src 'none'; base-uri ${cspSource};">`
  )
}

function buildBodyAttrs(config: HtmlBuildConfig): string {
  return (
    `data-use-vscode-theme-color="${config.useVscodeThemeColor ? '1' : '0'}" ` +
    `data-full-width="${config.enableFullWidth ? '1' : '0'}" ` +
    `data-highlight-headings="${config.highlightHeadings ? '1' : '0'}" ` +
    `data-heading-markers="${config.showHeadingMarkers === false ? '0' : '1'}" ` +
    // The RESOLVED content theme (task 516 follow-up): `contentTheme` is already `effectiveContentTheme`'s
    // output, so `auto` paired with a VS Code default colour theme arrives here as a concrete value
    // (e.g. `vscode-dark-2026`), not the literal string `auto`. main.css needs this to scope the
    // un-highlighted code-box mirror rule to the ONE theme pair whose `.hljs` padding isn't the
    // universal `1em` (see the rule's comment) — `markdown-body` alone can't distinguish that theme
    // from github/material, which all share the class.
    `data-content-theme="${config.contentTheme}"`
  )
}

function sanitizeFontFamily(value: string): string {
  // The value comes from a VS Code setting and is inserted into an inline custom property.
  // Keep normal CSS font stacks (including quoted family names), but prevent it from terminating
  // the declaration or the surrounding HTML/style context.
  return value
    .replace(/[;<>{}\r\n]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .trim()
}

function buildCssStyleTags(externalCss: string, customCss: string): string {
  return (
    `<style id="external-css">${sanitizeCss(externalCss)}</style>` +
    `<style id="custom-css">${sanitizeCss(customCss)}</style>`
  )
}

function buildPrerenderOverlay(
  preRenderedHtml: string | undefined,
  theme: 'dark' | 'light',
  savedMode: 'ir' | 'wysiwyg' | 'sv',
  showToolbar: boolean,
  nonce: string,
  toUri: (path: string) => string,
): {
  overlay: string
  themeLink: string
  style: string
  scrollScript: string
} {
  if (!preRenderedHtml) {
    return { overlay: '', themeLink: '', style: '', scrollScript: '' }
  }

  const innerClass = savedMode === 'wysiwyg' ? 'vditor-wysiwyg' : 'vditor-ir'
  const toolbar = showToolbar
    ? '<div class="vditor-toolbar vditor-toolbar--pin" style="height:35px;box-sizing:content-box;padding-top:0;padding-bottom:0;"></div>'
    : ''
  const spinner =
    '<span id="vmarkd-prerender-spinner" title="vMarkd: rendering…" aria-hidden="true"></span>'

  const overlay = `<div id="vmarkd-prerender" class="vditor${
    theme === 'dark' ? ' vditor--dark' : ''
  }" style="height:100%" aria-hidden="true">${toolbar}${spinner}<div class="vditor-content"><div class="${innerClass}"><pre class="vditor-reset">${preRenderedHtml}</pre></div></div></div>`

  const themeLink = `<link id="vditorContentTheme" href="${toUri(
    `media/vditor/dist/css/content-theme/${theme === 'dark' ? 'dark' : 'light'}.css`,
  )}" rel="stylesheet">`

  // Task 532 step 5b: the overlay paints the page colour itself. It used to be transparent, so
  // while it stood over the booting editor the live text bled through (and a theme whose page colour
  // is painted by an ancestor other than the body could show a different shade). --vmarkd-page-bg is
  // the one token every theme sets to the surface its content sits on (a named theme: its own canvas;
  // `auto`: the editor background), so the overlay and the live editor resolve to the same colour.
  const style = `<style>#vmarkd-prerender{position:absolute;inset:0;overflow:hidden;z-index:5;box-sizing:border-box;background:var(--vmarkd-page-bg,var(--vscode-editor-background));}#vmarkd-prerender-spinner{position:absolute;top:9px;right:12px;width:14px;height:14px;box-sizing:border-box;border:2px solid var(--vscode-foreground,#888);border-top-color:transparent;border-radius:50%;opacity:.3;z-index:6;pointer-events:none;animation:vmarkd-spin .8s linear infinite;}@keyframes vmarkd-spin{to{transform:rotate(360deg);}}</style>`

  // Prepaint scroll capture: accumulate the user's wheel/key scroll over the static
  // teaser (before the live editor mounts) so the editor opens at the scrolled
  // position. `stopKeys` removes ONLY the keydown listener — the bridge calls it the
  // moment the editor mounts so the user's editor keystrokes (notably Space, which
  // the teaser reads as PageDown) are not misread as scroll intent. `stop` removes
  // everything when the bridge window ends.
  const scrollScript = `<script nonce="${nonce}">(function(){var s={intent:0,active:true};window.__vmarkdScroll=s;function w(e){if(s.active)s.intent=Math.max(0,s.intent+(e.deltaY||0));}function k(e){if(!s.active)return;var vh=window.innerHeight||800,d=0;switch(e.key){case 'PageDown':case ' ':d=vh*0.9;break;case 'PageUp':d=-vh*0.9;break;case 'ArrowDown':d=48;break;case 'ArrowUp':d=-48;break;case 'End':d=1e7;break;case 'Home':s.intent=0;return;default:return;}s.intent=Math.max(0,s.intent+d);}window.addEventListener('wheel',w,{passive:true});window.addEventListener('keydown',k);s.stopKeys=function(){window.removeEventListener('keydown',k);};s.stop=function(){s.active=false;window.removeEventListener('wheel',w);window.removeEventListener('keydown',k);};})();</script>`

  // Real-VS-Code parity test only: retain the otherwise ephemeral overlay long enough
  // to compare it with the mounted editor. This process variable is never set in a
  // normal extension host, so it cannot alter a user's open path. __vmarkdOverlayDecorateAll lifts
  // the two-viewport cap of the overlay decoration (content-decorators.ts) so the parity gate
  // compares every block of the canon, not only the ones a test window shows.
  const testHoldScript = process.env.VMARKD_PRERENDER_PARITY_HOLD
    ? `<script nonce="${nonce}">window.__vmarkdHoldPrerender=true;window.__vmarkdOverlayDecorateAll=true;</script>`
    : ''

  return {
    overlay,
    themeLink,
    style,
    scrollScript: testHoldScript + scrollScript,
  }
}

// Rendering theme (task 82): the file-backed content themes. Each ships a vendored
// stylesheet targeting `.markdown-body`; all are emitted as <link>s and all but the
// active one are `disabled`, so exactly one applies. The webview flips `link.disabled`
// + the body `markdown-body` class live (applyContentTheme). `auto` = none active.
// Derived from the single-source theme registry (task 84) — add a theme by adding ONE
// row in src/theme-registry.ts; everything else (mode, code pairing, font default,
// this map, the manifest enum) follows from it.
const CONTENT_THEME_FILES: Record<string, string> = Object.fromEntries(
  CONTENT_THEMES.map((t) => [t.value, t.file]),
)

function buildContentThemeLinks(
  toUri: (path: string) => string,
  contentTheme: string,
): string {
  return Object.entries(CONTENT_THEME_FILES)
    .map(
      ([value, file]) =>
        `<link id="ct-${value}" rel="stylesheet" href="${toUri(file)}"${
          value === contentTheme ? '' : ' disabled'
        }>`,
    )
    .join('')
}

// Cache-buster for webview resources. VS Code's vscode-webview:// URI caches by path —
// without a query param, a reinstalled extension serves stale JS/CSS until the user
// manually reloads the window. Keyed on the main.js content hash so it busts on every build.
const CACHE_BUST = (() => {
  try {
    const h = createHash('md5')
    h.update(readFileSync(join(__dirname, '..', 'media', 'dist', 'main.js')))
    h.update(readFileSync(join(__dirname, '..', 'media', 'dist', 'main.css')))
    return `?v=${h.digest('hex').slice(0, 8)}`
  } catch {
    return ''
  }
})()

export function buildWebviewHtml(params: HtmlBuildParams): string {
  const {
    toUri,
    baseHref,
    cspSource,
    nonce,
    theme,
    config,
    savedMode,
    i18nLang,
  } = params

  const jsFiles = ['media/dist/main.js'].map(toUri)
  // Vditor's index.css is loaded as its OWN <link> (not bundled into main.css) so the editor
  // uses the SAME single, build.mjs-patched media/ copy the harness + export load — no
  // bundled-vs-copied drift (ADR-0004). MUST precede main.css so our bundle still wins ties.
  const cssFiles = ['media/vditor/dist/index.css', 'media/dist/main.css'].map(
    toUri,
  )
  const iconScript = toUri('media/vditor-icons.js')
  const i18nScript = toUri(`media/vditor/dist/js/i18n/${i18nLang}.js`)
  // Preload highlight.js BEFORE main.js, but only when the document actually has a code block (task
  // 145 follow-up). Measured: with hljs lazy-loaded from the webview, its 2.1 MB script EXECUTION is
  // starved behind the synchronous diagram-render burst on the single main thread, so code colouring
  // landed ~4 s in. Loading it here (same ids as Vditor's highlightRender + our ensureHljsLoaded, so
  // both dedupe) makes window.hljs ready before the burst → Vditor colours code blocks as soon as it
  // renders them. Gated on a code fence so no-code docs don't pay the 2.1 MB. The gate scans the FULL
  // document (docHasCodeFence, from document.getText()) — NOT the preRenderedHtml, which lute-host
  // truncates at MAX_PRERENDER_CHARS, so a fence below the cut-off was missed and fell back to the slow
  // defer path (task 170 bonus). Falls back to the old truncated-HTML probe if the caller omits the flag.
  const docHasCode =
    params.docHasCodeFence ??
    (typeof params.preRenderedHtml === 'string' &&
      /<code|language-/.test(params.preRenderedHtml))
  const hljsMain = toUri('media/vditor/dist/js/highlight.js/highlight.min.js')
  const hljsThird = toUri(
    'media/vditor/dist/js/highlight.js/third-languages.js',
  )
  const hljsPreload = docHasCode
    ? `<script nonce="${nonce}" id="vditorHljsScript" src="${hljsMain}?v=11.7.0"></script>\n` +
      `\t\t\t\t<script nonce="${nonce}" id="vditorHljsThirdScript" src="${hljsThird}?v=1.0.1"></script>`
    : ''
  // Task 532 step 4: KaTeX (+ mhchem) preloaded the same way, so main.js can typeset the overlay's math
  // synchronously. Same ids/URLs as Vditor's mathRender (markdown/mathRender.ts) so its addScript /
  // addStyle dedupe by id and never fetch a second copy. The stylesheet is a render-blocking <link> in
  // <head> on purpose: the overlay must not paint typeset math in unstyled KaTeX markup.
  const katexBase = toUri('media/vditor/dist/js/katex')
  const katexPreload = params.docHasMath
    ? `<script nonce="${nonce}" id="vditorKatexScript" src="${katexBase}/katex.min.js?v=0.16.9"></script>\n` +
      `\t\t\t\t<script nonce="${nonce}" id="vditorKatexChemScript" src="${katexBase}/mhchem.min.js?v=0.16.9"></script>`
    : ''
  const katexStyleLink = params.docHasMath
    ? `<link id="vditorKatexStyle" rel="stylesheet" type="text/css" href="${katexBase}/katex.min.css?v=0.16.9">`
    : ''
  // Task 38: inline init payload (must precede main.js so it's in the DOM when main.js reads it).
  // type="application/json" → non-executed data island; main.js parses it with JSON.parse.
  const initPayloadTag = params.initPayload
    ? `<script type="application/json" id="vmark-init" nonce="${nonce}">${params.initPayload}</script>`
    : ''

  // Task 431 — ship the highlight.js stylesheet in the initial HTML. Vditor otherwise creates this link
  // for the first time at runtime, inside after() (setCodeTheme → addStyle), and does not await its
  // load — while observeCodeSource tags `.hljs` onto code elements immediately, so the class can be on
  // before the sheet that colours it has arrived.
  //   • The id and href must be EXACTLY what setCodeTheme would build (`${cdn}/dist/js/highlight.js/
  //     styles/${style}.min.css`, no cache-bust suffix): it compares the raw href attribute and
  //     REMOVES + re-adds the link on a mismatch, which would recreate the flash instead of closing it.
  //     Hence codeStyleHref + the shared resolveCodeStyle — see theme-registry.ts.
  //   • NOT gated on docHasCodeFence, deliberately: that predicate matches fences and raw <code>/<pre>
  //     but NOT YAML frontmatter, and a frontmatter-only file is exactly the case task 427 reports. The
  //     cost of being ungated is one small local stylesheet (no remote fetch — task 39), which is the
  //     cheaper mistake than leaving the reported case unstyled.
  const hljsStyleLink = `<link id="vditorHljsStyle" rel="stylesheet" type="text/css" href="${codeStyleHref(
    toUri('media/vditor'),
    config.codeStyle,
  )}">`

  const cspMeta = buildCspMeta(cspSource, nonce, config.allowRemoteImages)
  const bodyAttrs = buildBodyAttrs(config)
  const cssStyleTags = buildCssStyleTags(config.externalCss, config.customCss)
  const contentTheme = config.contentTheme || 'auto'
  const contentThemeLinks = buildContentThemeLinks(toUri, contentTheme)
  // The class the content-theme stylesheets target (github-markdown-css and the
  // material/vscode themes). Present for EVERY named theme so the prerender teaser
  // (a static .vditor-reset under <body>) is themed from the first paint — otherwise
  // a non-github theme flashes Vditor's default palette until applyContentTheme adds
  // the class at runtime. `auto` keeps no class (the VS Code-colour path).
  const bodyClass = contentTheme !== 'auto' ? ' class="markdown-body"' : ''

  // Instant-preview teaser is ALWAYS ON (the advanced.instantPreview opt-out was removed 2026-07-01).
  const prerender = buildPrerenderOverlay(
    params.preRenderedHtml,
    theme,
    savedMode,
    config.showToolbar,
    nonce,
    toUri,
  )

  return (
    `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				${cspMeta}

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<base href="${baseHref}" />


				${cssFiles.map((f) => `<link href="${f}${CACHE_BUST}" rel="stylesheet">`).join('\n')}

				<title>vMarkd</title>
      ` +
    // Order matters: prerender.themeLink is Vditor's own content-theme palette
    // (content-theme/{light,dark}.css), which targets `.vditor-reset` at the same
    // specificity (0,1,1) as github-markdown-css's `.markdown-body …` rules. The
    // vendored github CSS carries no `!important`, so it only wins the ties when it
    // loads AFTER Vditor's. setContentTheme() no-ops at runtime (href === cssPath),
    // so this static order holds. User CSS (cssStyleTags) stays last to win over all.
    prerender.themeLink +
    contentThemeLinks +
    // Before the user CSS (which must stay last) and after the content themes — the same slot Vditor's
    // own runtime insertion would land in relative to them (it appends to <head>).
    hljsStyleLink +
    katexStyleLink +
    cssStyleTags +
    prerender.style +
    `
			</head>
			<body ${bodyAttrs}${bodyClass} style="--me-font-size:${config.fontSize};--me-markdown-preview-font-family:${sanitizeFontFamily(config.markdownPreviewFontFamily)}">
				<div id="app"></div>
				${prerender.overlay}
				${prerender.scrollScript}

				<script nonce="${nonce}" id="vditorI18nScript${i18nLang}" src="${i18nScript}"></script>
				<script nonce="${nonce}" id="vditorIconScript" src="${iconScript}"></script>
				${hljsPreload}
				${katexPreload}
				${initPayloadTag}
				${jsFiles.map((f) => `<script nonce="${nonce}" src="${f}${CACHE_BUST}"></script>`).join('\n')}
			</body>
			</html>`
  )
}
