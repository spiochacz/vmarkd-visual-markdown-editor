// Host-side helper for Reveal-in-Source (task 16): map a character offset in the
// markdown source to the line + full-line character range to select in the text
// editor. Pure and unit-tested; the command wiring in extension.ts consumes it.

export interface LineSelection {
  line: number
  startChar: number
  endChar: number
}

// Given the full document text and a character offset, return the 0-based line
// the offset falls on and the range spanning that whole line (start..end). The
// offset is clamped into [0, text.length] so out-of-range replies degrade to the
// first/last line rather than throwing.
export function selectionForOffset(text: string, offset: number): LineSelection {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const lines = text.split('\n')
  const line = text.substring(0, clamped).split('\n').length - 1
  const lineText = lines[line] ?? ''
  return { line, startChar: 0, endChar: lineText.length }
}
