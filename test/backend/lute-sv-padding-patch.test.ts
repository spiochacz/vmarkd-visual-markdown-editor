import {
  beforeAll,
  describe as vitestDescribe,
  expect,
  it as vitestIt,
} from 'vitest'
// @ts-expect-error — plain .mjs build helper, no type declarations
import { LUTE_SV_PADDING_PATCHES } from '../../scripts/lute-blob-patch.mjs'
import {
  type Anchors,
  bootRealLute,
  builtSource,
  describeAnchors,
  luteBuiltOrWarn,
  type RealLute,
  vendored,
} from './lute-patch-kit'

// Task 532 step 7 (sv) — a blank line inside a list item stays blank in the split-view source pane (no whitespace-only padding line).
// Anchors run on the VENDORED (pristine) blob; the corpus runs the BUILT media/ copy and the stock blob
// side by side, so each case pins both "patched keeps it" and "stock loses it".
describeAnchors(
  'lute-sv-padding anchors',
  LUTE_SV_PADDING_PATCHES as Anchors,
  3,
)

const LUTE_BUILT = luteBuiltOrWarn('lute-sv-padding')
const describe = LUTE_BUILT ? vitestDescribe : vitestDescribe.skip
const it = LUTE_BUILT ? vitestIt : vitestIt.skip

// sv's textContent is the markdown (tags carry no text; the line breaks live in hidden spans).
const svText = (l: RealLute, md: string) =>
  l
    .SpinVditorSVDOM(md)
    .replace(/<[^>]+>/g, '')
    .trimEnd()

const CORPUS: Record<string, string> = {
  'multi-paragraph item': '- a\n\n  para\n\n- b',
  'three paragraphs in one item': '- a\n\n  p\n\n  q\n\n- b',
  'ordered multi-paragraph item': '1. a\n\n   para',
  'nested multi-paragraph item': '- a\n  - x\n\n    more\n\n  - y\n- b',
  'task item with a second paragraph': '- [ ] a\n\n  para',
  'blank line inside fenced code in an item':
    '- a\n\n  ```js\n  x\n\n  y\n  ```\n\n- b',
  'non-ASCII text (byte-string safe)':
    '- é中😀\n\n  ż\n\n  ```\n  ą\n\n  ć\n  ```\n\n- b',
  'run of blank lines inside fenced code': '- ```\n  x\n\n\n  y\n  ```',
  'tight list (unchanged)': '- a\n- b\n- c',
  'loose list (unchanged)': '- a\n\n- b\n\n- c',
  'nested tight (unchanged)': '- a\n  - b\n    - c',
}

describe('sv list items keep blank lines blank (task 532 step 7)', () => {
  let stock: RealLute
  let fixed: RealLute
  beforeAll(() => {
    stock = bootRealLute(vendored)
    fixed = bootRealLute(builtSource())
  })

  it.each(Object.entries(CORPUS))(
    '%s: the pane text is byte-identical',
    (_n, md) => {
      expect(svText(fixed, md)).toBe(md)
    },
  )

  it('no list shape produces a whitespace-only line', () => {
    for (const md of Object.values(CORPUS)) {
      expect(svText(fixed, md)).not.toMatch(/^[ \t]+$/m)
    }
  })

  it('the stock blob emits "  " on the blank line (the defect this patch fixes)', () => {
    expect(svText(stock, CORPUS['multi-paragraph item'])).toMatch(/^[ \t]+$/m)
  })
})

// A blank line inside a blockquote is `>` in the sv pane, not `> ` (trailing space).
const QUOTE_CORPUS: Record<string, string> = {
  'two paragraphs': '> a\n>\n> b',
  'three paragraphs': '> a\n>\n> b\n>\n> c',
  'nested quote': '> a\n>\n> > x\n> >\n> > y\n>\n> z',
  'list inside a quote': '> - a\n>\n>   p\n>\n> - b',
  'quote inside a list item': '- x\n\n  > q\n  >\n  > r',
  'blank line inside fenced code in a quote': '> ```\n> a\n>\n> b\n> ```',
  'heading then paragraph': '> # h\n>\n> t',
  'no blank line (unchanged)': '> a\n> b',
}

describe('sv blockquote blank lines carry no trailing space (task 532 step 7)', () => {
  let stock: RealLute
  let fixed: RealLute
  beforeAll(() => {
    stock = bootRealLute(vendored)
    fixed = bootRealLute(builtSource())
  })
  const quoteText = (l: RealLute, md: string) =>
    svText(l, md).replace(/&gt;/g, '>')

  it.each(Object.entries(QUOTE_CORPUS))(
    '%s: the pane text is byte-identical',
    (_n, md) => {
      expect(quoteText(fixed, md)).toBe(md)
    },
  )

  it('the stock blob writes "> " on the blank line (the defect this patch fixes)', () => {
    expect(quoteText(stock, QUOTE_CORPUS['two paragraphs'])).toBe(
      '> a\n> \n> b',
    )
  })
})
