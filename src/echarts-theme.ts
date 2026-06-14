// ECharts theme paired with the content theme — task 90.
//
// This is layer 2 (translation) + the resolver for ECharts, parallel to mermaid's
// `paletteToThemeVariables` in `mermaid-palettes.ts`. It reuses the SHARED layer-1 mapping
// (`pairedPalette` in `theme-registry.ts`) and the SHARED palette DATA (`MERMAID_PALETTES`),
// but emits an ECharts *theme object* (`{color, backgroundColor, textStyle, <axis>, legend,
// tooltip}`) consumed via `echarts.registerTheme` + `init(el, name)` — NOT mermaid's
// `themeVariables`. See the `vmarkd-renderer-theming` skill for the three-layer model.
//
// Dependency-free + isomorphic (like `theme-registry.ts` / `mermaid-palettes.ts`): the host
// (`src/`) and the webview (`media-src/` via `../../src/echarts-theme`) both import it.

import { ECHARTS_GALLERY, ECHARTS_GALLERY_NAMES } from './echarts-gallery'
import {
  type MermaidPalette,
  MERMAID_PALETTES,
  lower,
  luminance,
  mix,
  parseHex,
  toHex,
} from './mermaid-palettes'
import { pairedPalette } from './theme-registry'

// --- HSL helpers (ECharts wants a multi-hue series palette; mermaid never needed this) -----

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l] // achromatic
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h / 6, s, l]
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) return toHex(l * 255, l * 255, l * 255)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return toHex(
    hue2rgb(p, q, h + 1 / 3) * 255,
    hue2rgb(p, q, h) * 255,
    hue2rgb(p, q, h - 1 / 3) * 255,
  )
}

/**
 * A categorical series palette derived from the accent hue: walk the hue wheel by the golden
 * angle (≈137.5°) for well-separated colours, keeping the accent's saturation/lightness (nudged
 * for legibility on the background). `count` distinct hex colours, accent first.
 */
function seriesPalette(accent: string, bg: string, count = 8): string[] {
  const [r, g, b] = parseHex(accent)
  const [h0, s0, l0] = rgbToHsl(r, g, b)
  const dark = luminance(bg) < 0.5
  const s = Math.min(1, Math.max(0.45, s0)) // keep colours saturated enough to read
  const l = dark
    ? Math.min(0.72, Math.max(0.55, l0)) // lift on dark backgrounds
    : Math.min(0.55, Math.max(0.38, l0)) // deepen on light backgrounds
  const golden = 0.381966 // 137.5° / 360°
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const h = (h0 + i * golden) % 1
    out.push(hslToHex(h, s, l))
  }
  return out
}

/**
 * Translate a shared diagram palette into an ECharts theme object covering the common chart
 * surfaces (series colours, background, text, axes, grid, legend, tooltip). Missing source
 * fields are derived from `bg`/`fg`, mirroring `paletteToThemeVariables`.
 */
export function paletteToEchartsTheme(
  p: MermaidPalette,
): Record<string, unknown> {
  const bg = lower(p.bg)
  const fg = lower(p.fg)
  const line = lower(p.line ?? mix(bg, fg, 0.35))
  const accent = lower(p.accent ?? fg)
  const muted = lower(p.muted ?? mix(bg, fg, 0.55))
  const grid = mix(bg, fg, 0.12) // faint split lines
  const surface = mix(bg, fg, luminance(bg) < 0.5 ? 0.12 : 0.06) // tooltip bg

  const axis = {
    axisLine: { show: true, lineStyle: { color: line } },
    axisTick: { show: true, lineStyle: { color: line } },
    axisLabel: { color: fg },
    splitLine: { show: true, lineStyle: { color: [grid] } },
    splitArea: { show: false, areaStyle: { color: [bg, surface] } },
  }

  return {
    color: seriesPalette(accent, bg),
    backgroundColor: bg,
    textStyle: { color: fg },
    title: {
      textStyle: { color: fg },
      subtextStyle: { color: muted },
    },
    categoryAxis: axis,
    valueAxis: axis,
    logAxis: axis,
    timeAxis: axis,
    legend: { textStyle: { color: fg } },
    tooltip: {
      backgroundColor: surface,
      borderColor: line,
      textStyle: { color: fg },
      axisPointer: {
        lineStyle: { color: line },
        crossStyle: { color: line },
      },
    },
    // pie/graph labels and the like inherit textStyle.color; series-specific borders read bg
    // so slices/markers separate cleanly on the themed background.
    line: { itemStyle: { borderWidth: 0 } },
    visualMap: { textStyle: { color: fg } },
    timeline: {
      lineStyle: { color: line },
      label: { color: fg },
      controlStyle: { color: accent, borderColor: accent },
    },
  }
}

/** The registered name we use for the derived (content-theme-paired) theme. */
export const ECHARTS_THEME_NAME = 'vmarkd'

// vMarkd custom themes (not from ECharts' gallery). `vintage-dark` is our dark adaptation of
// ECharts' (light) `vintage`: its warm retro series palette on a warm dark surface.
const VINTAGE_DARK_PALETTE: MermaidPalette = {
  bg: '#292420',
  fg: '#e8ddc9',
  line: '#5c5446',
  accent: '#d7ab82',
  muted: '#9a8f7a',
}
export const ECHARTS_CUSTOM_NAMES: readonly string[] = ['vintage-dark']

function customTheme(setting: string): EchartsThemeSpec | null {
  if (setting === 'vintage-dark') {
    const theme = paletteToEchartsTheme(VINTAGE_DARK_PALETTE)
    const vintage = ECHARTS_GALLERY.vintage as { color?: string[] } | undefined
    if (vintage?.color?.length) theme.color = vintage.color // keep vintage's identity
    return { name: 'vintage-dark', theme }
  }
  return null
}

