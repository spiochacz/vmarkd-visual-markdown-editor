// Mermaid colour palettes paired with content themes — task 86.
//
// Mermaid ships only 5 built-in themes (default/base/dark/forest/neutral) and no
// version adds more; its `--vmarkd-*` content-theme map touches the rendered markdown,
// not the diagram SVG. To make a diagram match the chosen content theme we drive
// mermaid's customisable `base` theme via `themeVariables`. These palettes are the
// colour DATA (not the renderer) from `beautiful-mermaid` — see the attribution below.
//
// Dependency-free + isomorphic (like `theme-registry.ts`): the host (`src/`) and the
// webview (`media-src/` via `../../src/mermaid-palettes`) both import it.
//
// ---------------------------------------------------------------------------
// Palette colour values: MIT — Copyright (c) 2026 Craft Docs
// Source: lukilabs/beautiful-mermaid (npm `beautiful-mermaid`), src/theme.ts THEMES.
// We vendor only the colour values (facts), not beautiful-mermaid's renderer.
// ---------------------------------------------------------------------------

/** A source palette: 5 colours; `line`/`accent`/`muted` are derived if absent. */
export interface MermaidPalette {
  bg: string
  fg: string
  line?: string
  accent?: string
  muted?: string
}

export const MERMAID_PALETTES: Record<string, MermaidPalette> = {
  // VS Code "2026" default themes — tuned to match the vscode-{light,dark}-2026 content
  // themes (page bg = editor.background, line/accent = textLink, fg = editor.foreground).
  // node fill resolves from mix(bg, fg) to the theme's code/blockquote surface. Paired in
  // the registry so `auto` matches the editor; also selectable directly in the gallery.
  'vscode-light-2026': {
    bg: '#ffffff',
    fg: '#202020',
    line: '#0069cc',
    accent: '#0069cc',
  },
  'vscode-dark-2026': {
    bg: '#121314',
    fg: '#bbbebf',
    line: '#48a0c7',
    accent: '#48a0c7',
  },
  'zinc-light': { bg: '#FFFFFF', fg: '#27272A' },
  'zinc-dark': { bg: '#18181B', fg: '#FAFAFA' },
  'tokyo-night': {
    bg: '#1a1b26',
    fg: '#a9b1d6',
    line: '#3d59a1',
    accent: '#7aa2f7',
    muted: '#565f89',
  },
  'tokyo-night-storm': {
    bg: '#24283b',
    fg: '#a9b1d6',
    line: '#3d59a1',
    accent: '#7aa2f7',
    muted: '#565f89',
  },
  'tokyo-night-light': {
    bg: '#d5d6db',
    fg: '#343b58',
    line: '#34548a',
    accent: '#34548a',
    muted: '#9699a3',
  },
  'catppuccin-mocha': {
    bg: '#1e1e2e',
    fg: '#cdd6f4',
    line: '#585b70',
    accent: '#cba6f7',
    muted: '#6c7086',
  },
  'catppuccin-latte': {
    bg: '#eff1f5',
    fg: '#4c4f69',
    line: '#9ca0b0',
    accent: '#8839ef',
    muted: '#9ca0b0',
  },
  nord: {
    bg: '#2e3440',
    fg: '#d8dee9',
    line: '#4c566a',
    accent: '#88c0d0',
    muted: '#616e88',
  },
  'nord-light': {
    bg: '#eceff4',
    fg: '#2e3440',
    line: '#aab1c0',
    accent: '#5e81ac',
    muted: '#7b88a1',
  },
  dracula: {
    bg: '#282a36',
    fg: '#f8f8f2',
    line: '#6272a4',
    accent: '#bd93f9',
    muted: '#6272a4',
  },
  'github-light': {
    bg: '#ffffff',
    fg: '#1f2328',
    line: '#d1d9e0',
    accent: '#0969da',
    muted: '#59636e',
  },
  'github-dark': {
    bg: '#0d1117',
    fg: '#e6edf3',
    line: '#3d444d',
    accent: '#4493f8',
    muted: '#9198a1',
  },
  'solarized-light': {
    bg: '#fdf6e3',
    fg: '#657b83',
    line: '#93a1a1',
    accent: '#268bd2',
    muted: '#93a1a1',
  },
  'solarized-dark': {
    bg: '#002b36',
    fg: '#839496',
    line: '#586e75',
    accent: '#268bd2',
    muted: '#586e75',
  },
  'one-dark': {
    bg: '#282c34',
    fg: '#abb2bf',
    line: '#4b5263',
    accent: '#c678dd',
    muted: '#5c6370',
  },
}

/** Every palette id (the `theme.mermaid` values beyond the built-ins). */
export const MERMAID_PALETTE_NAMES: readonly string[] =
  Object.keys(MERMAID_PALETTES)

// --- small hex helpers (no deps) — shared by the per-engine palette translations ---------

export function parseHex(h: string): [number, number, number] {
  let s = h.replace('#', '').trim()
  if (s.length === 3)
    s = s
      .split('')
      .map((c) => c + c)
      .join('')
  const n = Number.parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Blend a→b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/** Relative luminance (0..1). */
export function luminance(h: string): number {
  const [r, g, b] = parseHex(h).map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const lower = (h: string) =>
  `#${parseHex(h)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`

/**
 * Translate a source palette into mermaid `base` theme variables covering the common
 * diagram types (flowchart, sequence, class, state, cluster, notes). Missing source
 * fields are derived from `bg`/`fg`. `darkMode` is set from `bg` luminance so mermaid's
 * own derived contrasts go the right way.
 */
export function paletteToThemeVariables(
  p: MermaidPalette,
): Record<string, string | boolean> {
  const bg = lower(p.bg)
  const fg = lower(p.fg)
  const line = lower(p.line ?? mix(bg, fg, 0.35))
  const accent = lower(p.accent ?? fg)
  const dark = luminance(bg) < 0.5
  const surface = mix(bg, fg, dark ? 0.1 : 0.05) // node fill
  const surface2 = mix(bg, fg, dark ? 0.16 : 0.09) // cluster / alt

  return {
    darkMode: dark,
    background: bg,
    // primary (flowchart nodes, default class/state)
    primaryColor: surface,
    primaryBorderColor: line,
    primaryTextColor: fg,
    secondaryColor: surface2,
    secondaryBorderColor: line,
    secondaryTextColor: fg,
    tertiaryColor: surface2,
    tertiaryBorderColor: line,
    tertiaryTextColor: fg,
    // edges / structure
    lineColor: line,
    textColor: fg,
    mainBkg: surface,
    secondBkg: surface2,
    nodeBorder: line,
    nodeTextColor: fg,
    clusterBkg: surface2,
    clusterBorder: line,
    titleColor: fg,
    edgeLabelBackground: bg,
    // notes
    noteBkgColor: mix(bg, accent, 0.18),
    noteTextColor: fg,
    noteBorderColor: accent,
    // sequence
    actorBkg: surface,
    actorBorder: line,
    actorTextColor: fg,
    actorLineColor: line,
    signalColor: fg,
    signalTextColor: fg,
    sequenceNumberColor: bg,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: line,
    labelTextColor: fg,
    loopTextColor: fg,
  }
}
