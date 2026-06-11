// Apply the resolved ECharts theme in the webview — task 90 (layer 3, application).
//
// Vditor's chartRender hardcodes `echarts.init(e, theme === "dark" ? "dark" : undefined)`. We
// patch that one call (esbuild `fixEchartsTheme`) to instead ask `window.__vmarkdEchartsResolve`,
// which this module installs. The resolver registers our derived theme object on the loaded
// `echarts` global (the ECharts UMD populates `window.echarts` by mutation after assignment, so
// registering at the point of use — not via a setter hook like mermaid — avoids the empty-object
// race) and returns the theme NAME for `init`. `null` name → ECharts default (light); a string →
// a built-in (`dark`) or our registered `vmarkd` theme.
//
// Pure except for the `win` it's given.

import type { EchartsThemeSpec, EditorPalette } from '../../src/echarts-theme'

// Normalise a CSS colour to a 6-digit hex, or undefined if it isn't hex (VS Code theme vars are
// hex, sometimes 8-digit with alpha — drop the alpha; rgb()/named colours aren't supported here).
function normHex(v: string | undefined): string | undefined {
  const s = (v || '').trim()
  if (!s.startsWith('#')) return undefined
  const h = s.slice(1)
  if (/^[0-9a-fA-F]{3}$/.test(h)) return s
  if (/^[0-9a-fA-F]{6,8}$/.test(h)) return `#${h.slice(0, 6)}`
  return undefined
}

/**
 * Build a palette from the VS Code editor's own theme colours so an unpaired (content-theme
 * `auto`) ECharts chart follows the editor — background/text from the editor, and the SERIES
 * colours from VS Code's dedicated chart colours (`--vscode-charts-*`), which the theme picks to
 * read well on its background. undefined if the core vars are absent/non-hex (e.g. the bare test
 * harness) → the caller falls back to a neutral palette.
 */
export function readVscodePalette(win: any): EditorPalette | undefined {
  const doc = win?.document
  const root = doc?.documentElement
  if (!root || typeof win.getComputedStyle !== 'function') return undefined
  const cs = win.getComputedStyle(root)
  const v = (name: string) => normHex(cs.getPropertyValue(name))
  const bg = v('--vscode-editor-background')
  const fg = v('--vscode-charts-foreground') || v('--vscode-editor-foreground')
  if (!bg || !fg) return undefined
  const accent =
    v('--vscode-charts-blue') ||
    v('--vscode-textLink-foreground') ||
    v('--vscode-focusBorder')
  const line = v('--vscode-charts-lines')
  // VS Code's chart colours, in a pleasant order (blue first so a single series matches links).
  const series = ['blue', 'green', 'orange', 'purple', 'red', 'yellow']
    .map((c) => v(`--vscode-charts-${c}`))
    .filter((c): c is string => !!c)
  const pal: EditorPalette = { bg, fg }
  if (accent) pal.accent = accent
  if (line) pal.line = line
  if (series.length) pal.series = series
  return pal
}

export function applyEchartsTheme(
  win: any,
  spec: EchartsThemeSpec | null | undefined,
): void {
  win.__vmarkdEchartsTheme = spec?.name ?? null
  win.__vmarkdEchartsThemeObj = spec?.theme ?? null
  // Installed once; reads the (mutable) window fields each call so a live theme change is
  // picked up by the next render without re-installing.
  if (!win.__vmarkdEchartsResolve) {
    win.__vmarkdEchartsResolve = (ec: any): string | undefined => {
      const name = win.__vmarkdEchartsTheme
      const obj = win.__vmarkdEchartsThemeObj
      if (name && obj && ec && typeof ec.registerTheme === 'function') {
        ec.registerTheme(name, obj) // idempotent — overwrites, so re-theme just re-registers
      }
      return name == null ? undefined : name
    }
  }
}
