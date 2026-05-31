// Live application of config-driven webview state without re-initialising Vditor
// (tasks 12/26). main.ts uses these from the init payload and from the host's
// `config-changed` / `reload-css` messages (posted on onDidChangeConfiguration
// and external-CSS file changes), so setting/CSS edits apply to open editors
// without reopening.

export interface BodyOptions {
  useVscodeThemeColor?: boolean
  enableFullWidth?: boolean
  highlightHeadings?: boolean
  showHeadingMarkers?: boolean
  outlineWidth?: number
}

// Apply the body-attribute / CSS-var driven options. Mirrors what the CSS keys
// off (`data-*` attributes, `--me-outline-width`). Vditor is untouched.
export function applyBodyOptions(options: BodyOptions | undefined): void {
  const body = document.body
  body.setAttribute(
    'data-use-vscode-theme-color',
    options?.useVscodeThemeColor ? '1' : '0'
  )
  body.setAttribute('data-full-width', options?.enableFullWidth ? '1' : '0')
  body.setAttribute(
    'data-highlight-headings',
    options?.highlightHeadings ? '1' : '0'
  )
  body.setAttribute(
    'data-heading-markers',
    options?.showHeadingMarkers === false ? '0' : '1'
  )
  if (typeof options?.outlineWidth === 'number' && options.outlineWidth > 0) {
    body.style.setProperty('--me-outline-width', `${options.outlineWidth}px`)
  }
}

// Swap (creating if needed) an id'd <style> node so host-driven CSS — the
// `customCss` setting and external CSS files — can be replaced live.
export function swapStyle(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = css ?? ''
}