/**
 * All `vmarkd.theme.echarts` enum values: `auto` (follow the content theme) + ECharts' own
 * built-in light/dark + the vendored gallery themes + our custom themes. Keep the manifest enum
 * in sync with this.
 */
export const ECHARTS_THEME_VALUES: readonly string[] = [
  'auto',
  'light',
  'dark',
  ...ECHARTS_GALLERY_NAMES,
  ...ECHARTS_CUSTOM_NAMES,
]

/** What `echarts.init`'s theme arg should be + the object to register. */
export interface EchartsThemeSpec {
  /** Theme name for `registerTheme(name, theme)` + `init(el, name)`. */
  name: string
  /** The theme object to register before init. */
  theme: Record<string, unknown>
}

/**
 * The editor's own colours for the `auto`/VS Code-following case: a palette + (ideally) the
 * theme's dedicated chart series colours (VS Code `--vscode-charts-*`), which are designed to
 * contrast with the editor background while harmonising with the theme.
 */
export interface EditorPalette extends MermaidPalette {
  series?: string[]
}

function vmarkdTheme(p: MermaidPalette, series?: string[]): EchartsThemeSpec {
  const theme = paletteToEchartsTheme(p)
  // Prefer the theme's own chart colours over our derived (golden-angle) series — they're picked
  // to read well on the editor background.
  if (series?.length) theme.color = series
  return { name: ECHARTS_THEME_NAME, theme }
}

// Resolve a named ECharts theme (a custom vMarkd theme or a vendored gallery theme) to a spec,
// or null if the name isn't one. Gallery themes get a white backdrop back-filled (they omit it).
function themeByName(name: string): EchartsThemeSpec | null {
  const custom = customTheme(name)
  if (custom) return custom
  const t = ECHARTS_GALLERY[name]
  if (!t) return null
  return {
    name,
    theme: t.backgroundColor ? t : { ...t, backgroundColor: '#ffffff' },
  }
}

// The vintage series palette (warm retro colours), reused for the material-dark pairing.
const VINTAGE_SERIES =
  (ECHARTS_GALLERY.vintage as { color?: string[] } | undefined)?.color ?? []

// ECharts-specific `auto` pairings to a BAKED palette (background/foreground + series). The
// chart background uses the CONTENT THEME's page background so the chart blends with the rendered
// page (not a contrasting block). Mermaid keeps its shared palette pairing — this is ECharts-only.
//   - VS Code Dark/Light 2026 → VS Code's own chart colours (`charts.*` registry defaults,
//     resolved from editorError/Info/Warning + green/purple) on the 2026 editor background.
//   - material-dark → the warm vintage series on the material-dark (one-dark) page background.
const ECHARTS_CONTENT_PALETTE: Record<string, EditorPalette> = {
  'material-dark': {
    bg: '#282c34', // material-dark page background (one-dark) — chart blends with the page
    fg: '#abb2bf',
    accent: '#d7ab82',
    series: VINTAGE_SERIES,
  },
  'vscode-dark-2026': {
    bg: '#121314', // Dark 2026 editor.background — chart blends with the page
    fg: '#bbbebf',
    accent: '#59a4f9',
    // VS Code chart colours (dark): blue/green/yellow/red/purple.
    series: ['#59a4f9', '#89d185', '#cca700', '#f14c4c', '#b180d7'],
  },
  'vscode-light-2026': {
    bg: '#ffffff',
    fg: '#202020',
    accent: '#0063d3',
    // VS Code chart colours (light).
    series: ['#0063d3', '#388a34', '#bf8803', '#e51400', '#652d90'],
  },
}

/**
 * Resolve the ECharts theme from the `theme.echarts` setting + active content theme. Precedence
 * (mirrors `resolveMermaidInit`): explicit gallery theme → explicit `light`/`dark` → `auto`:
 * content-theme paired palette → the VS Code editor's own colours (`vscodePalette`) → a neutral
 * light/dark fallback.
 *
 * We ALWAYS return a registered theme object — never a bare ECharts name. ECharts 6's core ships
 * no usable `light` theme (the default has a transparent background) and its gallery themes omit
 * `backgroundColor` too, so leaning on built-ins left charts transparent / not following the
 * editor. Deriving (or back-filling) a background fixes that.
 */
export function resolveEchartsTheme(
  setting: string | undefined,
  contentTheme: string | undefined,
  mode: 'dark' | 'light',
  vscodePalette?: EditorPalette,
): EchartsThemeSpec {
  // Explicit setting: a named theme (custom/gallery), else the neutral light/dark.
  if (setting && setting !== 'auto') {
    const named = themeByName(setting)
    if (named) return named
    if (setting === 'light') return vmarkdTheme(MERMAID_PALETTES['zinc-light'])
    if (setting === 'dark') return vmarkdTheme(MERMAID_PALETTES['zinc-dark'])
  }
  // auto: an ECharts-specific baked palette (VS Code Modern → VS Code chart colours;
  // material-dark → vintage series) wins over the shared diagram palette…
  const baked = contentTheme && ECHARTS_CONTENT_PALETTE[contentTheme]
  if (baked) return vmarkdTheme(baked, baked.series)
  // …then the shared content-theme palette (also used by mermaid).
  const id = pairedPalette(contentTheme)
  if (id && MERMAID_PALETTES[id]) return vmarkdTheme(MERMAID_PALETTES[id])
  // No pairing (content theme is `auto`/VS Code colours) → follow the editor's own colours if we
  // have them (background, text, AND its chart series colours), else a neutral light/dark by mode.
  return vmarkdTheme(
    vscodePalette ??
      MERMAID_PALETTES[mode === 'dark' ? 'zinc-dark' : 'zinc-light'],
    vscodePalette?.series,
  )
}
