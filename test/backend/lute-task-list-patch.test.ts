import {
  beforeAll,
  describe as vitestDescribe,
  expect,
  it as vitestIt,
} from 'vitest'
// @ts-expect-error — plain .mjs build helper, no type declarations
import { LUTE_TASK_LIST_PATCHES } from '../../scripts/lute-blob-patch.mjs'
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

// Task 532 step 7 — a task-list checkbox keeps its source form (`[x]` / `[X]` / `[ ]`, one space) through DOM -> markdown.
// Anchors run on the VENDORED (pristine) blob; the corpus runs the BUILT media/ copy and the stock blob
// side by side, so each case pins both "patched keeps it" and "stock loses it".
describeAnchors('lute-task-list anchors', LUTE_TASK_LIST_PATCHES as Anchors, 6)

const LUTE_BUILT = luteBuiltOrWarn('lute-task-list')
const describe = LUTE_BUILT ? vitestDescribe : vitestDescribe.skip
const it = LUTE_BUILT ? vitestIt : vitestIt.skip

// `[x]` and `[X]` come back as written; the checkbox is followed by exactly one space.
const CORPUS: Record<string, string> = {
  'unchecked, lowercase and uppercase x': '- [ ] a\n- [x] b\n- [X] c\n',
  'loose task list': '- [ ] a\n\n- [x] b\n\n- [X] c\n',
  'nested task list': '- [ ] a\n  - [x] b\n    - [X] c\n',
  'inline formatting first': '- [ ] **a** b\n- [x] *c*\n- [X] `d`\n',
  'ordered task list': '1. [x] a\n2. [ ] b\n',
}

describe('task-list checkboxes survive DOM -> markdown (task 532 step 7)', () => {
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
    it('sv: the source pane shows the checkbox as written', () => {
      const text = fixed
        .SpinVditorSVDOM(md)
        .replace(/<[^>]+>/g, '')
        .trimEnd()
      expect(text).toBe(md.trimEnd())
    })
  })

  it('the stock blob double-spaces (IR) and upper-cases the x (the defect this patch fixes)', () => {
    expect(
      stock.VditorIRDOM2Md(stock.Md2VditorIRDOM('- [ ] a\n- [x] b\n')),
    ).toBe('- [ ]  a\n- [X]  b\n')
  })

  it('an edit inside a task item keeps the checkbox form (IR and WYSIWYG)', () => {
    const edit = (html: string) => html.replace(' b<', ' bee<')
    const md = '- [ ] a\n- [x] b\n- [X] c\n'
    expect(fixed.VditorIRDOM2Md(edit(fixed.Md2VditorIRDOM(md)))).toBe(
      '- [ ] a\n- [x] bee\n- [X] c\n',
    )
    expect(fixed.VditorDOM2Md(edit(fixed.Md2VditorDOM(md)))).toBe(
      '- [ ] a\n- [x] bee\n- [X] c\n',
    )
  })

  it('toggling the box in the DOM rewrites the marker (checked <-> unchecked)', () => {
    const html = fixed.Md2VditorIRDOM('- [X] a\n- [ ] b\n')
    const toggled = html
      .replace(' checked=""', '') // a: checked -> unchecked (keeps its stale data-task="X")
      .replace(
        '<input type="checkbox" /> b',
        '<input checked="" type="checkbox" /> b',
      )
    expect(fixed.VditorIRDOM2Md(toggled)).toBe('- [ ] a\n- [x] b\n')
    expect(fixed.VditorDOM2Md(toggled)).toBe('- [ ] a\n- [x] b\n')
  })

  it('a DOM checkbox with no recorded marker is written as a lowercase x', () => {
    const html =
      '<ul data-tight="true" data-marker="-" data-block="0"><li data-marker="-" class="vditor-task"><input checked="" type="checkbox" /> a</li></ul>'
    expect(fixed.VditorIRDOM2Md(html)).toBe('- [x] a\n')
    expect(fixed.VditorDOM2Md(html)).toBe('- [x] a\n')
  })
})

describe('host reserializeMarkdown keeps task-list checkboxes (task 532 step 7)', () => {
  beforeAll(async () => {
    prewarmLute(ROOT)
    await waitForLuteWarm()
  }, 30_000)

  it.each(Object.entries(CORPUS))('%s round-trips unedited', (_n, md) => {
    expect(reserializeMarkdown(ROOT, md)).toBe(md)
  })
})
