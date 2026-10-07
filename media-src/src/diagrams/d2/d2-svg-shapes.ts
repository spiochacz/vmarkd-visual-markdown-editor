// Bespoke shape drawing (task 474 — extracted verbatim from d2-render.ts). Each shape's SVG
// emission lives here; toSVG dispatches to these + the per-shape leaf drawers (task 474). Grid
// children + sql_table/class rows are laid out here too.
import {
  CELL_PAD,
  CODE_FONT,
  CODE_PAD,
  EDGE_FONT_SIZE,
  FONT_SIZE,
  PROSE_LH,
  ROW_H,
  TEXT_PAD,
} from './d2-consts'
import type { GridInfo } from './d2-layout'
import type { D2Style } from './d2-style'
import type { D2Shape } from './d2-wasm'
import {
  anchorFlow,
  esc2,
  labelAnchorFor,
  labelRows,
  transformLabel,
} from './d2-svg-paths'
import { paintAttrs, textAttrs, type Paint } from './d2-style'
import type { Sketch } from './d2-style'
import { headerBandH, vis } from './d2-layout'

export function drawGrid(
  s: D2Shape,
  gi: GridInfo,
  left: number,
  top: number,
  w: number,
  h: number,
  sty: D2Style,
  // Task 396 — grid labels need to know whether the fills around them are hachure, same as every
  // other shape label; drawGrid is outside toSVG's closure so it has to be handed the flag.
  hachured = false,
): string {
  const out: string[] = []
  const rx = s.borderRadius || 6
  // Grid container = a level-0 container fill (d2 B4); cells are leaves (B6).
  const cfill = sty.mono ? sty.contFill : sty.fills[0]
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, cfill, sty.contStroke)} fill-opacity="${s.fill ? '1' : sty.contOpacity}"/>`,
  )
  if (s.label) {
    // Task 134 — `label.near` overrides the default top-left header position when set.
    const gla = labelAnchorFor(s.labelPosition, left, top, w, h)
    const glx = gla ? gla.x : left + 8
    const gly = gla ? gla.y : top + gi.headerH - 6
    const glaAttrs = gla
      ? ` text-anchor="${gla.anchor}"${gla.baseline ? ` dominant-baseline="${gla.baseline}"` : ''}`
      : ''
    out.push(
      // The grid header sits on the BOTTOM of its band (top + headerH - 6), so extra rows grow UP
      // inside the band computeGridInfo already sized from measure(label).h.
      `<text x="${glx.toFixed(1)}" y="${gly.toFixed(1)}"${glaAttrs} ${textAttrs(s, FONT_SIZE, cfill, sty.text, hachured)}>${labelRows(transformLabel(s.label, s.textTransform), glx, gly, FONT_SIZE, anchorFlow(gla?.baseline, 'up'))}</text>`,
    )
  }
  const ox = left + 8
  const oy = top + gi.headerH + 8
  gi.children.forEach((c, i) => {
    const col = i % gi.cols
    const row = Math.floor(i / gi.cols)
    const cw = gi.cellW - 16
    const ch = gi.cellH - 16
    const cx = ox + col * gi.cellW + 8
    const cy = oy + row * gi.cellH + 8
    out.push(
      `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="${c.borderRadius || 4}" ${paintAttrs(c, sty.leafFill, sty.leafStroke)}/>`,
    )
    out.push(
      `<text x="${(cx + cw / 2).toFixed(1)}" y="${(cy + ch / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${textAttrs(c, FONT_SIZE, sty.leafFill, sty.text, hachured)}>${labelRows(c.label, cx + cw / 2, cy + ch / 2, FONT_SIZE, 'center')}</text>`,
    )
  })
  return out.join('\n')
}

