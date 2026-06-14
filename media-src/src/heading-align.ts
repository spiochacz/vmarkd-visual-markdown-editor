// Pure heading-anchored scroll interpolation, shared by the SV split-view sync
// (split-scroll-sync.ts) and the edit↔preview mode-switch scroll preservation
// (preview-scroll-preserve.ts).
//
// The idea (task 48): two panes render the SAME document but at DIFFERENT block
// heights (a one-line `# Heading` source vs a tall rendered <h1>; a collapsed code
// block vs its render). A purely proportional `scrollTop * otherHeight / thisHeight`
// therefore drifts. But every markdown heading renders to exactly one <h1>..<h6> in
// the same order in BOTH panes, so headings are reliable 1:1 anchors. We align the
// FROM viewport's CENTRE between the two headings bracketing it and interpolate the
// matching CENTRE in the TO pane. The centre stays aligned; slight drift between
// headings is accepted. No DOM here — callers pass the measured offsets so this is
// unit-testable and reusable across both scroll containers.

export interface ScrollGeom {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// FROM viewport centre → equivalent TO scrollTop, interpolating between paired
// heading offsets (tops relative to each scroller's content, 0 = top of content,
// in DOM order). Virtual anchors bracket the ends: the very top (0↔0) and the
// content end (full height↔full height). Returns null when the anchors don't pair
// 1:1 (none, or mismatched counts) — the caller should fall back to proportional()
// or leave the existing value.
export function alignByHeadings(
  from: ScrollGeom,
  fromTops: number[],
  to: ScrollGeom,
  toTops: number[],
): number | null {
  if (!fromTops.length || fromTops.length !== toTops.length) return null

  const centre = from.scrollTop + from.clientHeight / 2

  let target: number
  if (centre <= fromTops[0]) {
    // Above the first heading: interpolate from the content top (0↔0).
    const frac = fromTops[0] > 0 ? centre / fromTops[0] : 0
    target = frac * toTops[0]
  } else {
    // Find the segment [i, i+1) bracketing the centre.
    let i = fromTops.length - 1
    for (let k = 0; k < fromTops.length - 1; k++) {
      if (centre < fromTops[k + 1]) {
        i = k
        break
      }
    }
    if (i === fromTops.length - 1) {
      // Past the last heading: interpolate to the end of content.
      const fromSpan = from.scrollHeight - fromTops[i]
      const toSpan = to.scrollHeight - toTops[i]
      const frac = fromSpan > 0 ? (centre - fromTops[i]) / fromSpan : 0
      target = toTops[i] + frac * toSpan
    } else {
      const frac = (centre - fromTops[i]) / (fromTops[i + 1] - fromTops[i])
      target = toTops[i] + frac * (toTops[i + 1] - toTops[i])
    }
  }

  return clamp(
    target - to.clientHeight / 2,
    0,
    to.scrollHeight - to.clientHeight,
  )
}

// Fallback when headings don't pair: keep the same scroll FRACTION.
export function proportionalScroll(from: ScrollGeom, to: ScrollGeom): number {
  const fromMax = from.scrollHeight - from.clientHeight
  const frac = fromMax > 0 ? from.scrollTop / fromMax : 0
  return clamp(
    frac * (to.scrollHeight - to.clientHeight),
    0,
    to.scrollHeight - to.clientHeight,
  )
}
