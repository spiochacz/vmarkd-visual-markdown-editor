// Resolve the active diagram palette (the shared 5-field colours + derived surfaces) for the
// palette-paired SVG renderers — plantuml first, then graphviz/nomnoml/flowchart. The
// content-theme→palette mapping is the SAME shared layer-1 mermaid/echarts use (`pairedPalette`
// → `MERMAID_PALETTES`), so a plantuml box tints like a mermaid node on the same theme. When the
// content theme is `auto`/VS Code colours (no pairing) we derive a palette from the live VS Code
// editor CSS variables so the diagram still matches the editor; failing that, a github light/dark
// palette by the editor mode.
//
// Reads `contentTheme` + `mode` from the d2-config globals (d2-config.ts) — main.ts keeps them
// current on init + every theme flip (they are documented there as the diagram-theme inputs), so a
// renderer with no palette argument (plantumlRender/graphvizRender are called bare by Vditor's
// previewRender) can still resolve the right colours, and re-render picks up a flip for free.

import {
  type DiagramColors,
  deriveDiagramColors,
  MERMAID_PALETTES,
  type MermaidPalette,
} from '../../src/mermaid-palettes'
import { pairedPalette } from '../../src/theme-registry'
import { getD2Config } from './d2-config'

// A computed VS Code CSS var, normalised to a 6-digit hex (drop an 8-digit alpha) — the palette
// maths (parseHex) only understands #rgb/#rrggbb. Non-hex (rgb()/empty) → undefined so the caller
// skips that field and falls back rather than feeding parseHex garbage.
function hexVar(cs: CSSStyleDeclaration, name: string): string | undefined {
  const raw = cs.getPropertyValue(name).trim()
  if (/^#[0-9a-fA-F]{8}$/.test(raw)) return raw.slice(0, 7)
  if (/^#[0-9a-fA-F]{6}$/.test(raw) || /^#[0-9a-fA-F]{3}$/.test(raw)) return raw
  return undefined
}

// VS Code editor theme → a source palette, used when the content theme is `auto`/VS Code colours so
// a diagram still pairs with the live editor. Mirrors echarts' readVscodePalette but kept local so
// the diagram renderers don't couple to the echarts module. undefined when bg/fg aren't resolvable
// hex (e.g. outside a real webview) → caller falls back to a github palette.
function vscodePalette(win: Window): MermaidPalette | undefined {
  const root = win.document?.documentElement
  if (!root || typeof win.getComputedStyle !== 'function') return undefined
  const cs = win.getComputedStyle(root)
  const bg = hexVar(cs, '--vscode-editor-background')
  const fg = hexVar(cs, '--vscode-editor-foreground')
  if (!bg || !fg) return undefined
  const accent =
    hexVar(cs, '--vscode-textLink-foreground') ||
    hexVar(cs, '--vscode-charts-blue') ||
    hexVar(cs, '--vscode-focusBorder')
  const line =
    hexVar(cs, '--vscode-panel-border') || hexVar(cs, '--vscode-charts-lines')
  const p: MermaidPalette = { bg, fg }
  if (accent) p.accent = accent
  if (line) p.line = line
  return p
}

function fallbackPalette(mode: 'dark' | 'light'): MermaidPalette {
  return MERMAID_PALETTES[mode === 'dark' ? 'github-dark' : 'github-light']
}

// The active diagram palette: paired content theme → VS Code vars → github by mode.
export function resolveDiagramPalette(win: Window = window): DiagramColors {
  const { contentTheme, mode } = getD2Config()
  const m: 'dark' | 'light' = mode === 'dark' ? 'dark' : 'light'
  const pairedId = pairedPalette(contentTheme)
  const base: MermaidPalette =
    (pairedId && MERMAID_PALETTES[pairedId]) ||
    vscodePalette(win) ||
    fallbackPalette(m)
  return deriveDiagramColors(base)
}
