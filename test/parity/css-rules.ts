// Minimal CSS rule walker for the geometry lints (task 532 §E tests 2-3). Not a CSS parser: it
// understands comments, strings, `{}` nesting and at-rules whose body holds rules (@media, @supports,
// @layer, @container). Enough to answer "which selector declares which property, and is there a
// tag comment directly above it".

export interface CssRule {
  /** Selector text, comments removed, whitespace collapsed. */
  selector: string
  /** Declaration block text (nested rules excluded for leaf rules). */
  body: string
  /** Comments seen since the previous rule/at-rule ended (the rule's lead-in). */
  leadComment: string
  /** 1-based line of the selector's first character. */
  line: number
}

const AT_WITH_RULES = /^@(media|supports|layer|container)\b/

// Index just past the comment or string literal starting at `i`, or `i` when none starts there.
function skipOpaque(src: string, i: number): number {
  const c = src[i]
  if (c === '/' && src[i + 1] === '*') return src.indexOf('*/', i + 2) + 2
  if (c !== '"' && c !== "'") return i
  let j = i + 1
  while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
  return j + 1
}

// Index just past the `}` that closes the block opened at `open`; strings and comments are skipped.
function findBlockEnd(src: string, open: number): number {
  let depth = 1
  let i = open + 1
  while (i < src.length && depth > 0) {
    const next = skipOpaque(src, i)
    if (next !== i) {
      i = next
      continue
    }
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
    i++
  }
  return i
}

// Index of the next `{` at or after `from`, skipping comments and strings; -1 when none.
function findBlockStart(src: string, from: number): number {
  let i = from
  while (i < src.length) {
    const next = skipOpaque(src, i)
    if (next !== i) {
      i = next
      continue
    }
    if (src[i] === '{') return i
    i++
  }
  return -1
}

export function parseCssRules(css: string, lineBase = 1): CssRule[] {
  const out: CssRule[] = []
  let i = 0
  let lead = ''
  while (i < css.length) {
    if (/\s/.test(css[i])) {
      i++
      continue
    }
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      lead += `${css.slice(i + 2, end)}\n`
      i = end + 2
      continue
    }
    const open = findBlockStart(css, i)
    if (open < 0) break
    const end = findBlockEnd(css, open)
    const selector = stripComments(css.slice(i, open))
      .replace(/\s+/g, ' ')
      .trim()
    const body = css.slice(open + 1, end - 1)
    const line = lineBase + css.slice(0, i).split('\n').length - 1
    if (selector.startsWith('@')) {
      if (AT_WITH_RULES.test(selector))
        out.push(
          ...parseCssRules(
            body,
            lineBase + css.slice(0, open).split('\n').length - 1,
          ),
        )
    } else {
      out.push({ selector, body: stripComments(body), leadComment: lead, line })
    }
    lead = ''
    i = end
  }
  return out
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
}
