// Offline Graphviz render + theme-agnostic post-processing (task 94; extracted from a ~60-line
// esbuild patch STRING into a real, typed, unit-tested module by task 144 item 1, mirroring
// plantuml-render.ts). Vditor's `graphvizRender.ts` is rewritten at bundle time into a thin shim
// that re-exports `graphvizRender` from here. Imports NO Vditor internals (adapter one-liners inlined;
// script load via shared `loadScript`) so `themeGraphvizSvg` is testable in jsdom. Viz.js is loaded
// from the shared `viz-global.js` (the same asset PlantUML uses).

import { resolveDiagramPalette } from './diagram-palette'
import { loadScript } from './load-script'

// Graphviz/DOT default colours. FOREGROUND = baked ink (edges/borders/text) repainted to currentColor
// so it follows the theme; BG = the solid graph-background polygon we drop; nodes get a faint tint.
// Named so a Viz.js default change is greppable here (task 144 item 2), not a silent miscolour.
const GV_FOREGROUND = new Set(['#000000', 'black'])
const GV_BG_FILL = new Set(['white', '#ffffff'])
const NODE_FILL_OPACITY = '0.06'

// Repaint a rendered Graphviz SVG to be theme-agnostic. Pure DOM walk (no innerHTML serialize→reparse
// — task 144 item 3). Idempotent: a second pass sees currentColor, which is in none of the colour
// sets, so it's a no-op.
export function themeGraphvizSvg(container: HTMLElement): void {
  const svg = container.querySelector('svg')
  if (!svg) return
  // Baked foreground on ANY element (edges/borders/text) → currentColor.
  for (const el of Array.from(svg.querySelectorAll('[fill], [stroke]'))) {
    if (GV_FOREGROUND.has(el.getAttribute('fill') ?? ''))
      el.setAttribute('fill', 'currentColor')
    if (GV_FOREGROUND.has(el.getAttribute('stroke') ?? ''))
      el.setAttribute('stroke', 'currentColor')
  }
  // Text with no fill attr (SVG default = black) → currentColor.
  for (const t of Array.from(svg.querySelectorAll('text'))) {
    if (!t.getAttribute('fill')) t.setAttribute('fill', 'currentColor')
  }
  // Remove the solid graph-background polygon (white fill, no/none stroke).
  for (const p of Array.from(svg.querySelectorAll('polygon'))) {
    const f = p.getAttribute('fill')
    const s = p.getAttribute('stroke')
    if (GV_BG_FILL.has(f ?? '') && (s === 'none' || s === 'transparent' || !s))
      p.remove()
  }
  // Node shapes (empty ellipses + the polygons we just repainted to currentColor) → faint tint, so
  // they read as filled on any background (like mermaid's themed node backgrounds).
  for (const s of Array.from(
    svg.querySelectorAll("ellipse, polygon[fill='currentColor']"),
  )) {
    const f = s.getAttribute('fill')
    if (f === 'none' || f === 'currentColor') {
      s.setAttribute('fill', 'currentColor')
      s.setAttribute('fill-opacity', NODE_FILL_OPACITY)
    }
  }
}

// Full palette-pairing (default per ADR-0006): inject palette colours as DOT graph/node/edge DEFAULT
// attribute statements right after the graph header `{`, so Graphviz colours the diagram semantically
// — node fill = surface, borders/edges/cluster = line, text = fg, transparent canvas — pairing it with
// the content theme like mermaid (was: foreground-monochrome via themeGraphvizSvg only). Inserted FIRST
// so any author colour (a later `node [...]` default or an `X [color=…]`) overrides ours (ADR-0006:
// user directives win — verified: an author `fillcolor` survives). themeGraphvizSvg still runs after as
// the safety net (neutralises any stray baked black, drops a white bg polygon). Verified offline against
// the bundled Viz.js on digraph/graph/strict/cluster/author-coloured DOT — all theme cleanly.
export function applyGraphvizTheme(
  dot: string,
  p: { surface: string; line: string; fg: string },
): string {
  const defaults =
    `\n  graph [bgcolor="transparent", color="${p.line}", fontcolor="${p.fg}"];\n` +
    `  node [style="filled", fillcolor="${p.surface}", color="${p.line}", fontcolor="${p.fg}"];\n` +
    `  edge [color="${p.line}", fontcolor="${p.fg}"];\n`
  // Insert after the FIRST graph header `{` (strict? (di)graph name? {). No match (malformed DOT) →
  // return as-is and let Viz.js surface the parse error.
  const m = dot.match(/(?:strict\s+)?(?:di)?graph\b[^{]*\{/i)
  if (!m) return dot
  const at = (m.index ?? 0) + m[0].length
  return dot.slice(0, at) + defaults + dot.slice(at)
}

// Render every `.language-graphviz` block under `element` via the local Viz.js engine, then theme the
// SVG. Lazy-loads the shared viz-global.js once. element/cdn come from Vditor's previewRender through
// the shim; getElements/getCode are the (trivial) inlined adapter.
export function graphvizRender(
  element: Document | HTMLElement = document,
  cdn = '',
): void {
  const graphvizElements =
    element.querySelectorAll<HTMLElement>('.language-graphviz')
  if (graphvizElements.length === 0) return

  // Shared Viz.js, in its own dir (task 144 item 6) — same asset the plantuml engine loads.
  loadScript(`${cdn}/dist/js/viz/viz-global.js`, 'vditorVizGlobalScript').then(
    () => {
      const VizCtor = (window as unknown as { Viz?: any }).Viz
      if (!VizCtor?.instance) return
      VizCtor.instance().then((viz: any) => {
        const palette = resolveDiagramPalette()
        for (const e of Array.from(graphvizElements)) {
          if (
            e.parentElement?.classList.contains('vditor-wysiwyg__pre') ||
            e.parentElement?.classList.contains('vditor-ir__marker--pre')
          ) {
            continue
          }
          if (e.getAttribute('data-processed') === 'true') continue
          // On re-render (theme flip) textContent is SVG garbage; prefer saved data-code.
          const code = (
            e.getAttribute('data-code') ||
            e.textContent ||
            ''
          ).trim()
          if (!code) continue
          try {
            e.setAttribute('data-code', code)
            const result = viz.renderSVGElement(
              applyGraphvizTheme(code, palette),
            ) as SVGElement
            e.innerHTML = ''
            e.appendChild(result) // append the live node — no innerHTML reparse (item 3)
            themeGraphvizSvg(e)
          } catch (error) {
            e.innerHTML = `graphviz render error: <br>${error}`
            e.className = 'vditor-reset--error'
          }
          e.setAttribute('data-processed', 'true')
        }
      })
    },
  )
}