// Chrome shared by drawSqlTable/drawClass (task 381 — the panel-header colouring already documents the
// token mapping as shared; this is the SVG emission side of that, factored out task 502): body rect +
// solid header band + header title text. Pushes onto the caller's `out` and returns the tokens the
// caller still needs (border for row dividers, hh for row Y offsets). Member/field-row colouring
// (nameC/typeC/etc.) is NOT shared — sql_table and class map those to different D2Style tokens.
function drawTablePanelHeader(
  s: D2Shape,
  left: number,
  top: number,
  w: number,
  h: number,
  sty: D2Style,
  out: string[],
): { border: string; hh: number } {
  const border = s.stroke || (sty.mono ? 'currentColor' : sty.tableBorder)
  const body = s.fill || (sty.mono ? 'transparent' : sty.paper)
  const headerFill = sty.mono ? 'currentColor' : sty.tableHeaderFill
  const headerOp = sty.mono ? ' fill-opacity="0.12"' : ''
  const headerText =
    s.fontColor || (sty.mono ? 'currentColor' : sty.tableHeaderText)
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${body}" stroke="${border}" stroke-width="${s.strokeWidth || 2}"/>`,
  )
  const hh = headerBandH(s.label) // taller than HEADER_H only for a multi-line title (task 493)
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${hh}" rx="4" fill="${headerFill}"${headerOp}/>`,
  )
  out.push(
    `<text x="${(left + w / 2).toFixed(1)}" y="${(top + hh / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE}" font-weight="700" fill="${headerText}">${labelRows(s.label, left + w / 2, top + hh / 2, FONT_SIZE, 'center')}</text>`,
  )
  return { border, hh }
}

export function drawSqlTable(
  s: D2Shape,
  cols: number[],
  left: number,
  top: number,
  w: number,
  h: number,
  sty: D2Style,
): string {
  const out: string[] = []
  // Faithful d2 sql_table colouring (verified against the binary): NEUTRAL body (N7 fill, N1 border),
  // a SOLID N1 header with N7 title text, dividers in N1, and columns name=B2 / type=N2 /
  // constraint=AA2. The three chrome tokens carry that mapping for the d2-* themes; the editor-paired
  // palettes remap them to muted values (task 381 — see D2Style). In mono there are no fixed colours,
  // so fall back to the original subtle look (transparent body, currentColor border, faint header
  // tint, currentColor text).
  const { border, hh } = drawTablePanelHeader(s, left, top, w, h, sty, out)
  const nameC = sty.mono ? 'currentColor' : sty.accent
  const typeC = sty.mono ? 'currentColor' : sty.textMuted
  const consC = sty.mono ? 'currentColor' : sty.accent2
  const dim = sty.mono ? ' opacity="0.7"' : '' // mono dims type/constraint; themed uses full tokens
  ;(s.columns || []).forEach((c, i) => {
    const ry = top + hh + i * ROW_H
    out.push(
      `<line x1="${left.toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(left + w).toFixed(1)}" y2="${ry.toFixed(1)}" stroke="${border}" stroke-width="1"${sty.mono ? ' stroke-opacity="0.3"' : ''}/>`,
    )
    const ty = ry + ROW_H / 2
    out.push(
      `<text x="${(left + CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${nameC}">${esc2(c.name)}</text>`,
    )
    if (c.type)
      out.push(
        `<text x="${(left + CELL_PAD * 2 + cols[0]).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${typeC}"${dim}>${esc2(c.type)}</text>`,
      )
    if (c.constraint)
      out.push(
        `<text x="${(left + w - CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="end" dominant-baseline="central" font-size="${EDGE_FONT_SIZE}" fill="${consC}"${dim}>${esc2(abbr(c.constraint))}</text>`,
      )
  })
  return out.join('\n')
}

function abbr(c: string): string {
  return c
    .split(',')
    .map((x) =>
      x === 'primary_key'
        ? 'PK'
        : x === 'foreign_key'
          ? 'FK'
          : x === 'unique'
            ? 'UNQ'
            : x,
    )
    .join(' ')
}

export function drawClass(
  s: D2Shape,
  left: number,
  top: number,
  w: number,
  h: number,
  sty: D2Style,
): string {
  const out: string[] = []
  // Faithful d2 class colouring: NEUTRAL body (N7 fill, N1 border), SOLID N1 header with N7 title,
  // and members coloured per token — visibility marker=B2, name=N1, type=AA2 (via tspans). Chrome goes
  // through the same three tokens drawSqlTable uses (task 381). Mono falls back to the original subtle
  // monochrome look.
  const { border, hh } = drawTablePanelHeader(s, left, top, w, h, sty, out)
  const visC = sty.mono ? 'currentColor' : sty.accent // B2
  const nameC = sty.mono ? 'currentColor' : sty.text // N1
  const typeC = sty.mono ? 'currentColor' : sty.accent2 // AA2
  let i = 0
  const row = (
    visibility: string | undefined,
    name: string,
    type: string | undefined,
    sep: string,
  ) => {
    const ty = top + hh + i * ROW_H + ROW_H / 2
    let spans = `<tspan fill="${visC}">${esc2(vis(visibility))}</tspan> <tspan fill="${nameC}">${esc2(name)}</tspan>`
    if (type)
      spans += `<tspan fill="${nameC}">${esc2(sep)}</tspan><tspan fill="${typeC}">${esc2(type)}</tspan>`
    out.push(
      `<text x="${(left + CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${nameC}">${spans}</text>`,
    )
    i++
  }
  for (const f of s.fields || []) row(f.visibility, f.name, f.type, ': ')
  if ((s.methods?.length || 0) > 0) {
    const sy = top + hh + i * ROW_H
    out.push(
      `<line x1="${left.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(left + w).toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${border}" stroke-width="1"${sty.mono ? ' stroke-opacity="0.3"' : ''}/>`,
    )
  }
  for (const m of s.methods || []) row(m.visibility, m.name, m.type, ' ')
  return out.join('\n')
}

