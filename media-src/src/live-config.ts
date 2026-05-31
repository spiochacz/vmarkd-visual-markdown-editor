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
  fontSize?: string | number
}

const VSCODE_FONT_SIZE = 'var(--vscode-editor-font-size, 14px)'

// Resolve the `fontSize` setting into a CSS value for `--me-font-size`.
//   "editor" / unset  -> follow VS Code's editor font size
//   "vditor"          -> Vditor's own 16px reading size
//   a number / "15"   -> that many pixels
// Anything unrecognised falls back to the VS Code size.
export function resolveFontSize(value: string | number | undefined): string {
  if (value === undefined || value === '' || value === 'editor')
    return VSCODE_FONT_SIZE
  if (value === 'vditor') return '16px'
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) && n > 0 ? `${n}px` : VSCODE_FONT_SIZE
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
  body.style.setProperty('--me-font-size', resolveFontSize(options?.fontSize))
}

// Settings that are Vditor *constructor* options (toolbar, counter, code-block
// line numbers, outline init) — they can't be toggled on the live instance, so
// a change to any of these means main.ts must re-initialise Vditor.
export const INIT_ONLY_OPTIONS = [
  'showToolbar',
  'wordCount',
  'codeBlockLineNumbers',
  'outlinePosition',
  'showOutlineByDefault',
  'outlineHighlight',
  // changing the mermaid theme re-inits so existing diagrams re-render themed
  'mermaidTheme',
] as const

export function initOnlyChanged(
  prev: Record<string, any> | undefined,
  next: Record<string, any> | undefined
): boolean {
  return INIT_ONLY_OPTIONS.some((k) => prev?.[k] !== next?.[k])
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
