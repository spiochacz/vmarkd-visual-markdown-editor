// Pure line-level diff for git gutters (task 17).
//
// We deliberately avoid the `diff` npm package: the host ships as plain `tsc`
// output with `node_modules` excluded by .vscodeignore, so a runtime dep would
// not be packaged. This is a self-contained LCS diff with common prefix/suffix
// trimming (a typical edit touches a few lines, so the LCS runs only on the small
// changed middle) and a safety cap for pathological cases.

export interface DiffChange {
  startLine: number
  endLine: number
  type: 'added' | 'removed' | 'modified'
}

interface Hunk {
  type: 'common' | 'added' | 'removed'
  count: number
}

// Cap the LCS table size; beyond this the middle is treated as a coarse
// remove+add block rather than risk O(n*m) memory on a huge divergent region.
const MAX_LCS_CELLS = 4_000_000

function lcsHunks(a: string[], b: string[]): Hunk[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Hunk['type'][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push('common')
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push('removed')
      i++
    } else {
      ops.push('added')
      j++
    }
  }
  while (i < n) {
    ops.push('removed')
    i++
  }
  while (j < m) {
    ops.push('added')
    j++
  }
  return groupOps(ops)
}

function groupOps(ops: Hunk['type'][]): Hunk[] {
  const hunks: Hunk[] = []
  for (const t of ops) {
    const last = hunks[hunks.length - 1]
    if (last && last.type === t) last.count++
    else hunks.push({ type: t, count: 1 })
  }
  return hunks
}

// Build the hunk sequence between two documents: trim the common prefix/suffix
// (emitted as `common` hunks) and LCS only the divergent middle.
function diffHunks(headLines: string[], currentLines: string[]): Hunk[] {
  let p = 0
  const maxP = Math.min(headLines.length, currentLines.length)
  while (p < maxP && headLines[p] === currentLines[p]) p++

  let s = 0
  while (
    s < maxP - p &&
    headLines[headLines.length - 1 - s] ===
      currentLines[currentLines.length - 1 - s]
  )
    s++

  const headMid = headLines.slice(p, headLines.length - s)
  const currentMid = currentLines.slice(p, currentLines.length - s)

  let middle: Hunk[]
  if (headMid.length === 0 && currentMid.length === 0) {
    middle = []
  } else if (headMid.length * currentMid.length > MAX_LCS_CELLS) {
    // too large to LCS safely: coarse remove-then-add of the whole middle
    middle = []
    if (headMid.length) middle.push({ type: 'removed', count: headMid.length })
    if (currentMid.length)
      middle.push({ type: 'added', count: currentMid.length })
  } else {
    middle = lcsHunks(headMid, currentMid)
  }

  const hunks: Hunk[] = []
  if (p > 0) hunks.push({ type: 'common', count: p })
  hunks.push(...middle)
  if (s > 0) hunks.push({ type: 'common', count: s })
  return hunks
}

// Map a HEAD→current line diff to gutter change ranges (0-based, indexing the
// CURRENT document):
//   added   → a range over the inserted current lines
//   removed → a 'modified' marker at the preceding current line (deletions have
//             no current line of their own, so we flag where they were)
//   common  → advances the current-line cursor
export function computeDiffChanges(
  headContent: string,
  currentContent: string,
): DiffChange[] {
  if (headContent === currentContent) return []
  const hunks = diffHunks(headContent.split('\n'), currentContent.split('\n'))
  const changes: DiffChange[] = []
  let currentLine = 0
  for (const h of hunks) {
    if (h.type === 'added') {
      changes.push({
        startLine: currentLine,
        endLine: currentLine + h.count,
        type: 'added',
      })
      currentLine += h.count
    } else if (h.type === 'removed') {
      const at = currentLine > 0 ? currentLine - 1 : 0
      changes.push({ startLine: at, endLine: at + 1, type: 'modified' })
      // a deletion consumes no current line → currentLine unchanged
    } else {
      currentLine += h.count
    }
  }
  return changes
}
