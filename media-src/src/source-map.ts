// DOM ↔ markdown-source mapping for the WYSIWYG/IR editor.
//
// Consumed by Reveal-in-Source (task 16) and, later, git gutters (task 17).
// The accurate path uses Lute's own caret token (see getCursorSourceOffset in
// the webview integration); these pure helpers cover line math and the exact
// table-cell mapping, and are unit-tested in isolation.

export interface TableCellRef {
  /** index of the table among all tables in the document (0-based) */
  tableIndex: number
  /** DOM row index within the table (0 = header row) */
  row: number
  /** column index within the row (0-based) */
  col: number
}

// Count the newlines before `offset` → the 0-based line number that offset sits
// on. An offset on a '\n' belongs to the line that newline terminates.
export function offsetToLine(md: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, md.length))
  let line = 0
  for (let i = 0; i < clamped; i++) {
    if (md[i] === '\n') line++
  }
  return line
}

// Exact mapping for a table cell: locate the Nth markdown table, then the source
// row (DOM row 0 = header; the separator row is skipped for body rows), then
// count pipes to the target column. Returns the absolute source offset of the
// cell's content start, or null if the table/row can't be located.
export function getTableSourceOffset(
  md: string,
  ref: TableCellRef,
): number | null {
  const lines = md.split('\n')

  // find the start line of the Nth table (a table row starts with '|', and the
  // row that begins a table is one whose previous line is not a table row)
  let tableCount = 0
  let tableStartLine = -1
  for (let i = 0; i < lines.length; i++) {
    const isRow = lines[i].trim().startsWith('|')
    const prevIsRow = i > 0 && lines[i - 1].trim().startsWith('|')
    if (isRow && !prevIsRow) {
      if (tableCount === ref.tableIndex) {
        tableStartLine = i
        break
      }
      tableCount++
    }
  }
  if (tableStartLine < 0) return null

  // DOM row 0 = header (source row 0); DOM body rows skip the separator row,
  // so add 1 for any row beyond the header.
  const sourceRow = tableStartLine + ref.row + (ref.row > 0 ? 1 : 0)
  const line = lines[sourceRow]
  if (line === undefined) return null

  // walk pipes: content of column `col` starts just after the (col+1)-th pipe
  let colPos = 0
  let pipes = 0
  for (let c = 0; c < line.length; c++) {
    if (line[c] === '|') {
      pipes++
      if (pipes > ref.col) {
        colPos = c + 1
        break
      }
    }
  }

  let offset = 0
  for (let i = 0; i < sourceRow; i++) {
    offset += lines[i].length + 1 // +1 for the '\n'
  }
  return offset + colPos
}

const BLOCK_SAMPLE = 25

function isBlockEl(el: HTMLElement): boolean {
  return /^(P|H[1-6]|BLOCKQUOTE|UL|OL|LI|PRE|TABLE|HR|DIV)$/.test(el.tagName)
}

// Resolve the active mode's editable element (IR / WYSIWYG / SV) — never a
// hard-coded `.vditor-ir`, so mapping works in whatever mode the user is in.
export function activeModeElement(vditor: any): HTMLElement | null {
  const inner = vditor?.vditor
  const mode = inner?.currentMode
  const el = mode ? inner?.[mode]?.element : undefined
  return (el as HTMLElement) || null
}

function modeDomToMd(vditor: any, html: string): string {
  const lute = vditor?.vditor?.lute
  const mode = vditor?.vditor?.currentMode
  if (!lute) return ''
  if (mode === 'wysiwyg') return lute.VditorDOM2Md(html)
  // ir (and sv falls back to ir conversion well enough for offset purposes)
  return lute.VditorIRDOM2Md(html)
}

// EXACT cursor → source offset, using Lute's own caret token (‸ = Lute.Caret).
// Inserting it as a text node at the selection and round-tripping the active
// mode's innerHTML through Lute's DOM→Md keeps the token in the output even
// inside syntax markers (verified: headings, bold, lists), so indexOf gives the
// precise source offset. Falls back to exact table mapping, then a block-sample
// heuristic, when the token can't be placed/found. Returns -1 if nothing maps.
export function getCursorSourceOffset(vditor: any): number {
  const editor = activeModeElement(vditor)
  if (!editor) return -1
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return -1
  const anchorNode = sel.anchorNode
  if (!anchorNode || !editor.contains(anchorNode)) return -1

  const md: string = vditor.getValue()
  const Caret: string = (window as any).Lute?.Caret || '‸'

  // --- table cells: exact mapping computed against the real source ---
  // Tables come first: a Lute caret round-trip re-serializes cell padding /
  // blank lines, so the caret's index in the round-tripped output drifts from
  // the offset in getValue(). getTableSourceOffset counts pipes in the actual
  // markdown, so it stays correct (lands within the right cell/row).
  let cell: HTMLElement | null = null
  let table: HTMLElement | null = null
  let p: Node | null = anchorNode
  while (p && p !== editor) {
    if (p instanceof HTMLElement) {
      if (!cell && (p.tagName === 'TD' || p.tagName === 'TH')) cell = p
      if (p.tagName === 'TABLE') {
        table = p
        break
      }
    }
    p = p.parentNode
  }
  if (table && cell) {
    const tables = Array.from(editor.querySelectorAll('table'))
    const tableIndex = tables.indexOf(table as HTMLTableElement)
    const tr = cell.closest('tr')!
    const row = Array.from(table.querySelectorAll('tr')).indexOf(tr)
    const col = Array.from(tr.querySelectorAll('td, th')).indexOf(cell)
    const off = getTableSourceOffset(md, { tableIndex, row, col })
    if (off !== null) return off
  }

  // --- accurate path (prose/headings/lists): insert the Lute caret token ---
  // For non-table content the round-trip is byte-stable up to the caret, so the
  // caret's index in the output equals the exact source offset — accurate even
  // inside syntax markers (`# `, `**`), which a plain sentinel can't manage.
  const caretNode = document.createTextNode(Caret)
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  let inserted = false
  try {
    range.insertNode(caretNode)
    inserted = true
    const out = modeDomToMd(vditor, editor.innerHTML)
    const idx = out.indexOf(Caret)
    if (idx >= 0) return idx
  } catch {
    /* fall through to heuristic */
  } finally {
    if (inserted) {
      caretNode.remove()
      editor.normalize?.()
    }
  }

  // --- fallback: block-sample heuristic (approximate within the block) ---
  let block: HTMLElement | null = null
  let node: Node | null = anchorNode
  while (node && node !== editor) {
    if (node instanceof HTMLElement && isBlockEl(node)) {
      block = node
      break
    }
    node = node.parentNode
  }
  if (!block) return -1
  const blockText = (block.textContent || '').trim()
  const sample = blockText.substring(0, BLOCK_SAMPLE)
  if (!sample) return -1
  const matchIdx = md.indexOf(sample)
  return matchIdx >= 0 ? matchIdx : -1
}

// Resolve a source offset to its 0-based line number and that line's text, both
// in the same string `md`. Reveal-in-source sends BOTH to the host so it can
// match the line by content in the on-disk doc (which may differ from
// vditor.getValue() by Vditor's on-load reflow) instead of trusting a raw
// offset that drifts across the two text spaces.
export function lineAndTextForOffset(
  md: string,
  offset: number,
): { line: number; lineText: string } {
  const clamped = Math.max(0, Math.min(offset, md.length))
  const lines = md.split('\n')
  const line = md.substring(0, clamped).split('\n').length - 1
  return { line, lineText: lines[line] ?? '' }
}
