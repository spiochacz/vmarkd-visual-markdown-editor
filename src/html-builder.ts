export interface HtmlBuildConfig {
  showToolbar: boolean
  useVscodeThemeColor: boolean
  enableFullWidth: boolean
  highlightHeadings: boolean
  showHeadingMarkers: boolean
  fontSize: string
  instantPreview: boolean
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
  savedMode: 'ir' | 'wysiwyg' | 'sv'
  i18nLang: string
}

export function sanitizeCss(css: string | undefined): string {
  return (css || '').replace(/<\/style/gi, '')
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
    `script-src 'nonce-${nonce}' ${cspSource} 'unsafe-eval'; ` +
    `connect-src ${cspSource} data:; ` +
    `worker-src ${cspSource} blob:; ` +
    `frame-src 'none'; object-src 'none'; base-uri ${cspSource};">`
  )
}

function buildBodyAttrs(config: HtmlBuildConfig): string {
  return (
    `data-use-vscode-theme-color="${config.useVscodeThemeColor ? '1' : '0'}" ` +
    `data-full-width="${config.enableFullWidth ? '1' : '0'}" ` +
    `data-highlight-headings="${config.highlightHeadings ? '1' : '0'}" ` +
    `data-heading-markers="${config.showHeadingMarkers === false ? '0' : '1'}"`
  )
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

  const style = `<style>#vmarkd-prerender{position:absolute;inset:0;overflow:hidden;z-index:5;box-sizing:border-box;background:var(--vscode-editor-background,#fff);}#vmarkd-prerender-spinner{position:absolute;top:9px;right:12px;width:14px;height:14px;box-sizing:border-box;border:2px solid var(--vscode-foreground,#888);border-top-color:transparent;border-radius:50%;opacity:.3;z-index:6;pointer-events:none;animation:vmarkd-spin .8s linear infinite;}@keyframes vmarkd-spin{to{transform:rotate(360deg);}}</style>`

  // Prepaint scroll capture: accumulate the user's wheel/key scroll over the static
  // teaser (before the live editor mounts) so the editor opens at the scrolled
  // position. `stopKeys` removes ONLY the keydown listener — the bridge calls it the
  // moment the editor mounts so the user's editor keystrokes (notably Space, which
  // the teaser reads as PageDown) are not misread as scroll intent. `stop` removes
  // everything when the bridge window ends.
  const scrollScript = `<script nonce="${nonce}">(function(){var s={intent:0,active:true};window.__vmarkdScroll=s;function w(e){if(s.active)s.intent=Math.max(0,s.intent+(e.deltaY||0));}function k(e){if(!s.active)return;var vh=window.innerHeight||800,d=0;switch(e.key){case 'PageDown':case ' ':d=vh*0.9;break;case 'PageUp':d=-vh*0.9;break;case 'ArrowDown':d=48;break;case 'ArrowUp':d=-48;break;case 'End':d=1e7;break;case 'Home':s.intent=0;return;default:return;}s.intent=Math.max(0,s.intent+d);}window.addEventListener('wheel',w,{passive:true});window.addEventListener('keydown',k);s.stopKeys=function(){window.removeEventListener('keydown',k);};s.stop=function(){s.active=false;window.removeEventListener('wheel',w);window.removeEventListener('keydown',k);};})();</script>`

  return { overlay, themeLink, style, scrollScript }
}

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
  const cssFiles = ['media/dist/main.css'].map(toUri)
  const iconScript = toUri('media/vditor-icons.js')
  const i18nScript = toUri(`media/vditor/dist/js/i18n/${i18nLang}.js`)

  const cspMeta = buildCspMeta(cspSource, nonce, config.allowRemoteImages)
  const bodyAttrs = buildBodyAttrs(config)
  const cssStyleTags = buildCssStyleTags(config.externalCss, config.customCss)

  const prerender = buildPrerenderOverlay(
    config.instantPreview ? params.preRenderedHtml : undefined,
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


				${cssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join('\n')}

				<title>vMarkd</title>
      ` +
    prerender.themeLink +
    cssStyleTags +
    prerender.style +
    `
			</head>
			<body ${bodyAttrs} style="--me-font-size:${config.fontSize}">
				<div id="app"></div>
				${prerender.overlay}
				${prerender.scrollScript}

				<script nonce="${nonce}" id="vditorI18nScript${i18nLang}" src="${i18nScript}"></script>
				<script nonce="${nonce}" id="vditorIconScript" src="${iconScript}"></script>
				${jsFiles.map((f) => `<script nonce="${nonce}" src="${f}"></script>`).join('\n')}
			</body>
			</html>`
  )
}
