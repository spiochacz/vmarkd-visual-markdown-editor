// Repair GFM table cells whose inline math/code contains a literal `|` (Vditor #1904).
//
// Lute (like cmark-gfm / GitHub) splits a table row into cells on unescaped `|`
// BEFORE inline parsing, so a `|` inside an inline math (`$…$`) or code (`` `…` ``)
// span is mistaken for a column separator — the row's columns shift, the math/code is
// destroyed, and content is lost. The GFM-correct form escapes the literal pipe as
// `\|`; an escaped `$\|x\|$` round-trips through Lute perfectly.
//
// We can't stop Lute splitting, and the serializer won't auto-escape, so we normalize
// on the way IN: escape `|` inside math/code spans of table rows before Lute parses.
// Applied host-side at every markdown→webview boundary (initial value, updates, the
// instant-paint overlay) and inside `reserializeMarkdown` so the minimal-diff write-back
// (task 61) stays consistent — an untouched math-table keeps its original bytes; an
// edited one is normalized to valid GFM.
//
// SAFETY — this can never corrupt a working table:
//   • only TABLE rows are considered (fenced code blocks and prose are skipped);
//   • only rows that are CURRENTLY over-split (cell count > the delimiter's column
//     count) are candidates — a correctly-celled row (incl. a `| $5 | $6 |` price
//     table) is left byte-for-byte untouched;
//   • the escaped row is applied ONLY when it restores the EXACT expected column count,
//     so a mis-detected span can at worst leave an already-broken row unchanged.

// Opening/closing fence of a code block (``` or ~~~), same matcher as splitBlocks.
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
// A GFM delimiter row: cells of only `-`, optional leading/trailing `:`, and spaces.
const DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

// Split a table row into raw cell strings on unescaped `|`, dropping the optional
// leading/trailing pipe. Cell count = the array length.
function cellCount(line: string): number {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split(/(?<!\\)\|/).length
}

// Escape unescaped `|` inside inline math (`$…$`) and code (`` `…` ``) spans of one
// line. Backtick spans are unambiguous. Math uses the CommonMark-math flanking rules
// (open `$` not followed by whitespace; close `$` not preceded by whitespace and not
// followed by a digit) so prices like `$5` don't open a span.
function escapeSpansInLine(line: string): string {
  let out = ''
  let i = 0
  const n = line.length
  while (i < n) {
    const c = line[i]
    if (c === '\\') {
      // keep an existing escape (and its escaped char) verbatim
      out += c + (line[i + 1] ?? '')
      i += 2
      continue
    }
    if (c === '`') {
      let run = 0
      while (line[i + run] === '`') run++
      // find a closing run of the SAME length
      let j = i + run
      let close = -1
      while (j < n) {
        if (line[j] === '`') {
          let r = 0
          while (line[j + r] === '`') r++
          if (r === run) {
            close = j
            break
          }
          j += r
        } else {
          j++
        }
      }
      if (close === -1) {
        out += '`'.repeat(run)
        i += run
        continue
      }
      const inner = line.slice(i + run, close).replace(/(?<!\\)\|/g, '\\|')
      out += '`'.repeat(run) + inner + '`'.repeat(run)
      i = close + run
      continue
    }
    if (c === '$') {
      const next = line[i + 1]
      if (next === undefined || /\s/.test(next) || next === '$') {
        out += c
        i++
        continue
      }
      let j = i + 1
      let close = -1
      while (j < n) {
        if (
          line[j] === '$' &&
          line[j - 1] !== '\\' &&
          !/\s/.test(line[j - 1]) &&
          !/[0-9]/.test(line[j + 1] ?? '')
        ) {
          close = j
          break
        }
        j++
      }
      if (close === -1) {
        out += c
        i++
        continue
      }
      const inner = line.slice(i + 1, close).replace(/(?<!\\)\|/g, '\\|')
      out += `$${inner}$`
      i = close + 1
      continue
    }
    out += c
    i++
  }
  return out
}

export function escapeTableSpanPipes(md: string): string {
  if (!md.includes('|')) return md
  const lines = md.split('\n')

  // Mark fenced-code lines so table detection skips them.
  const inFence: boolean[] = new Array(lines.length).fill(false)
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE)
    if (fence) {
      inFence[i] = true
      if (m && lines[i].trim().startsWith(fence)) fence = null
      continue
    }
    if (m) {
      fence = m[1][0]
      inFence[i] = true
    }
  }

  let changed = false
  for (let i = 1; i < lines.length; i++) {
    if (inFence[i] || !lines[i].includes('|') || !DELIM.test(lines[i])) continue
    const header = lines[i - 1]
    if (inFence[i - 1] || header.trim() === '' || !header.includes('|'))
      continue

    const expected = cellCount(lines[i])
    // Rows to consider: the header (i-1) and the body rows below until the table ends.
    const rows = [i - 1]
    for (let j = i + 1; j < lines.length; j++) {
      if (inFence[j] || lines[j].trim() === '' || !lines[j].includes('|')) break
      rows.push(j)
    }
    for (const r of rows) {
      if (cellCount(lines[r]) === expected) continue // correct → never touch
      const repaired = escapeSpansInLine(lines[r])
      if (repaired !== lines[r] && cellCount(repaired) === expected) {
        lines[r] = repaired
        changed = true
      }
    }
  }
  return changed ? lines.join('\n') : md
}
