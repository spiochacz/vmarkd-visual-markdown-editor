// Git gutter rendering for the WYSIWYG/IR view (task 17).
//
// The host computes an exact line diff vs git HEAD (src/git-diff.ts) and posts
// `diff-info` with change ranges. Here we map each top-level editor block back to
// its source line range (same sample+indexOf trick as the cursor mapping) and
// render an absolutely-positioned bar for the blocks that overlap a change.
//
// Split into a pure core (computeBlockMarkers) that is unit-tested, and a DOM
// wrapper (renderDiffMarkers) covered by e2e on the real editor.

import { activeModeElement } from './source-map'

export interface DiffChange {
  startLine: number
  endLine: number
  type: 'added' | 'removed' | 'modified'
}

// Geometry + text of one top-level block, as the pure core sees it.
export interface BlockBox {
  text: string
  top: number
  height: number
}

export interface BlockMarker {
  top: number
  height: number
  type: DiffChange['type']
}

const BLOCK_SAMPLE = 25
const PRIORITY: Record<DiffChange['type'], number> = {
  removed: 3,
  modified: 2,
  added: 1,
}

// Locate a block's source line span by finding the first BLOCK_SAMPLE chars of
// its text in the markdown. Returns null when the text is empty or not found.
function blockLineRange(
  blockText: string,
  md: string,
): { startLine: number; lineCount: number } | null {
  const trimmed = blockText.trim()
  if (!trimmed) return null
  const sample = trimmed.substring(0, BLOCK_SAMPLE)
  const idx = md.indexOf(sample)
  if (idx < 0) return null
  const startLine = md.substring(0, idx).split('\n').length - 1
  const endIdx = idx + trimmed.length
  const nextNewline = md.indexOf('\n', endIdx)
  const stop = nextNewline >= 0 ? nextNewline : md.length
  const lineCount = md.substring(0, stop).split('\n').length - startLine
  return { startLine, lineCount: Math.max(1, lineCount) }
}

// Pure core: decide the gutter bars. For each block, find overlapping changes
// and keep the highest-priority type.
export function computeBlockMarkers(
  blocks: BlockBox[],
  md: string,
  changes: DiffChange[],
): BlockMarker[] {
  if (changes.length === 0) return []
  const markers: BlockMarker[] = []
  for (const block of blocks) {
    const range = blockLineRange(block.text, md)
    if (!range) continue
    const blockEnd = range.startLine + range.lineCount
    let bestType: DiffChange['type'] | null = null
    let bestPriority = -1
    for (const change of changes) {
      if (change.startLine >= blockEnd) continue
      if (change.endLine <= range.startLine) continue
      const priority = PRIORITY[change.type] ?? 0
      if (priority > bestPriority) {
        bestPriority = priority
        bestType = change.type
      }
    }
    if (bestType) {
      markers.push({ top: block.top, height: block.height, type: bestType })
    }
  }
  return markers
}

const MARKER_CLASS = 'me-diff-marker'

export function clearDiffMarkers(root: ParentNode = document): void {
  root.querySelectorAll(`.${MARKER_CLASS}`).forEach((el) => {
    el.remove()
  })
}

// DOM wrapper: read the live block geometry, compute the markers, and render a
// bar per changed block. Returns the number of markers rendered (handy for e2e).
export function renderDiffMarkers(vditor: any, changes: DiffChange[]): number {
  const editor = activeModeElement(vditor)
  if (!editor) return 0
  clearDiffMarkers(editor)
  if (!changes || changes.length === 0) return 0

  const md: string = vditor.getValue ? vditor.getValue() : ''
  const blocks: BlockBox[] = []
  const blockEls: HTMLElement[] = []
  for (const child of Array.from(editor.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (child.classList.contains(MARKER_CLASS)) continue
    blocks.push({
      text: child.textContent || '',
      top: child.offsetTop,
      height: child.offsetHeight,
    })
    blockEls.push(child)
  }

  const markers = computeBlockMarkers(blocks, md, changes)
  // ensure the editor is a positioning context so absolute bars anchor to it
  if (getComputedStyle(editor).position === 'static') {
    editor.style.position = 'relative'
  }
  for (const m of markers) {
    const bar = document.createElement('div')
    bar.className = `${MARKER_CLASS} ${MARKER_CLASS}--${m.type}`
    bar.style.top = `${m.top}px`
    bar.style.height = `${m.height}px`
    bar.contentEditable = 'false'
    editor.appendChild(bar)
  }
  return markers.length
}
