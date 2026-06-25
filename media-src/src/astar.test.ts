import { describe, expect, it } from 'vitest'
import { astar } from './astar'
import { type ABox, type Pt, segHitsABox } from './d2-geometry'

// The back-edge A* router, extracted to its own module in task 123 (was internal to d2-refine, only
// exercised through rerouteBackEdges + the quality fixtures). Direct unit coverage of the grid routing.

const noneDir: [number, number] = [0, 1]

describe('astar (Hanan-grid orthogonal router)', () => {
  it('routes a straight unobstructed path from start to goal', () => {
    const path = astar([0, 0], [0, 100], [], noneDir, [], null, [])
    expect(path).not.toBeNull()
    const p = path as Pt[]
    expect([p[0][0], p[0][1]]).toEqual([0, 0])
    expect([p[p.length - 1][0], p[p.length - 1][1]]).toEqual([0, 100])
  })

  it('returns an axis-aligned polyline (every segment H or V)', () => {
    const box: ABox = { x: -20, y: 80, w: 40, h: 40 }
    const path = astar([0, 0], [0, 200], [box], noneDir, [], null, [box])
    expect(path).not.toBeNull()
    const p = path as Pt[]
    for (let i = 0; i + 1 < p.length; i++) {
      const ortho =
        Math.abs(p[i][0] - p[i + 1][0]) < 0.5 ||
        Math.abs(p[i][1] - p[i + 1][1]) < 0.5
      expect(ortho).toBe(true)
    }
  })

  it('detours around a hard obstacle that blocks the straight line', () => {
    // box straddles x=0 between the endpoints → the straight route is blocked, A* must go around
    const box: ABox = { x: -20, y: 80, w: 40, h: 40 }
    const path = astar([0, 0], [0, 200], [box], noneDir, [], null, [box])
    expect(path).not.toBeNull()
    const p = path as Pt[]
    // no segment of the routed path may pierce the (inflated) obstacle
    for (let i = 0; i + 1 < p.length; i++)
      expect(segHitsABox(p[i], p[i + 1], box)).toBe(false)
    // it actually bent away from the x=0 column at some point (a real detour, not a straight line)
    const offColumn = p.some((q) => Math.abs(q[0]) > 0.5)
    expect(offColumn).toBe(true)
  })

  it('endpoints are preserved exactly even when detouring', () => {
    const box: ABox = { x: -20, y: 80, w: 40, h: 40 }
    const path = astar([0, 0], [0, 200], [box], noneDir, [], null, [box])
    const p = path as Pt[]
    expect([p[0][0], p[0][1]]).toEqual([0, 0])
    expect([p[p.length - 1][0], p[p.length - 1][1]]).toEqual([0, 200])
  })
})
