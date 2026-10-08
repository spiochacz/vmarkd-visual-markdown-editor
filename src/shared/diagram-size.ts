// Task 532 step 5c — remember how tall a diagram rendered, so the instant-paint overlay can reserve
// that space instead of showing the raw source in a code-sized box (a 257px jump at the swap).
//
// A cached SVG is keyed by a hash that folds in the theme and engine settings (render-cache-client
// hashOf) — the host cannot recompute it at HTML-build time, and the size of a diagram does not
// depend on them anyway. So the size is filed under its OWN theme-independent key, `lang + trimmed
// source` (the same trim `nativeSourceForLive` uses, task 480), which BOTH sides can compute: the
// webview when it reports a finished render, the host from the fence text in Lute's overlay HTML.
//
// A size is `[w, h, pad]` in CSS px: the rendered SVG's width and height, and the extra height the
// wrapper adds around it (line box, margins). The overlay scales `h` when its column is narrower
// than `w` (the svg is shrink-only) and adds `pad`; see media-src/src/editing/diagram-placeholder.ts.
//
// Pure string work, no DOM: the extension host imports it.

import { unescapeHtmlEntities } from './wiki-core'

export type DiagramSize = readonly [w: number, h: number, pad: number]

/** The attribute `annotateDiagramSizes` puts on a diagram's `pre.vditor-*__preview`: `"w,h,pad"`. */
export const DIAGRAM_SIZE_ATTR = 'data-vmarkd-dsize'

/** One 32-bit FNV-1a lane. */
function fnv1aLane(key: string, offsetBasis: number): number {
  let h = offsetBasis
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    // FNV prime multiply via shifts, kept in 32-bit unsigned range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h
}

/** 64 bits as 16 hex chars: two FNV-1a lanes with distinct seeds (correlated, not independent). */
export function fnv64Hex(key: string): string {
  const lo = fnv1aLane(key, 0x811c9dc5) // the standard FNV-1a 32-bit offset basis
  const hi = fnv1aLane(key, 0x1000193 ^ 0xffffffff)
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0')
}

/** The theme-independent key a diagram's size is filed under (NUL-joined like hashOf). */
export function diagramSizeKey(lang: string, source: string): string {
  return fnv64Hex(`${lang}\x00${source.replace(/\r\n/g, '\n').trim()}`)
}

/** Shape of a `diagramSizeKey`: the host stores a webview-supplied key, so it must look like one. */
export const isDiagramSizeKey = (k: unknown): k is string =>
  typeof k === 'string' && /^[0-9a-f]{16}$/.test(k)

const finitePositive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 100_000

/** A measured size worth keeping: finite, positive width and height, non-negative pad. */
export function isDiagramSize(v: unknown): v is DiagramSize {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    finitePositive(v[0]) &&
    finitePositive(v[1]) &&
    typeof v[2] === 'number' &&
    Number.isFinite(v[2]) &&
    v[2] >= 0 &&
    v[2] < 100_000
  )
}

export function parseDiagramSizeAttr(
  value: string | null | undefined,
): DiagramSize | undefined {
  if (!value) return undefined
  const parts = value.split(',').map(Number)
  return isDiagramSize(parts) ? (parts as unknown as DiagramSize) : undefined
}

// A rendered fence preview in Lute's IR / WYSIWYG overlay HTML: `<pre class="vditor-ir__preview"
// data-render="2"><div|code class="language-X">ESCAPED SOURCE</div|code></pre>`. Ordinary code
// fences match too — they simply have no size on file.
const PREVIEW =
  /(<pre class="vditor-(?:ir|wysiwyg)__preview" data-render="2")(><(div|code) class="language-([\w-]+)">)([\s\S]*?)(<\/\3><\/pre>)/g

/** Tag every diagram preview we know a size for with `data-vmarkd-dsize="w,h,pad"`. */
export function annotateDiagramSizes(
  html: string,
  lookup: (key: string) => DiagramSize | undefined,
): string {
  return html.replace(PREVIEW, (...m: string[]) => {
    const [whole, open, , , lang, body] = m
    const size = lookup(diagramSizeKey(lang, unescapeHtmlEntities(body)))
    return size
      ? `${open} ${DIAGRAM_SIZE_ATTR}="${size.join(',')}"${whole.slice(open.length)}`
      : whole
  })
}
