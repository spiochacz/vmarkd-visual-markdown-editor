// Git gutter rendering for the WYSIWYG/IR view (task 17).
//
// The host computes an exact line diff vs git HEAD (src/git-diff.ts) and posts
// `diff-info` with change ranges. Here we map each top-level editor block back to
// its source line range (same sample+indexOf trick as the cursor mapping) and
// render an absolutely-positioned bar for the blocks that overlap a change.
//
// Split into a pure core (computeBlockMarkers) that is unit-tested, and a DOM
// wrapper (renderDiffMarkers) covered by e2e on the real editor.

import { activeModeElement } from '../util/source-map'

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

interface BlockMarker {
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

// Locate a block's source line span from its rendered (line-aware) text.
//
// A single-line block (paragraph, heading) still has its whole text as a
// contiguous substring of the markdown, so the old "one sample, one indexOf"
// trick worked. It breaks for blocks whose markdown syntax interleaves with
// the text across several lines — a <ul> concatenates its <li> texts with no
// "- " markers and no newlines between them (e.g. "first itemsecond item"),
// which never appears verbatim in "- first item\n- second item\n" — so the
// block was silently skipped (task 516: git gutter never rendered for lists).
//
// Fix: treat blockText as one line per source line (the caller passes
// innerText, which renders <li>/<tr> etc. as separate lines) and anchor on
// the FIRST non-empty line to find the start, then on the LAST non-empty
// line — searched forward from the start — to find where the block ends.
// This only requires each individual line to appear verbatim, not the whole
// block, so it survives the markers/newlines markdown inserts between lines.
function blockLineRange(
  blockText: string,
  md: string,
): { startLine: number; lineCount: number } | null {
  const lines = blockText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return null

  const firstSample = lines[0].substring(0, BLOCK_SAMPLE)
  const idx = md.indexOf(firstSample)
  if (idx < 0) return null
  const startLine = md.substring(0, idx).split('\n').length - 1

  const lastLine = lines[lines.length - 1]
  const lastSample = lastLine.substring(0, BLOCK_SAMPLE)
  // Search from idx (not 0) so an earlier, unrelated occurrence of the last
  // line's text can't pull the end boundary before the start.
  const lastIdx = md.indexOf(lastSample, idx)
  const endSearchIdx = lastIdx >= 0 ? lastIdx : idx
  const nextNewline = md.indexOf('\n', endSearchIdx)
  const stop = nextNewline >= 0 ? nextNewline : md.length
  const lineCount = md.substring(0, stop).split('\n').length - startLine
  return { startLine, lineCount: Math.max(1, lineCount) }
}

// Pure core: decide the gutter bars. For each block, find overlapping changes
// and keep the highest-priority type.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-block overlap scan against every change with a highest-priority-type merge; pre-existing (task 469 baseline)
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
    // innerText renders block-level children (li, tr, ...) as separate lines,
    // which blockLineRange needs to map multi-line blocks like lists/tables
    // back to source lines (task 516). textContent concatenates them with no
    // separator and is only a fallback for environments without innerText
    // (e.g. jsdom in unit tests never reaches this DOM wrapper). The lib DOM
    // types declare innerText as always present on HTMLElement, so a
    // `'innerText' in child` guard narrows the false branch to never and tsc
    // rejects the textContent fallback; read it through an alias that widens
    // innerText to optional instead, so a missing property (undefined, same
    // as jsdom's un-narrowed access) falls through to textContent via ??.
    const box = child as HTMLElement & { innerText?: string }
    const text = box.innerText ?? child.textContent ?? ''
    blocks.push({
      text,
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
