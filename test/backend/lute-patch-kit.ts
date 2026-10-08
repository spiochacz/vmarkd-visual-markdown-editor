import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs build helper, no type declarations
import { patchLuteBlob } from '../../scripts/lute-blob-patch.mjs'
import {
  bootLute,
  isLuteArtifactBuilt,
  luteArtifactPath,
  warnLuteArtifactMissing,
} from './lute-artifact'

// Shared by the lute-*-patch tests (tasks 532 steps 6-7): the pristine vs patched blob, the anchor
// contract suite, and a booted real Lute.
export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const vendored = fs.readFileSync(
  `${ROOT}/media-src/vendor/lute/lute.min.js`,
  'utf8',
)
const patched: string = patchLuteBlob(vendored)
export const builtSource = () => fs.readFileSync(luteArtifactPath(ROOT), 'utf8')

export type Anchors = [label: string, find: string, replace: string][]

const count = (src: string, needle: string) => src.split(needle).length - 1

/** False (after a loud warning) when `node build.mjs` has not produced the media/ copy yet. */
export function luteBuiltOrWarn(label: string): boolean {
  const built = isLuteArtifactBuilt(ROOT)
  if (!built) warnLuteArtifactMissing(`${label} (real Lute)`, ROOT)
  return built
}

/** The per-anchor contract: found once in the pristine blob, rewritten once, loud when missing or ambiguous. */
export function describeAnchors(
  title: string,
  anchors: Anchors,
  expected: number,
): void {
  describe(title, () => {
    it(`has ${expected} anchors`, () => {
      expect(anchors).toHaveLength(expected)
    })

    describe.each(anchors)('anchor %s', (_label, find, replace) => {
      it('occurs once in the vendored blob and its rewrite once in the patched one', () => {
        expect(count(vendored, find)).toBe(1)
        expect(count(patched, find)).toBe(0)
        expect(count(patched, replace)).toBe(1)
      })
      it('throws a re-derive message when missing', () => {
        expect(() => patchLuteBlob(vendored.replace(find, 'x'))).toThrow(
          /Lute changed; re-derive anchors/,
        )
      })
      it('throws when ambiguous', () => {
        expect(() => patchLuteBlob(`${vendored}\n${find}`)).toThrow(
          /matched 2\+ times/,
        )
      })
    })

    it.skipIf(!isLuteArtifactBuilt(ROOT))(
      'the built media/ copy is exactly the patched vendored blob',
      () => {
        expect(builtSource()).toBe(patched)
      },
    )
  })
}

export interface RealLute {
  Md2VditorDOM(md: string): string
  Md2VditorIRDOM(md: string): string
  VditorDOM2Md(html: string): string
  VditorIRDOM2Md(html: string): string
  SpinVditorDOM(html: string): string
  SpinVditorIRDOM(html: string): string
  SpinVditorSVDOM(md: string): string
  SetVditorWYSIWYG(v: boolean): void
  SetSpin(v: boolean): void
}

export const bootRealLute = (src: string): RealLute => {
  const l: RealLute = bootLute(src).New()
  l.SetVditorWYSIWYG(true)
  l.SetSpin(true)
  return l
}