// Re-export so the ELK layout (elk-layout.ts) can render through the same path.

// ---- Leaf-shape drawing (task 474 — the foreground pass's ~20-case shape switch, extracted from
// toSVG so the renderer orchestration stays small). Each drawer emits its shape's SVG into `parts`
// and, for shapes whose D2 inner box is offset (cylinder caps, queue caps, callout tail, package
// tab, document wave), adjusts ctx.lx/ctx.ly — the label position the caller then emits. A drawer
// that draws its OWN label (person / image / md text / prose text / code) sets ctx.labelDone so the
// caller skips the shared label emit. All geometry below is a faithful port of d2 v0.7.1 lib/shape
// (paths derived from the real `d2` binary's SVG output) — moved VERBATIM from toSVG. ----
export interface LeafCtx {
  s: D2Shape
  left: number
  top: number
  w: number
  h: number
  cx: number
  cy: number
  R: number
  B: number
  f1: (v: number) => string
  p: Paint
  seed: number
  seed2: number
  sketch?: Sketch
  sty: D2Style
  parts: string[]
  lx: number
  ly: number
  labelDone: boolean
}

const f1 = (v: number) => v.toFixed(1)

// Bare-shape → explicit-box rule shared by the |md| text shape and shape:text/code: a bare shape is
// borderless, but an explicit fill/stroke/borderRadius means the user asked for a box.
function explicitStyleBox(
  s: D2Shape,
  left: number,
  top: number,
  w: number,
  h: number,
  rx: number,
): string | null {
  return s.fill || s.stroke || s.borderRadius
    ? `<rect x="${f1(left)}" y="${f1(top)}" width="${f1(w)}" height="${f1(h)}" rx="${rx}" fill="${s.fill || 'transparent'}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth || 1}"` : ''}${s.opacity && Number(s.opacity) !== 1 ? ` opacity="${s.opacity}"` : ''}/>`
    : null
}

// --- person ---
const person = (ctx: LeafCtx) => {
  const { s, left, top, w, h, cx, f1, p, seed, sketch, sty, parts } = ctx
  // person: head+shoulders silhouette as ONE outline, label rendered BELOW the figure (d2
  // shape_person renders the label outside, under the figure). dimsToFit reserves a label band.
  const band = FONT_SIZE + 8
  const sd = Math.min(w, h - band) // square figure side, centred in the box top
  const fx = cx - sd / 2
  const X = (t: number) => f1(fx + t * sd)
  const Y = (t: number) => f1(top + t * sd)
  const personD = `M${X(1)},${Y(1)} H${X(0)} V${Y(0.99)} C${X(0)},${Y(0.82)} ${X(0.108)},${Y(0.67)} ${X(0.283)},${Y(0.59)} C${X(0.183)},${Y(0.53)} ${X(0.133)},${Y(0.43)} ${X(0.133)},${Y(0.33)} C${X(0.133)},${Y(0.15)} ${X(0.292)},${Y(0)} ${X(0.5)},${Y(0)} C${X(0.7)},${Y(0)} ${X(0.867)},${Y(0.15)} ${X(0.867)},${Y(0.33)} C${X(0.867)},${Y(0.44)} ${X(0.808)},${Y(0.53)} ${X(0.717)},${Y(0.59)} C${X(0.892)},${Y(0.66)} ${X(1)},${Y(0.82)} ${X(1)},${Y(0.99)} V${Y(1)} H${X(1)} Z`
  parts.push(
    sketch
      ? sketch.path(personD, p, seed)
      : `<path d="${personD}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
  // Task 134 — `label.near` overrides the bespoke below-figure position when set.
  const pla = labelAnchorFor(s.labelPosition, left, top, w, h)
  const plx = pla ? pla.x : cx
  const ply = pla ? pla.y : top + sd + band / 2
  const panchor = pla ? pla.anchor : 'middle'
  const pbaseline = pla ? pla.baseline : 'central'
  parts.push(
    `<text x="${f1(plx)}" y="${f1(ply)}" text-anchor="${panchor}"${pbaseline ? ` dominant-baseline="${pbaseline}"` : ''} ${textAttrs(s, FONT_SIZE, sty.leafFill, sty.text, !!sketch)}>${labelRows(transformLabel(s.label, s.textTransform), plx, ply, FONT_SIZE, anchorFlow(pla?.baseline, 'center'))}</text>`,
  )
  ctx.labelDone = true
}

