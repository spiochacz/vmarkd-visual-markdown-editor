// Live application of config-driven webview state without re-initialising Vditor
// (tasks 12/26). main.ts uses these from the init payload and from the host's
// `config-changed` / `reload-css` messages (posted on onDidChangeConfiguration
// and external-CSS file changes), so setting/CSS edits apply to open editors
// without reopening.

// `--me-font-size` resolution lives in the shared theme registry so the webview and
// the host can't diverge (task 84). Re-exported so existing importers/tests are
// unchanged — the old duplicate definition is gone.
import { resolveFontSize } from '../../src/theme-registry'
import type { VmarkdConfigOptions } from '../../src/protocol'
export { resolveFontSize }

// Derived from the shared config type (task 151 item 4) so a renamed setting key
// propagates as a compile error here instead of silently reading `undefined`.
// `fontSize` is widened to also accept a number (resolveFontSize handles both).
export type BodyOptions = Pick<
  VmarkdConfigOptions,
  | 'useVscodeThemeColor'
  | 'contentTheme'
  | 'enableFullWidth'
  | 'highlightHeadings'
  | 'showHeadingMarkers'
  | 'outlineWidth'
> & { fontSize?: string | number }

// Rendering theme (task 82): apply a markdown content theme by toggling the
// `markdown-body` class on <body> (the class the vendored theme stylesheets target)
// and enabling exactly one of the pre-emitted `ct-<value>` <link> stylesheets via
// `link.disabled`. `auto` disables all + drops the class → the VS Code-colour path
// (data-use-vscode-theme-color) renders, unchanged. New themes need no change here.
export function applyContentTheme(contentTheme: string | undefined): void {
  const ct = contentTheme || 'auto'
  document.body.classList.toggle('markdown-body', ct !== 'auto')
  const links = document.querySelectorAll<HTMLLinkElement>('link[id^="ct-"]')
  links.forEach((l) => {
    // Only WRITE when the state actually changes. On first init this runs while the
    // instant-paint overlay is still on screen and the links are ALREADY in their
    // correct enabled/disabled state (the initial HTML emitted them that way) — and
    // assigning `link.disabled` even to its current value makes some browsers re-
    // evaluate the stylesheet, momentarily dropping the active theme's `--vmarkd-*`
    // vars so var-driven elements (hr, inline code, …) flash to Vditor's fallback
    // colour. Guarding the write keeps the overlay→live swap flicker-free.
    const want = l.id !== `ct-${ct}`
    if (l.disabled !== want) l.disabled = want
  })
}

// Apply the body-attribute / CSS-var driven options. Mirrors what the CSS keys
// off (`data-*` attributes, `--me-outline-width`). Vditor is untouched.
export function applyBodyOptions(options: BodyOptions | undefined): void {
  const body = document.body
  // Write only on change. On first init this runs while the instant-paint overlay is
  // still on screen, and the body already carries the matching attributes/vars from the
  // initial HTML (html-builder emits the same values). Re-setting an attribute or CSS var
  // to its current value can still trigger a style recalc / stylesheet re-eval, which
  // flashes the overlay (text colour, hr, inline-code — whatever a theme drives). Guarding
  // every write keeps the overlay→live swap flicker-free; live config changes still apply.
  const setAttr = (name: string, val: string) => {
    if (body.getAttribute(name) !== val) body.setAttribute(name, val)
  }
  const setVar = (name: string, val: string) => {
    if (body.style.getPropertyValue(name) !== val) {
      body.style.setProperty(name, val)
    }
  }
  setAttr(
    'data-use-vscode-theme-color',
    options?.useVscodeThemeColor ? '1' : '0',
  )
  applyContentTheme(options?.contentTheme)
  setAttr('data-full-width', options?.enableFullWidth ? '1' : '0')
  setAttr('data-highlight-headings', options?.highlightHeadings ? '1' : '0')
  setAttr(
    'data-heading-markers',
    options?.showHeadingMarkers === false ? '0' : '1',
  )
  if (typeof options?.outlineWidth === 'number' && options.outlineWidth > 0) {
    setVar('--me-outline-width', `${options.outlineWidth}px`)
  }
  setVar(
    '--me-font-size',
    resolveFontSize(options?.fontSize, options?.contentTheme),
  )
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
  'wikiEnabled',
  // NOTE: mermaidTheme is applied LIVE (applyMermaidTheme + offscreen reRenderMermaid in
  // handleConfigChanged), NOT via re-init — re-init scrolls the editor to the top on big
  // docs (task 59 follow-up: the reported mermaid-theme scroll jump).
] as const

export function initOnlyChanged(
  prev: Record<string, any> | undefined,
  next: Record<string, any> | undefined,
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
