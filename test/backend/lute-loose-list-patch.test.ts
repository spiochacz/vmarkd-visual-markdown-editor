import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  beforeAll,
  describe as vitestDescribe,
  expect,
  it as vitestIt,
} from 'vitest'
// @ts-expect-error — plain .mjs build helper, no type declarations
import {
  LUTE_LOOSE_LIST_PATCHES,
  patchLuteBlob,
} from '../../scripts/lute-blob-patch.mjs'
import { prewarmLute, reserializeMarkdown } from '../../src/lute/lute-host'
import {
  bootLute,
  isLuteArtifactBuilt,
  luteArtifactPath,
  waitForLuteWarm,
  warnLuteArtifactMissing,
} from './lute-artifact'

// Task 532 step 6 — a loose list (blank line between items) keeps its looseness through DOM -> markdown.
// The anchors run on the VENDORED (pristine) blob so a Lute re-pin that moves one fails here with the
// build's message; the corpus runs the BUILT media/ copy (the one the editor and the host ship) and the
// stock blob side by side, so each case pins both "patched keeps it" and "stock loses it".
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const vendored = fs.readFileSync(
  `${ROOT}/media-src/vendor/lute/lute.min.js`,
  'utf8',
)
const patched: string = patchLuteBlob(vendored)
const ANCHORS = LUTE_LOOSE_LIST_PATCHES as [
  label: string,
  find: string,
  replace: string,
][]
const count = (src: string, needle: string) => src.split(needle).length - 1

const LUTE_BUILT = isLuteArtifactBuilt(ROOT)
if (!LUTE_BUILT) warnLuteArtifactMissing('lute-loose-list (real Lute)', ROOT)
const describe = LUTE_BUILT ? vitestDescribe : vitestDescribe.skip
const it = LUTE_BUILT ? vitestIt : vitestIt.skip

describe('loose-list anchors (task 532 step 6)', () => {
  vitestIt('has three anchors', () => {
    expect(ANCHORS).toHaveLength(3)
  })

  vitestDescribe.each(ANCHORS)('anchor %s', (_label, find, replace) => {
    vitestIt(
      'occurs once in the vendored blob and its rewrite once in the patched one',
      () => {
        expect(count(vendored, find)).toBe(1)
        expect(count(patched, find)).toBe(0)
        expect(count(patched, replace)).toBe(1)
      },
    )
    vitestIt('throws a re-derive message when missing', () => {
      expect(() => patchLuteBlob(vendored.replace(find, 'x'))).toThrow(
        /Lute changed; re-derive anchors/,
      )
    })
    vitestIt('throws when ambiguous', () => {
      expect(() => patchLuteBlob(`${vendored}\n${find}`)).toThrow(
        /matched 2\+ times/,
      )
    })
  })

  it('the built media/ copy is exactly the patched vendored blob', () => {
    expect(fs.readFileSync(luteArtifactPath(ROOT), 'utf8')).toBe(patched)
  })
})