// --- image ---
const image = (ctx: LeafCtx) => {
  const { s, left, top, w, h, f1, parts } = ctx
  // shape: image (task 124 #3) — the node IS the picture (s.icon = the URL); fills the box. CSP
  // gates the URL (data:/blob: always, https only with image.allowRemote). A tooltip/link, if
  // any, is added by the decorations post-pass.
  parts.push(
    `<image href="${esc2(s.icon)}" x="${f1(left)}" y="${f1(top)}" width="${f1(w)}" height="${f1(h)}" preserveAspectRatio="xMidYMid meet"/>`,
  )
  ctx.labelDone = true
}

// --- mdText ---
const mdText = (ctx: LeafCtx) => {
  const { s, left, top, w, h, f1, sty, parts } = ctx
  // |md| markdown text shape (task 154): embed the Lute-rendered HTML in a <foreignObject>
  // instead of flat <tspan>s, so headings/bold/lists/tables/links render formatted. HTML in
  // a foreignObject inherits page CSS → currentColor follows the content theme (theming
  // model #1, like KaTeX). The inner div gets the MEASURED content width + the same TEXT_PAD
  // leafInfo padded with, so on-screen wrapping matches the measure pass exactly. mdHtml is
  // trusted Lute output — do NOT esc2 it. Raster caveat (task 154 gate): canvas
  // rasterisation of foreignObject is unreliable; on-screen rendering only (no export path
  // exists today — revisit if one ships).
  const rx = s.borderRadius ? Number(s.borderRadius) : 4
  const box = explicitStyleBox(s, left, top, w, h, rx)
  if (box) parts.push(box)
  parts.push(
    // overflow=visible: chromium scissors foreignObject content by default, so a sub-pixel
    // measure/render drift would clip the last text line mid-height instead of spilling 1px.
    `<foreignObject x="${f1(left)}" y="${f1(top)}" width="${f1(w)}" height="${f1(h)}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" class="vmarkd-d2-md" style="width:${s.mdSize?.w ?? 0}px;padding:${TEXT_PAD}px;color:${s.fontColor || sty.text}">${s.mdHtml}</div></foreignObject>`,
  )
  ctx.labelDone = true
}

type Hljs = {
  getLanguage?: (language: string) => unknown
  highlight: (
    source: string,
    options: { language: string; ignoreIllegals?: boolean },
  ) => { value: string }
}

type CodeToken = { cls: string; text: string }

function highlightedHtml(
  source: string,
  language: string | undefined,
): string | null {
  const hljs = (globalThis as { hljs?: Hljs }).hljs
  if (!language || !hljs?.highlight) return null
  if (hljs.getLanguage && !hljs.getLanguage(language)) return null
  try {
    return hljs.highlight(source, { language, ignoreIllegals: true }).value
  } catch {
    return null
  }
}

function appendHighlightedText(
  rows: CodeToken[][],
  cls: string,
  text: string,
): void {
  for (const [i, line] of text.split('\n').entries()) {
    if (i > 0) rows.push([])
    if (line) rows[rows.length - 1].push({ cls, text: esc2(line) })
  }
}

function highlightedRows(html: string): CodeToken[][] {
  const rows: CodeToken[][] = [[]]
  const classes: string[] = []
  const token = /<span class="([^"]*)">|<\/span>|([^<]+)/g
  for (const m of html.matchAll(token)) {
    if (m[1] !== undefined) {
      classes.push(
        m[1]
          .split(/\s+/)
          .filter((name) => /^hljs-[a-z0-9_-]+$/i.test(name))
          .join(' '),
      )
    } else if (m[0] === '</span>') {
      classes.pop()
    } else {
      const text = m[2]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
      appendHighlightedText(rows, classes.filter(Boolean).join(' '), text)
    }
  }
  return rows
}

