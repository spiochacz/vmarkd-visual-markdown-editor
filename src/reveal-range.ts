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
export function selectionForOffset(
  text: string,
  offset: number,
): LineSelection {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const lines = text.split('\n')
  const line = text.substring(0, clamped).split('\n').length - 1
  const lineText = lines[line] ?? ''
  return { line, startChar: 0, endChar: lineText.length }
}

// Robust line mapping for reveal-in-source. The webview reports the caret's line
// number AND that line's text, both measured against vditor.getValue(). On disk
// the document can differ (Vditor reflows on load: a blank line after a heading,
// `>` re-prefixing in quotes), so the reported line number alone drifts. Prefer
// locating the line by its CONTENT in the real doc, biased to the line nearest
// the reported index (handles duplicate lines), and fall back to the reported
// line number (clamped) when the content can't be found.
export function selectionForLine(
  text: string,
  reportedLine: number,
  lineText: string,
): LineSelection {
  const lines = text.split('\n')
  const lastLine = Math.max(0, lines.length - 1)
  const clampedReported = Math.max(0, Math.min(reportedLine, lastLine))

  const needle = lineText
  if (needle) {
    // collect every line that equals the reported text, pick the one closest to
    // the reported index (so duplicate lines resolve to the intended one)
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === needle) {
        const dist = Math.abs(i - reportedLine)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      }
    }
    if (best >= 0) {
      return { line: best, startChar: 0, endChar: lines[best].length }
    }
  }

  // fallback: trust the reported line number
  return {
    line: clampedReported,
    startChar: 0,
    endChar: (lines[clampedReported] ?? '').length,
  }
}