interface RealLute {
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

const boot = (src: string): RealLute => {
  const l: RealLute = bootLute(src).New()
  l.SetVditorWYSIWYG(true)
  l.SetSpin(true)
  return l
}

// Hand-written shapes that must come back byte-identical. (Task lists are covered through the host
// path below: their `[ ]  a` checkbox spacing is normalised by the existing canonical form.)
const CORPUS: Record<string, string> = {
  loose: '- a\n\n- b\n\n- c\n',
  tight: '- a\n- b\n- c\n',
  'loose, one item multi-paragraph': '- a\n\n  para\n\n- b\n',
  'nested: loose outer, tight inner': '- a\n\n  - x\n  - y\n\n- b\n',
  'nested: tight outer, loose inner': '- a\n  - x\n\n  - y\n- b\n',
  'ordered loose, start number': '3. a\n\n4. b\n',
  'ordered tight, start number': '3. a\n4. b\n',
  'loose list in a blockquote': '> - a\n>\n> - b\n',
  'code in a loose item': '- a\n\n  ```js\n  x\n  ```\n\n- b\n',
  'tight list, paragraph, loose list': '- a\n- b\n\ntext\n\n- c\n\n- d\n',
}

describe('loose lists survive DOM -> markdown (task 532 step 6)', () => {
  let stock: RealLute
  let fixed: RealLute
  beforeAll(() => {
    stock = boot(vendored)
    fixed = boot(fs.readFileSync(luteArtifactPath(ROOT), 'utf8'))
  })

  describe.each(Object.entries(CORPUS))('%s', (_name, md) => {
    it('IR: open + save is byte-identical, also after a spin', () => {
      const back = fixed.VditorIRDOM2Md(fixed.Md2VditorIRDOM(md))
      expect(back).toBe(md)
      expect(fixed.VditorIRDOM2Md(fixed.SpinVditorIRDOM(back))).toBe(md)
    })
    it('WYSIWYG: open + save is byte-identical, also after a spin', () => {
      const back = fixed.VditorDOM2Md(fixed.Md2VditorDOM(md))
      expect(back).toBe(md)
      expect(fixed.VditorDOM2Md(fixed.SpinVditorDOM(back))).toBe(md)
    })
  })

  it('split view (sv): the source pane keeps the blank lines between loose items', () => {
    // sv's textContent is the markdown (tags carry no text; the line breaks live in hidden spans).
    const svText = (l: RealLute, md: string) =>
      l
        .SpinVditorSVDOM(md)
        .replace(/<[^>]+>/g, '')
        .trimEnd()
    expect(svText(fixed, CORPUS.loose)).toBe('- a\n\n- b\n\n- c')
    expect(svText(fixed, CORPUS.tight)).toBe('- a\n- b\n- c')
    expect(svText(fixed, CORPUS['ordered loose, start number'])).toBe(
      '3. a\n\n4. b',
    )
    expect(svText(stock, CORPUS.loose)).toBe('- a\n- b\n- c') // the defect
  })

  it('the stock blob loses the blank lines (the defect this patch fixes)', () => {
    expect(stock.VditorIRDOM2Md(stock.Md2VditorIRDOM(CORPUS.loose))).toBe(
      CORPUS.tight,
    )
    expect(stock.VditorDOM2Md(stock.Md2VditorDOM(CORPUS.loose))).toBe(
      CORPUS.tight,
    )
  })

  it('an edit inside a loose list keeps it loose (IR and WYSIWYG)', () => {
    const edit = (html: string) => html.replace('>b<', '>bee<')
    expect(
      fixed.VditorIRDOM2Md(edit(fixed.Md2VditorIRDOM('- a\n\n- b\n\n- c\n'))),
    ).toBe('- a\n\n- bee\n\n- c\n')
    expect(
      fixed.VditorDOM2Md(edit(fixed.Md2VditorDOM('- a\n\n- b\n\n- c\n'))),
    ).toBe('- a\n\n- bee\n\n- c\n')
  })

  it('a list that declares data-tight="true" stays tight even with one wrapped item (task 391 shape)', () => {
    // list-tight.ts owns this contradiction; the patch must not flip it loose behind its back.
    const html =
      '<ul data-tight="true" data-marker="-" data-block="0"><li data-marker="-"><p data-block="0">a</p></li><li data-marker="-">b</li></ul>'
    expect(fixed.VditorIRDOM2Md(html)).toBe('- a\n- b\n')
    expect(fixed.VditorDOM2Md(html)).toBe('- a\n- b\n')
  })

  it('a Vditor-made list with no data-tight and bare items stays tight', () => {
    const html =
      '<ul data-marker="*" data-block="0"><li data-marker="*">a</li><li data-marker="*">b</li></ul>'
    expect(fixed.VditorIRDOM2Md(html)).toBe('* a\n* b\n')
  })
})

describe('host reserializeMarkdown keeps loose lists (task 532 step 6)', () => {
  beforeAll(async () => {
    prewarmLute(ROOT)
    await waitForLuteWarm()
  }, 30_000)

  it.each(Object.entries(CORPUS))('%s round-trips unedited', (_n, md) => {
    expect(reserializeMarkdown(ROOT, md)).toBe(md)
  })

  it('a task list keeps its looseness (its checkbox spacing is the existing canonical form, tight or loose)', () => {
    expect(reserializeMarkdown(ROOT, '- [ ] a\n- [x] b\n')).toBe(
      '- [ ]  a\n- [X]  b\n',
    )
    expect(reserializeMarkdown(ROOT, '- [ ] a\n\n- [x] b\n')).toBe(
      '- [ ]  a\n\n- [X]  b\n',
    )
  })
})