function hljsCodeTspans(
  source: string,
  language: string | undefined,
  x: string,
  top: number,
  fontSize: number,
): string | null {
  const html = highlightedHtml(source, language)
  if (!html) return null
  return highlightedRows(html)
    .map((row, i) => {
      const y = (top + CODE_PAD + fontSize + i * fontSize * PROSE_LH).toFixed(1)
      return row
        .map(({ cls, text }, j) => {
          const attrs = cls ? ` class="${cls}" fill="currentColor"` : ''
          const pos = j === 0 ? ` x="${x}" y="${y}"` : ''
          return `<tspan${pos}${attrs}>${text}</tspan>`
        })
        .join('')
    })
    .join('')
}

function drawTextCodeChrome(ctx: LeafCtx, isCode: boolean, rx: number): void {
  const { s, left, top, w, h, f1, sty, parts } = ctx
  if (isCode) {
    parts.push(
      `<rect x="${f1(left)}" y="${f1(top)}" width="${f1(w)}" height="${f1(h)}" rx="${rx}" fill="${s.fill || sty.paper}" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 1}"${s.opacity && Number(s.opacity) !== 1 ? ` opacity="${s.opacity}"` : ''}/>`,
    )
    return
  }
  const box = explicitStyleBox(s, left, top, w, h, rx)
  if (box) parts.push(box)
}

// --- textCode ---
const textCode = (ctx: LeafCtx) => {
  const { s, left, top, f1, sty, parts } = ctx
  // shape: text / code (task 124 #2 — no WASM; shape + label already marshalled). text = borderless
  // left-aligned prose; code = monospace in a subtle panel. Multi-line labels become <tspan> rows
  // (SVG <text> doesn't wrap on \n). Geometry mirrors leafInfo's textShapeBox. Code language reaches
  // highlight.js through D2Shape.language; absent/unavailable highlighting keeps this plain path.
  const rx = s.borderRadius ? Number(s.borderRadius) : 4
  const isCode = s.shape === 'code'
  const fs = isCode ? CODE_FONT : FONT_SIZE
  const pad = isCode ? CODE_PAD : TEXT_PAD
  // d2 paints code on N7 paper; text gets a box only for explicit source styling.
  drawTextCodeChrome(ctx, isCode, rx)
  const fam = isCode
    ? ' font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"'
    : ''
  const tx = f1(left + pad)
  const tspans =
    (isCode && hljsCodeTspans(s.label, s.language, tx, top, fs)) ||
    String(s.label)
      .split('\n')
      .map(
        (ln, i) =>
          `<tspan x="${tx}" y="${f1(top + pad + fs + i * fs * PROSE_LH)}">${esc2(ln)}</tspan>`,
      )
      .join('')
  parts.push(
    `<text font-size="${fs}"${fam} fill="${s.fontColor || sty.text}">${tspans}</text>`,
  )
  ctx.labelDone = true
}

