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
    } else if (
      // No whole-block match. If this is an edited table whose original sits in the
      // next unconsumed slot, recurse one level (task 60): keep the original bytes of
      // rows/cells that are semantically unchanged so a one-cell edit can't reflow the
      // spacing of cells the user never touched.
      from < ob.length &&
      !used[from] &&
      serOb[from] !== undefined &&
      isTableBlock(blk) &&
      isTableBlock(ob[from])
    ) {
      out.push(mergeTableBlock(ob[from], blk, reserialize))
      used[from] = true
      from += 1
    } else {
      out.push(blk)
    }
  }

  // Preserve the original's trailing-newline shape so the final line never churns.
  const trailing = (original.match(/\n*$/) || [''])[0]
  return out.join('\n\n').replace(/\n*$/, '') + trailing
}

// A GFM table block: a `|`-bearing header line followed by a delimiter line whose
// cells are only `-`, `:` and spaces (e.g. `| --- | :-: |`).
export function isTableBlock(block: string): boolean {
  const lines = block.split('\n')
  if (lines.length < 2) return false
  if (!lines[0].includes('|')) return false
  const delimCells = splitRow(lines[1])
  return (
    delimCells.length > 0 && delimCells.every((c) => /^:?-+:?$/.test(c.trim()))
  )
}

// Split one table row into trimmed cell texts. Strips the optional leading/trailing
// `|` and splits on unescaped `|`.
function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split(/(?<!\\)\|/).map((c) => c.trim())
}

// The alignment flags of a delimiter row (`:` left/right presence per column),
// used to decide whether the original delimiter row can be kept verbatim.
function alignKey(cells: string[]): string {
  return cells
    .map((c) => `${c.startsWith(':') ? 'l' : ''}${c.endsWith(':') ? 'r' : ''}`)
    .join(',')
}

// Merge an edited table against its original, preserving the ORIGINAL bytes of any
// row/cell that is semantically unchanged. Returns `next` unchanged when the tables
// don't line up (different row or column counts) — the safe fallback (= today's
// behavior). A cell is "unchanged" iff it reserializes (inside a table) to the same
// thing as the editor's cell, so swapping the original text back is a semantic no-op.
export function mergeTableBlock(
  original: string,
  next: string,
  reserialize: (block: string) => string | undefined,
): string {
  const oLines = original.split('\n')
  const nLines = next.split('\n')
  if (oLines.length !== nLines.length) return next

  // Reserialize a single cell inside a 1-column table so the comparison sees the same
  // trim Lute applies in real table context. Memoized per call.
  const cellCache = new Map<string, string | undefined>()
  const cellRT = (text: string): string | undefined => {
    if (cellCache.has(text)) return cellCache.get(text)
    const r = reserialize(`| ${text.replace(/\|/g, '\\|')} |\n| - |`)
    const v = r === undefined ? undefined : splitRow(r.split('\n')[0])[0]
    cellCache.set(text, v)
    return v
  }
  // Two cells are equivalent if identical, or if they reserialize identically (so the
  // only difference is reflow the editor would apply anyway, e.g. the task-60 trim).
  const cellEq = (a: string, b: string): boolean => {
    if (a === b) return true
    const ra = cellRT(a)
    const rb = cellRT(b)
    return ra !== undefined && ra === rb
  }

  const mergedLines: string[] = []
  for (let r = 0; r < oLines.length; r++) {
    const oRaw = oLines[r]
    const nRaw = nLines[r]
    if (oRaw === nRaw) {
      mergedLines.push(oRaw)
      continue
    }
    const oCells = splitRow(oRaw)
    const nCells = splitRow(nRaw)
    if (oCells.length !== nCells.length) return next

    // Delimiter row (always row index 1): structural — keep the original bytes when
    // the alignment is unchanged, else take the editor's.
    if (r === 1) {
      mergedLines.push(alignKey(oCells) === alignKey(nCells) ? oRaw : nRaw)
      continue
    }

    let allKept = true
    const cells = nCells.map((nCell, c) => {
      if (cellEq(oCells[c], nCell)) return oCells[c]
      allKept = false
      return nCell
    })
    // Whole row semantically unchanged → keep the original line verbatim (preserves
    // its exact padding + spaces, zero churn). Otherwise rebuild the edited row with
    // single-space padding, but with each unchanged cell's ORIGINAL text restored.
    mergedLines.push(allKept ? oRaw : `| ${cells.join(' | ')} |`)
  }
  return mergedLines.join('\n')
}
