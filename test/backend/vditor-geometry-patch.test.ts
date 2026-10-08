import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GEO_TOKENS,
  VDITOR_GEOMETRY_PATCHES,
  varifyGeometryCss,
  // @ts-expect-error — plain .mjs build helper, no type declarations
} from '../../scripts/vditor-geometry-patch.mjs'

// Task 532 step 2 — build.mjs varifyVditorGeometry. Runs on the PRISTINE node_modules index.css so a
// Vditor bump that moves an anchor fails here with the same message the build gives.
const stock = readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    'media-src',
    'node_modules',
    'vditor',
    'dist',
    'index.css',
  ),
  'utf8',
)
const patches = VDITOR_GEOMETRY_PATCHES as [string, string, string][]
const tokens = GEO_TOKENS as [string, string][]
const count = (s: string, n: string) => s.split(n).length - 1

describe('varifyGeometryCss (task 532 step 2)', () => {
  const out: string = varifyGeometryCss(stock)

  it('every anchor occurs exactly once in the stock index.css', () => {
    for (const [label, find] of patches)
      expect(count(stock, find), label).toBe(1)
  })

  it('output carries the var(--vmarkd-geo-*, <Vditor value>) forms', () => {
    expect(out).toContain('line-height: var(--vmarkd-geo-line-height, 1.5);')
    expect(out).toContain('padding-left: var(--vmarkd-geo-list-indent, 2em);')
    expect(out).toContain('margin-bottom: var(--vmarkd-geo-block-gap, 16px);')
    expect(out).toContain('margin-top: var(--vmarkd-geo-heading-mt, 24px);')
    expect(out).toContain('line-height: var(--vmarkd-geo-heading-lh, 1.25);')
    expect(out).toContain('padding: var(--vmarkd-geo-code-pad, 0.5em);')
    expect(out).toContain('border-radius: var(--vmarkd-geo-code-radius, 5px);')
  })

  it('every token has its Vditor default as the fallback, and is consumed', () => {
    for (const [name, def] of tokens) {
      const uses = [
        ...out.matchAll(new RegExp(`var\\(${name}, ([^)]+)\\)`, 'g')),
      ]
      expect(uses.length, `${name} unused`).toBeGreaterThan(0)
      for (const m of uses) expect(m[1], name).toBe(def)
    }
  })

  it('adds no !important and every replaced value is gone from its rule', () => {
    expect(count(out, '!important')).toBe(count(stock, '!important'))
    for (const [, find, replace] of patches) {
      expect(out).toContain(replace)
      expect(count(out, find)).toBe(0)
    }
  })

  it('throws, naming the patch, when an anchor is missing', () => {
    const [label, find] = patches[1]
    expect(() => varifyGeometryCss(stock.replace(find, ''))).toThrow(
      new RegExp(`\\[geometry\\] ${label.replace(/[>/+]/g, '.')}.*not found`),
    )
  })

  it('throws when an anchor matches more than once (count assertion)', () => {
    const [, find] = patches[0]
    expect(() => varifyGeometryCss(`${stock}\n${find}`)).toThrow(
      /matched 2 times/,
    )
  })

  it('is not idempotent by design: a second run finds no anchors', () => {
    expect(() => varifyGeometryCss(out)).toThrow(/not found/)
  })
})
