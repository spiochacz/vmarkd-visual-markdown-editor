import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs build helper, no type declarations
import {
  LUTE_HARD_BREAK_PATCHES,
  patchLuteBlob,
} from '../../scripts/lute-blob-patch.mjs'
import {
  bootLute,
  isLuteArtifactBuilt,
  luteArtifactPath,
} from './lute-artifact'

// Task 530 — the build-time Lute patch. These tests run on the VENDORED (pristine) blob, so a Lute
// re-pin that moves an anchor fails here with the same message the build gives.
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const vendored = fs.readFileSync(
  `${ROOT}/media-src/vendor/lute/lute.min.js`,
  'utf8',
)
const patched: string = patchLuteBlob(vendored)
const ANCHORS = LUTE_HARD_BREAK_PATCHES as [
  label: string,
  find: string,
  replace: string,
][]

const count = (src: string, needle: string) => src.split(needle).length - 1

describe('patchLuteBlob (task 530)', () => {
  it('has eight anchors', () => {
    expect(ANCHORS).toHaveLength(8)
  })

  describe.each(ANCHORS)('anchor %s', (_label, find, replace) => {
    it('occurs once in the vendored blob and its rewrite once in the patched one', () => {
      expect(count(vendored, find)).toBe(1)
      expect(count(patched, find)).toBe(0)
      expect(count(patched, replace)).toBe(1)
    })
    it('throws a re-derive message when missing', () => {
      expect(() => patchLuteBlob(vendored.replace(find, 'x'))).toThrow(
        /Lute changed; re-derive anchors \(see tasks\/done\/530/,
      )
    })
    it('throws when ambiguous', () => {
      expect(() => patchLuteBlob(`${vendored}\n${find}`)).toThrow(
        /matched 2\+ times/,
      )
    })
  })

  it('is idempotent', () => {
    expect(patchLuteBlob(patched)).toBe(patched)
  })

  it('the built media/ copy is exactly the patched vendored blob', () => {
    if (!isLuteArtifactBuilt(ROOT)) return // fresh clone before `node build.mjs`
    expect(fs.readFileSync(luteArtifactPath(ROOT), 'utf8')).toBe(patched)
  })

  it('Md2HTML is byte-identical to stock (the marker never reaches the HTML renderer)', () => {
    const md = 'a  \nb\\\nc   \nd'
    expect(bootLute(patched).New().Md2HTML(md)).toBe(
      bootLute(vendored).New().Md2HTML(md),
    )
  })
})
