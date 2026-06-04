// Minimal-diff write-back (task 61).
//
// When the visual editor saves, the webview sends the full reserialized markdown
// (`vditor.getValue()`). Vditor's serialization reflows constructs the user never
// touched — table column padding, blank-line normalization, `>`-prefix spacing, … —
// so a single edit rewrites the whole file and produces a noisy git diff.
//
// This rebuilds the text to write so that every block the user did NOT actually change
// keeps its ORIGINAL bytes; only genuinely-changed blocks take Vditor's reserialized
// form. A block counts as "unchanged" iff it RESERIALIZES to the corresponding new
// block (`reserialize(originalBlock) === newBlock`): the two mean the same thing, only
// the surface bytes differ, so swapping in the original bytes is a semantic no-op and
// always safe. Any block that doesn't match — a real edit, or a context-sensitive
// block (list item, ref-using paragraph) whose isolated reserialization legitimately
// differs — falls back to the editor's output. Matching is greedy and in-order with
// consumption, so repeated identical blocks pair left-to-right.
//
// Cost note: `reserialize` is a Lute round-trip; callers should memoize it per source
// block (the original blocks don't change between edits) and gate by document size.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/

// Split markdown into blocks on blank lines, keeping fenced code blocks (``` / ~~~)
// intact even when they contain blank lines. Separators (blank-line runs) are dropped;
// callers rejoin with a single blank line. Returns [] for whitespace-only input.
export function splitBlocks(md: string): string[] {
  const lines = md.split('\n')
  const blocks: string[] = []
  let cur: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (cur.length) blocks.push(cur.join('\n'))
    cur = []
  }
  for (const line of lines) {
    const m = line.match(FENCE)
    if (fence) {
      cur.push(line)
      // close on a fence of the same kind (>= length is fine for our purposes)
      if (m && line.trim().startsWith(fence[0])) fence = null
      continue
    }
    if (m) {
      // opening fence — enter fenced state; the block continues until it closes
      fence = m[1][0]
      cur.push(line)
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    cur.push(line)
  }
  flush()
  return blocks
}

// Build the text to write: original bytes for unchanged blocks, editor output for the
// rest. `reserialize(b)` returns the markdown `b` serializes to, or undefined if it
// can't (Lute not warm) — undefined disables matching for that block (safe: falls back
// to the new block).
export function minimalDiffWriteback(
  original: string,
  next: string,
  reserialize: (block: string) => string | undefined,
): string {
  const ob = splitBlocks(original)
  const nb = splitBlocks(next)
  if (!ob.length || !nb.length) return next

  // Reserialized form of each original block (trailing newlines trimmed for compare).
  const trim = (s: string) => s.replace(/\n+$/, '')
  const serOb = ob.map((b) => {
    const r = reserialize(b)
    return r === undefined ? undefined : trim(r)
  })

  const used = new Array(ob.length).fill(false)
  const out: string[] = []
  let from = 0
  for (const blk of nb) {
    const key = trim(blk)
    let found = -1
    for (let k = from; k < ob.length; k++) {
      if (!used[k] && serOb[k] !== undefined && serOb[k] === key) {
        found = k
        break
      }
    }
    if (found >= 0) {
      out.push(ob[found])
      used[found] = true
      from = found + 1
    } else {
      out.push(blk)
    }
  }

  // Preserve the original's trailing-newline shape so the final line never churns.
  const trailing = (original.match(/\n*$/) || [''])[0]
  return out.join('\n\n').replace(/\n*$/, '') + trailing
}
