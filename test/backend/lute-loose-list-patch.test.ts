import {
  beforeAll,
  describe as vitestDescribe,
  expect,
  it as vitestIt,
} from 'vitest'
// @ts-expect-error — plain .mjs build helper, no type declarations
import { LUTE_LOOSE_LIST_PATCHES } from '../../scripts/lute-blob-patch.mjs'
import { prewarmLute, reserializeMarkdown } from '../../src/lute/lute-host'
import { waitForLuteWarm } from './lute-artifact'
import {
  type Anchors,
  bootRealLute,
  builtSource,
  describeAnchors,
  luteBuiltOrWarn,
  ROOT,
  type RealLute,
  vendored,
} from './lute-patch-kit'

// Task 532 step 6 — a loose list (blank line between items) keeps its looseness through DOM -> markdown.
// Anchors run on the VENDORED (pristine) blob; the corpus runs the BUILT media/ copy and the stock blob
// side by side, so each case pins both "patched keeps it" and "stock loses it".
describeAnchors(
  'loose-list anchors (task 532 step 6)',
  LUTE_LOOSE_LIST_PATCHES as Anchors,
  3,
)

const LUTE_BUILT = luteBuiltOrWarn('lute-loose-list')
const describe = LUTE_BUILT ? vitestDescribe : vitestDescribe.skip
const it = LUTE_BUILT ? vitestIt : vitestIt.skip

// Hand-written shapes that must come back byte-identical.
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
    stock = bootRealLute(vendored)
    fixed = bootRealLute(builtSource())
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

  it('a task list keeps its looseness, tight or loose (checkbox form: lute-task-list-patch.test.ts)', () => {
    expect(reserializeMarkdown(ROOT, '- [ ] a\n- [x] b\n')).toBe(
      '- [ ] a\n- [x] b\n',
    )
    expect(reserializeMarkdown(ROOT, '- [ ] a\n\n- [x] b\n')).toBe(
      '- [ ] a\n\n- [x] b\n',
    )
  })
})
