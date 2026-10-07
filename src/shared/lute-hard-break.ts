// Task 530 — a hard line break keeps its source form end to end. Lute does the work: the vendored blob
// is patched at build time (scripts/lute-blob-patch.mjs) so the parser, both editor renderers, the DOM
// walkers and the serializer carry the form as `<br data-marker>`. What is left here: the default form
// for a NEW break (vmarkd.editor.hardBreakStyle, used by editing/hard-break-key.ts), and
// `keepLinePlaceholder` on the spin OUTPUT — after Shift+Enter at a block end the DOM is
// `<br data-marker><wbr><br>` (break, caret, the browser's line placeholder); Lute's spin drops the
// placeholder, and without it the next typed character lands BEFORE the break.
//
// Pure string transforms, no DOM — safe for the extension host to import too.
import { ZWSP } from './lute-block-repair'

// The form a NEW hard break is written in. Module state, like the other `apply…Setting` hooks: set at
// init and on every live config change.
let defaultForm = '\\'

export function applyHardBreakStyle(style: string | undefined): void {
  defaultForm = style === 'spaces' ? '  ' : '\\'
}

/** The current default hard-break form: `\` or two spaces. */
export function getHardBreakForm(): string {
  return defaultForm
}

const PENDING_BREAK_RE = /<br data-marker="(?:[ \t]+|\\)" ?\/?><wbr>/g
const BLOCK_CLOSE_RE = /<\/(?:p|li|h[1-6]|td|th|blockquote|div)>/
const NOT_BLANK_RE = new RegExp(`[^\\s${ZWSP}]`)
// Only these are an EMPTY tail: closing tags, breaks / the caret marker, whitespace and ZWSP. An opening
// tag (an image, an svg, a checkbox…) is content, so no placeholder goes after it.
const EMPTY_TAIL_RE = /<\/[^>]*>|<br\b[^>]*>|<wbr>/gi

/**
 * Re-add the browser's `<br>` line placeholder at the end of the block that holds a pending break
 * (a marked `<br>` + caret with nothing but closing tags, `<br>`/`<wbr>` and whitespace/ZWSP after it
 * in the block). Idempotent: a block that already ends in a placeholder is left alone.
 */
export function keepLinePlaceholder(html: string): string {
  if (!html.includes('<wbr>')) return html
  let out = ''
  let cursor = 0
  for (const m of html.matchAll(PENDING_BREAK_RE)) {
    const from = m.index + m[0].length
    const rest = html.slice(from)
    const close = rest.search(BLOCK_CLOSE_RE)
    if (close === -1 || from < cursor) continue
    const tail = rest.slice(0, close)
    if (NOT_BLANK_RE.test(tail.replace(EMPTY_TAIL_RE, ''))) continue // content follows
    if (/<br\b/i.test(tail)) continue // a placeholder is already there
    out += `${html.slice(cursor, from + close)}<br>`
    cursor = from + close
  }
  return cursor === 0 ? html : out + html.slice(cursor)
}

interface LuteLike {
  SpinVditorDOM?(html: string): string
  SpinVditorIRDOM?(html: string): string
  __vmarkdHardBreak?: boolean
}

/** Wrap the two spin entry points so their output keeps the pending-break line placeholder. */
export function patchLuteHardBreaks(lute: LuteLike | undefined): void {
  if (!lute || lute.__vmarkdHardBreak) return
  lute.__vmarkdHardBreak = true
  for (const name of ['SpinVditorDOM', 'SpinVditorIRDOM'] as const) {
    const inner = lute[name]?.bind(lute)
    if (inner) lute[name] = (html: string) => keepLinePlaceholder(inner(html))
  }
}
