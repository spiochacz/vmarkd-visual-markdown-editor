import { describe, expect, it } from 'vitest'
import {
  alignByHeadings,
  proportionalScroll,
  type ScrollGeom,
} from '../../media-src/src/heading-align'

// A FROM pane (short blocks) and a TO pane (tall blocks) rendering the same doc:
// headings at different offsets, but paired 1:1 in order. Centre-anchored.
const from: ScrollGeom = { scrollTop: 0, clientHeight: 100, scrollHeight: 600 }
const to: ScrollGeom = { scrollTop: 0, clientHeight: 100, scrollHeight: 1200 }
const fromTops = [50, 250, 450] // h1, h2, h3 in FROM
const toTops = [100, 500, 900] // same headings, taller in TO

describe('alignByHeadings', () => {
  it('returns null when there are no headings to anchor on', () => {
    expect(alignByHeadings(from, [], to, [])).toBeNull()
  })

  it('returns null when heading counts differ (panes out of sync)', () => {
    expect(alignByHeadings(from, [50, 250], to, [100, 500, 900])).toBeNull()
  })

  it('maps a centre sitting exactly on a heading to the paired heading (centred)', () => {
    // FROM centre = scrollTop 200 + 50 = 250 = exactly the 2nd heading (toTops 500).
    // Target scrollTop puts that paired heading at the TO viewport centre: 500 - 50.
    const r = alignByHeadings({ ...from, scrollTop: 200 }, fromTops, to, toTops)
    expect(r).toBeCloseTo(450, 5)
  })

  it('interpolates linearly between two headings', () => {
    // FROM centre halfway between h1(50) and h2(250) = 150 → scrollTop 100.
    // Halfway between toTops 100 and 500 = 300 → minus half-viewport (50) = 250.
    const r = alignByHeadings({ ...from, scrollTop: 100 }, fromTops, to, toTops)
    expect(r).toBeCloseTo(250, 5)
  })

  it('interpolates from the content top (0↔0) above the first heading', () => {
    // FROM centre 50 → between content top (0) and h1: frac = 50/50 = 1 → toTops[0] 100.
    const r = alignByHeadings({ ...from, scrollTop: 0 }, fromTops, to, toTops)
    // Then minus half-viewport, clamped to >= 0.
    expect(r).toBeCloseTo(50, 5)
  })

  it('interpolates to the content end past the last heading', () => {
    // FROM centre past h3(450): scrollTop 500 + 50 = 550 → between h3 and end(600).
    const r = alignByHeadings({ ...from, scrollTop: 500 }, fromTops, to, toTops)
    // frac = (550-450)/(600-450) = 0.667; toTops[2] 900 + 0.667*(1200-900)=1100; -50 = 1050.
    expect(r).toBeCloseTo(1050, 0)
  })

  it('clamps the result to the TO scroll range', () => {
    const r = alignByHeadings(
      { ...from, scrollTop: 99999 },
      fromTops,
      to,
      toTops,
    )
    expect(r).toBe(to.scrollHeight - to.clientHeight) // 1100, never beyond
  })
})

describe('proportionalScroll', () => {
  it('keeps the same scroll fraction', () => {
    // FROM at 50% (scrollTop 250 of max 500) → TO 50% of max 1100 = 550.
    expect(proportionalScroll({ ...from, scrollTop: 250 }, to)).toBeCloseTo(
      550,
      5,
    )
  })

  it('is 0 when the FROM pane cannot scroll', () => {
    expect(
      proportionalScroll(
        { scrollTop: 0, clientHeight: 600, scrollHeight: 600 },
        to,
      ),
    ).toBe(0)
  })
})
