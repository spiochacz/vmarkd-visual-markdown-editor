import { describe, expect, it } from 'vitest'
import {
  type ABox,
  boxDist,
  parDist,
  segHitsABox,
  segsCross,
  simplifyRoute,
  straightenEnds,
  wallDist,
} from './d2-geometry'

// Shared geometry primitives extracted in task 123. These were previously untested (internal to d2-render /
// d2-refine); now they're the one home for both, so they get direct unit coverage.

describe('segsCross (proper segment intersection)', () => {
  it('is true for two segments that properly cross', () => {
    // horizontal y=0 crossed by a vertical at x=5
    expect(segsCross([0, 0], [10, 0], [5, -5], [5, 5])).toBe(true)
  })
  it('is false for parallel non-touching segments', () => {
    expect(segsCross([0, 0], [10, 0], [0, 5], [10, 5])).toBe(false)
  })
  it('is false for a T-junction (endpoint touching, not a proper crossing)', () => {
    // the vertical starts ON the horizontal — touching is not a proper crossing
    expect(segsCross([0, 0], [10, 0], [5, 0], [5, 5])).toBe(false)
  })
  it('is false for collinear overlapping segments', () => {
    expect(segsCross([0, 0], [10, 0], [5, 0], [15, 0])).toBe(false)
  })
})

describe('segHitsABox (box inflated by ASTAR_M=10)', () => {
  const B: ABox = { x: 100, y: 100, w: 50, h: 50 } // inflated → x∈(90,160), y∈(90,160)
  it('hits when a vertical segment passes through the inflated box', () => {
    expect(segHitsABox([120, 0], [120, 300], B)).toBe(true)
  })
  it('misses when the vertical runs clear to the right of the inflation', () => {
    expect(segHitsABox([200, 0], [200, 300], B)).toBe(false)
  })
  it('hits when a horizontal segment passes through the inflated box', () => {
    expect(segHitsABox([0, 120], [300, 120], B)).toBe(true)
  })
  it('misses when a vertical is inside x but clear of the y-range', () => {
    expect(segHitsABox([120, 0], [120, 50], B)).toBe(false) // y 0..50 below y1=90
  })
})

describe('boxDist (perpendicular distance to an un-inflated box)', () => {
  const B: ABox = { x: 0, y: 0, w: 100, h: 100 }
  it('is 0 for a segment inside the box', () => {
    expect(boxDist([50, 50], [60, 50], B)).toBe(0)
  })
  it('is the gap for a segment clear to the right', () => {
    expect(boxDist([200, 50], [200, 60], B)).toBe(100)
  })
})

describe('wallDist (0 on the perimeter, grows inward and outward)', () => {
  const B: ABox = { x: 0, y: 0, w: 100, h: 100 }
  it('is the outside gap when the segment is clear of the box', () => {
    expect(wallDist([200, 50], [200, 60], B)).toBe(100)
  })
  it('is 0 for a segment lying on a wall', () => {
    expect(wallDist([0, 40], [0, 60], B)).toBe(0)
  })
  it('grows toward the interior depth for a segment deep inside', () => {
    // both endpoints at x=50 (50px from either side); min interior depth = 40 (y=60 → 40 from bottom)
    expect(wallDist([50, 50], [50, 60], B)).toBe(40)
  })
})

describe('parDist (gap between parallel overlapping segments, else 1e9)', () => {
  it('returns the perpendicular gap for two overlapping verticals', () => {
    expect(parDist([0, 0], [0, 100], [20, 0], [20, 100])).toBe(20)
  })
  it('returns the perpendicular gap for two overlapping horizontals', () => {
    expect(parDist([0, 0], [100, 0], [0, 15], [100, 15])).toBe(15)
  })
  it('returns 1e9 for parallel segments whose extents do not overlap', () => {
    expect(parDist([0, 0], [0, 50], [20, 60], [20, 100])).toBe(1e9)
  })
  it('returns 1e9 for perpendicular segments', () => {
    expect(parDist([0, 0], [0, 100], [0, 50], [100, 50])).toBe(1e9)
  })
})

describe('simplifyRoute / straightenEnds (route cleanup, now in the geometry module)', () => {
  it('collapses an interior staircase to a single L when it clears all boxes', () => {
    const out = simplifyRoute(
      [
        [0, 0],
        [0, 50],
        [50, 50],
        [50, 100],
        [100, 100],
        [100, 150],
      ],
      [],
    )
    // fewer points than the input staircase, all segments axis-aligned
    expect(out.length).toBeLessThan(6)
    for (let i = 0; i + 1 < out.length; i++) {
      const ortho =
        Math.abs(out[i][0] - out[i + 1][0]) < 0.5 ||
        Math.abs(out[i][1] - out[i + 1][1]) < 0.5
      expect(ortho).toBe(true)
    }
  })
  it('straightenEnds absorbs a tiny port-attach kink at the source', () => {
    const box = { x: 0, y: 0, w: 100, h: 40 } // attach point sits on its bottom border
    const out = straightenEnds(
      [
        [40, 40], // attach on box bottom
        [40, 80], // tiny step
        [50, 80],
        [50, 200],
      ],
      [box],
    )
    // the 3-point S at the source is absorbed → first point moves to align with the kept point's column
    expect(out.length).toBeLessThan(4)
  })
})