// --- circle ---
const circle = (ctx: LeafCtx) => {
  const { s, w, h, cx, cy, p, seed, sketch, sty, parts } = ctx
  parts.push(
    sketch
      ? sketch.ellipse(cx, cy, w / 2, h / 2, p, seed)
      : `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
}

// --- diamond ---
const diamond = (ctx: LeafCtx) => {
  const { s, left, top, w, h, cx, cy, p, seed, sketch, sty, parts } = ctx
  parts.push(
    sketch
      ? sketch.polygon(
          [
            [cx, top],
            [left + w, cy],
            [cx, top + h],
            [left, cy],
          ],
          p,
          seed,
        )
      : `<polygon points="${cx},${top.toFixed(1)} ${(left + w).toFixed(1)},${cy} ${cx},${(top + h).toFixed(1)} ${left.toFixed(1)},${cy}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
}

// --- hexagon ---
const hexagon = (ctx: LeafCtx) => {
  const { s, left, top, w, h, cy, p, seed, sketch, sty, parts } = ctx
  const i = w * 0.25 // d2 hexagon inset = w/4
  parts.push(
    sketch
      ? sketch.polygon(
          [
            [left + i, top],
            [left + w - i, top],
            [left + w, cy],
            [left + w - i, top + h],
            [left + i, top + h],
            [left, cy],
          ],
          p,
          seed,
        )
      : `<polygon points="${(left + i).toFixed(1)},${top.toFixed(1)} ${(left + w - i).toFixed(1)},${top.toFixed(1)} ${(left + w).toFixed(1)},${cy} ${(left + w - i).toFixed(1)},${(top + h).toFixed(1)} ${(left + i).toFixed(1)},${(top + h).toFixed(1)} ${left.toFixed(1)},${cy}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
}

// --- cylinder ---
const cylinder = (ctx: LeafCtx) => {
  const {
    s,
    left,
    top,
    w,
    h,
    cx,
    R,
    B,
    f1,
    p,
    seed,
    seed2,
    sketch,
    sty,
    parts,
  } = ctx
  // d2 shape_cylinder: vertical sides + bezier ellipse caps; constant cap depth (arc=24,
  // defaultArcDepth). Front lip of the top cap drawn on top. Label sits below the top cap.
  const c = Math.min(24, h * 0.32)
  const x45 = f1(left + w * 0.45)
  const x55 = f1(left + w * 0.55)
  const cylBody = `M${f1(left)},${f1(top + c)} C${f1(left)},${f1(top)} ${x45},${f1(top)} ${f1(cx)},${f1(top)} C${x55},${f1(top)} ${f1(R)},${f1(top)} ${f1(R)},${f1(top + c)} V${f1(B - c)} C${f1(R)},${f1(B)} ${x55},${f1(B)} ${f1(cx)},${f1(B)} C${x45},${f1(B)} ${f1(left)},${f1(B)} ${f1(left)},${f1(B - c)} Z`
  const cylLip = `M${f1(left)},${f1(top + c)} C${f1(left)},${f1(top + 2 * c)} ${x45},${f1(top + 2 * c)} ${f1(cx)},${f1(top + 2 * c)} C${x55},${f1(top + 2 * c)} ${f1(R)},${f1(top + 2 * c)} ${f1(R)},${f1(top + c)}`
  parts.push(
    sketch
      ? sketch.path(cylBody, p, seed)
      : `<path d="${cylBody}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
  parts.push(
    sketch
      ? sketch.path(
          cylLip,
          { fill: 'none', stroke: p.stroke, strokeWidth: p.strokeWidth },
          seed2,
        )
      : `<path d="${cylLip}" fill="none" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 2}"/>`,
  )
  ctx.ly = top + 2 * c + (h - 3 * c) / 2 // d2 inner box: top += 2*arc, height -= 3*arc
}

// --- queue ---
const queue = (ctx: LeafCtx) => {
  const {
    s,
    left,
    top,
    w,
    h,
    cy,
    R,
    B,
    f1,
    p,
    seed,
    seed2,
    sketch,
    sty,
    parts,
  } = ctx
  // d2 shape_queue: a horizontal cylinder — 1 arc left, 2 arcs right (arc=24). Label sits
  // in the inner box (x += arc, width -= 3*arc → centre shifts left by arc/2).
  const c = Math.min(24, w * 0.32)
  const y45 = f1(top + h * 0.45)
  const y55 = f1(top + h * 0.55)
  const Lc = f1(left + c)
  const Rc = f1(left + w - c)
  const R2c = f1(left + w - 2 * c)
  const queueBody = `M${Lc},${f1(top)} H${Rc} C${f1(R)},${f1(top)} ${f1(R)},${y45} ${f1(R)},${f1(cy)} C${f1(R)},${y55} ${f1(R)},${f1(B)} ${Rc},${f1(B)} H${Lc} C${f1(left)},${f1(B)} ${f1(left)},${y55} ${f1(left)},${f1(cy)} C${f1(left)},${y45} ${f1(left)},${f1(top)} ${Lc},${f1(top)} Z`
  const queueArc = `M${Rc},${f1(top)} C${R2c},${f1(top)} ${R2c},${y45} ${R2c},${f1(cy)} C${R2c},${y55} ${R2c},${f1(B)} ${Rc},${f1(B)}`
  parts.push(
    sketch
      ? sketch.path(queueBody, p, seed)
      : `<path d="${queueBody}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
  parts.push(
    sketch
      ? sketch.path(
          queueArc,
          { fill: 'none', stroke: p.stroke, strokeWidth: p.strokeWidth },
          seed2,
        )
      : `<path d="${queueArc}" fill="none" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 2}"/>`,
  )
  ctx.lx = left + c + (w - 3 * c) / 2
}

// --- cloud ---
const cloud = (ctx: LeafCtx) => {
  const { s, left, top, w, h, p, seed, sketch, sty, parts } = ctx
  // Bumpy top from three arcs + flat bottom — reads as a cloud at diagram scale.
  const x = left
  const y = top
  const cloudD = `M${(x + w * 0.26).toFixed(1)},${(y + h * 0.88).toFixed(1)} A${(w * 0.16).toFixed(1)},${(h * 0.24).toFixed(1)} 0 0 1 ${(x + w * 0.22).toFixed(1)},${(y + h * 0.46).toFixed(1)} A${(w * 0.18).toFixed(1)},${(h * 0.34).toFixed(1)} 0 0 1 ${(x + w * 0.5).toFixed(1)},${(y + h * 0.3).toFixed(1)} A${(w * 0.18).toFixed(1)},${(h * 0.32).toFixed(1)} 0 0 1 ${(x + w * 0.78).toFixed(1)},${(y + h * 0.46).toFixed(1)} A${(w * 0.16).toFixed(1)},${(h * 0.24).toFixed(1)} 0 0 1 ${(x + w * 0.74).toFixed(1)},${(y + h * 0.88).toFixed(1)} Z`
  parts.push(
    sketch
      ? sketch.path(cloudD, p, seed)
      : `<path d="${cloudD}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
}

// --- parallelogram ---
const parallelogram = (ctx: LeafCtx) => {
  const { s, left, top, w, R, B, f1, p, seed, sketch, sty, parts } = ctx
  // d2 shape_parallelogram: slanted box, slant = 26px constant.
  const sl = Math.min(26, w * 0.33)
  parts.push(
    sketch
      ? sketch.polygon(
          [
            [left + sl, top],
            [R, top],
            [R - sl, B],
            [left, B],
          ],
          p,
          seed,
        )
      : `<polygon points="${f1(left + sl)},${f1(top)} ${f1(R)},${f1(top)} ${f1(R - sl)},${f1(B)} ${f1(left)},${f1(B)}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
}

// --- document ---
const document = (ctx: LeafCtx) => {
  const { s, left, top, w, h, cx, R, f1, p, seed, sketch, sty, parts } = ctx
  // d2 shape_document: rectangle with a single wavy dip along the bottom (overflows ~5%).
  const yb = f1(top + h * 0.86)
  const documentD = `M${f1(left)},${yb} L${f1(left)},${f1(top)} L${f1(R)},${f1(top)} L${f1(R)},${yb} C${f1(left + w * 0.833)},${f1(top + h * 0.68)} ${f1(left + w * 0.667)},${f1(top + h * 0.68)} ${f1(cx)},${yb} C${f1(left + w * 0.333)},${f1(top + h * 1.05)} ${f1(left + w * 0.167)},${f1(top + h * 1.05)} ${f1(left)},${yb} Z`
  parts.push(
    sketch
      ? sketch.path(documentD, p, seed)
      : `<path d="${documentD}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
  ctx.ly = top + h * 0.37 // label centred in the inner box (top 74%)
}

// --- page ---
const page = (ctx: LeafCtx) => {
  const { s, left, top, w, h, R, B, f1, p, seed, seed2, sketch, sty, parts } =
    ctx
  // d2 shape_page: rectangle with a folded top-right corner (fold ~20px).
  const fold = Math.min(20, w * 0.33, h * 0.33)
  const xf = f1(R - fold)
  const yf = f1(top + fold)
  const pageBody = `M${f1(left)},${f1(top)} H${xf} L${f1(R)},${yf} V${f1(B)} H${f1(left)} Z`
  const pageFold = `M${xf},${f1(top)} V${yf} H${f1(R)}`
  parts.push(
    sketch
      ? sketch.path(pageBody, p, seed)
      : `<path d="${pageBody}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
  parts.push(
    sketch
      ? sketch.path(
          pageFold,
          { fill: 'none', stroke: p.stroke, strokeWidth: p.strokeWidth },
          seed2,
        )
      : `<path d="${pageFold}" fill="none" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 2}"/>`,
  )
}

// --- storedData ---
const storedData = (ctx: LeafCtx) => {
  const { s, left, top, w, h, cy, R, B, f1, p, seed, sketch, sty, parts } = ctx
  // d2 shape_stored_data: cylinder on its side — both vertical edges bow right (wedge=15).
  const wd = Math.min(15, w * 0.3)
  const storedDataD = `M${f1(left + wd)},${f1(top)} H${f1(R)} C${f1(R - 4)},${f1(top)} ${f1(R - wd)},${f1(top + h * 0.27)} ${f1(R - wd)},${f1(cy)} C${f1(R - wd)},${f1(top + h * 0.73)} ${f1(R - 4)},${f1(B)} ${f1(R)},${f1(B)} H${f1(left + wd)} C${f1(left + 4)},${f1(B)} ${f1(left)},${f1(top + h * 0.73)} ${f1(left)},${f1(cy)} C${f1(left)},${f1(top + h * 0.27)} ${f1(left + 4)},${f1(top)} ${f1(left + wd)},${f1(top)} Z`
  parts.push(
    sketch
      ? sketch.path(storedDataD, p, seed)
      : `<path d="${storedDataD}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
}

// --- package ---
const packageShape = (ctx: LeafCtx) => {
  const { s, left, top, w, h, R, B, f1, p, seed, sketch, sty, parts } = ctx
  // d2 shape_package: rectangle with a smaller tab on the top-left.
  const tw = w * 0.5
  const th = Math.min(Math.max(h * 0.2, 20), 55)
  const packageD = `M${f1(left)},${f1(top)} L${f1(left + tw)},${f1(top)} L${f1(left + tw)},${f1(top + th)} L${f1(R)},${f1(top + th)} L${f1(R)},${f1(B)} L${f1(left)},${f1(B)} Z`
  parts.push(
    sketch
      ? sketch.path(packageD, p, seed)
      : `<path d="${packageD}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
  ctx.ly = top + th + (h - th) / 2 // label below the tab
}

// --- step ---
const step = (ctx: LeafCtx) => {
  const { s, left, top, w, cy, R, B, f1, p, seed, sketch, sty, parts } = ctx
  // d2 shape_step: chevron/arrow block (wedge=35 on both sides).
  const wd = Math.min(35, w * 0.4)
  parts.push(
    sketch
      ? sketch.polygon(
          [
            [left, top],
            [R - wd, top],
            [R, cy],
            [R - wd, B],
            [left, B],
            [left + wd, cy],
          ],
          p,
          seed,
        )
      : `<polygon points="${f1(left)},${f1(top)} ${f1(R - wd)},${f1(top)} ${f1(R)},${f1(cy)} ${f1(R - wd)},${f1(B)} ${f1(left)},${f1(B)} ${f1(left + wd)},${f1(cy)}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
}

// --- callout ---
const callout = (ctx: LeafCtx) => {
  const { s, left, top, w, h, cx, R, B, f1, p, seed, sketch, sty, parts } = ctx
  // d2 shape_callout: speech bubble — body rectangle with a downward tail at bottom-centre.
  const tipW = Math.min(30, w * 0.3)
  const tipH = Math.min(45, h * 0.4)
  const yb = f1(B - tipH)
  const calloutD = `M${f1(left)},${f1(top)} V${yb} H${f1(cx)} V${f1(B)} L${f1(cx + tipW)},${yb} H${f1(R)} V${f1(top)} Z`
  parts.push(
    sketch
      ? sketch.path(calloutD, p, seed)
      : `<path d="${calloutD}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
  ctx.ly = top + (h - tipH) / 2 // label in the body, above the tail
}

// --- rectangle ---
const rectangle = (ctx: LeafCtx) => {
  const { s, left, top, w, h, p, seed, sketch, sty, parts } = ctx
  const rx = s.borderRadius ? Number(s.borderRadius) : 4
  parts.push(
    sketch
      ? sketch.rect(left, top, w, h, p, seed)
      : `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
  )
}

// Dispatch: an unknown/rectangle shape draws the plain box (d2's default). Drawers that emit their
// own label set ctx.labelDone; every other drawer leaves it false and the caller draws the label.
// The `text` shape has two drawers: the enriched |md| foreignObject (task 154) when Lute attached
// mdHtml/mdSize, else plain borderless prose — and `code` is the monospace panel variant of the same.
const SHAPE_DRAWERS: Record<string, (ctx: LeafCtx) => void> = {
  person,
  image,
  circle,
  oval: circle,
  diamond,
  hexagon,
  cylinder,
  queue,
  cloud,
  parallelogram,
  document,
  page,
  stored_data: storedData,
  package: packageShape,
  step,
  callout,
  rectangle,
}

export function drawLeafShape(ctx: LeafCtx): void {
  const s = ctx.s.shape
  if (s === 'text') {
    if (ctx.s.mdHtml && ctx.s.mdSize) mdText(ctx)
    else textCode(ctx)
    return
  }
  if (s === 'code') {
    textCode(ctx)
    return
  }
  const draw = SHAPE_DRAWERS[s] ?? rectangle
  draw(ctx)
}
