// Task 532 §D — the comparison and tolerance policy of the parity gate, in ONE place.
//
// A "stage pair" is `<reference>><candidate>`: the first stage is what the second must look like.
// Nothing is ever compared across themes — only stages within one configuration (a theme is allowed
// to differ from another theme, never one of its own stages from another).

import type { ParityStage } from './elements'

export type StagePair =
  | 'overlay>ir'
  | 'ir>wysiwyg'
  | 'ir>preview'
  | 'preview>sv'

export interface PairPolicy {
  reference: ParityStage
  candidate: ParityStage
  /** Absolute px tolerance for `rect.*` numbers. null = rects are not compared at all. */
  rectTolerance: number | null
  /** `rect.*` properties exempt from comparison even when rects are compared. */
  skipProps: readonly RegExp[]
}

// Sub-pixel rounding across two scrollers is the only slack; every other property is exact.
export const PAIR_POLICY: Readonly<Record<StagePair, PairPolicy>> = {
  // The overlay is the host's render of the same mode the editor boots in, same width.
  'overlay>ir': {
    reference: 'overlay',
    candidate: 'ir',
    rectTolerance: 0.5,
    skipProps: [],
  },
  'ir>wysiwyg': {
    reference: 'ir',
    candidate: 'wysiwyg',
    rectTolerance: 0.5,
    skipProps: [],
  },
  // Collapsed IR (caret parked) vs the full Preview overlay, same width. 1px: one CSS px of rounding
  // across two different scrollers.
  'ir>preview': {
    reference: 'ir',
    candidate: 'preview',
    rectTolerance: 1,
    skipProps: [],
  },
  // The split pane is narrower, so wraps (and every rect) legitimately differ; styles — indents,
  // margins, paddings — must still agree exactly.
  'preview>sv': {
    reference: 'preview',
    candidate: 'sv',
    rectTolerance: null,
    skipProps: [],
  },
}

export const STAGE_PAIRS = Object.keys(PAIR_POLICY) as StagePair[]

/** Properties that are rectangles' derived numbers; compared with `rectTolerance`. */
export const isRectProp = (property: string): boolean =>
  property.startsWith('rect.')

/**
 * Sub-pixel noise between two engines' layout of the SAME box (a wrapped line's start can land a
 * hair either side of a .5): a numeric difference at or under this is never a drift. Applies to
 * the style strings that parse as px too (computed `margin-bottom: 9.8px` vs `9.8px` is equal; the
 * policy does not round them).
 */
export const NUMERIC_EPSILON = 0.001

/**
 * Task 532 step 5c — what the instant-paint overlay is allowed NOT to match for a diagram.
 *
 * The overlay does not draw the diagram: it reserves its box (media-src/src/editing/diagram-
 * placeholder.ts) and the live editor paints the SVG at the swap (inlining the cached SVG is step 5d).
 * So a diagram kind's `marker.svg` is 0 in the overlay by construction, and it has no painted glyph
 * (the raw source is not shown), hence no `firstGlyphX` and no `text.*` cells. Everything that decides
 * whether the content below MOVES at the swap — `rect.height`, `gapBefore`, `left`, `width` and the
 * block styles — stays compared at the overlay's normal tolerance.
 *
 * That holds for the CACHED case, which is what the gate measures (the harness reports each render's
 * size to a stub host and re-opens the page with them; the VS Code spec re-opens the real file in the
 * same window). UNCACHED, the host has no size and the placeholder is the fixed
 * `--vmarkd-geo-diagram-min-h`: the jump is bounded by |rendered height - that minimum| and cannot be
 * asserted against a size nobody knows yet, so it is not in the allow-list either — parity.spec.ts
 * pins the contract instead (no source text, the placeholder is exactly the minimum high).
 */
export const OVERLAY_DIAGRAM_UNCACHED_MIN_HEIGHT = 160

const OVERLAY_PLACEHOLDER_PROPS = /^(marker\.svg|text\..+|rect\.firstGlyphX)$/

/** True for the cells of a diagram kind that the overlay's placeholder cannot match by design. */
export const isOverlayPlaceholderCell = (
  stagePair: StagePair,
  isDiagramKind: boolean,
  property: string,
): boolean =>
  stagePair === 'overlay>ir' &&
  isDiagramKind &&
  OVERLAY_PLACEHOLDER_PROPS.test(property)
