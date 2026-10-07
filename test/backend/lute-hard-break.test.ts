import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  beforeAll,
  describe as vitestDescribe,
  expect,
  it as vitestIt,
} from 'vitest'
import { patchLuteGapRepair } from '../../src/shared/lute-gap-repair'
import {
  applyHardBreakStyle,
  getHardBreakForm,
  keepLinePlaceholder,
  patchLuteHardBreaks,
} from '../../src/shared/lute-hard-break'
import {
  bootLute,
  isLuteArtifactBuilt,
  luteArtifactPath,
  warnLuteArtifactMissing,
} from './lute-artifact'

// Task 530 — a hard line break keeps its form through the (build-patched) Lute itself. These tests run
// the REAL patched blob in both modes: open + save, and one / three spins in between (a spin is what
// every keystroke does), plus the editing shapes the Shift+Enter handler produces.
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const LUTE_BUILT = isLuteArtifactBuilt(ROOT)
if (!LUTE_BUILT) warnLuteArtifactMissing('lute-hard-break (real Lute)', ROOT)
const describe = LUTE_BUILT ? vitestDescribe : vitestDescribe.skip
const it = LUTE_BUILT ? vitestIt : vitestIt.skip

interface RealLute {
  Md2VditorDOM(md: string): string
  Md2VditorIRDOM(md: string): string
  VditorDOM2Md(html: string): string
  VditorIRDOM2Md(html: string): string
  SpinVditorDOM(html: string): string
  SpinVditorIRDOM(html: string): string
  SetVditorWYSIWYG(v: boolean): void
  SetSpin(v: boolean): void
}

function boot(file: string, patch: boolean): RealLute {
  const l: RealLute = bootLute(fs.readFileSync(file, 'utf8')).New()
  l.SetVditorWYSIWYG(true)
  l.SetSpin(true)
  if (patch) {
    patchLuteGapRepair(l as never)
    patchLuteHardBreaks(l as never)
  }
  return l
}

let lute: RealLute
let stock: RealLute
beforeAll(() => {
  if (!LUTE_BUILT) return
  lute = boot(luteArtifactPath(ROOT), true)
  stock = boot(`${ROOT}/media-src/vendor/lute/lute.min.js`, false)
})

const trim = (s: string) => s.replace(/\n+$/, '')
type Mode = 'ir' | 'ww'
const MODES: Mode[] = ['ir', 'ww']
const build = (l: RealLute, m: Mode, md: string) =>
  m === 'ir' ? l.Md2VditorIRDOM(md) : l.Md2VditorDOM(md)
const save = (l: RealLute, m: Mode, html: string) =>
  m === 'ir' ? l.VditorIRDOM2Md(html) : l.VditorDOM2Md(html)
const spin = (l: RealLute, m: Mode, html: string) =>
  m === 'ir' ? l.SpinVditorIRDOM(html) : l.SpinVditorDOM(html)

/** open → (n × spin) → save: what the user's file holds after n keystrokes elsewhere in the doc. */
function roundTrip(m: Mode, md: string, spins = 0): string {
  let dom = build(lute, m, md)
  for (let i = 0; i < spins; i++) dom = spin(lute, m, dom)
  return trim(save(lute, m, dom))
}
const visible = (h: string) => h.replace(/<[^>]*>/g, '')

describe('keepLinePlaceholder (pure)', () => {
  const PB = '<br data-marker="\\" />'
  it('appends the placeholder at the end of the block of a pending break', () => {
    expect(keepLinePlaceholder(`<p>a${PB}<wbr></p>`)).toBe(
      `<p>a${PB}<wbr><br></p>`,
    )
  })
  it('decides over the whole block: closing inline tags between the caret and the block end', () => {
    expect(keepLinePlaceholder(`<p><strong>a${PB}<wbr></strong></p>`)).toBe(
      `<p><strong>a${PB}<wbr></strong><br></p>`,
    )
  })
  it('does nothing when text or an IR marker follows, or a placeholder is already there', () => {
    const tail = `<p>a${PB}<wbr>b</p>`
    expect(keepLinePlaceholder(tail)).toBe(tail)
    const marker = `<p>**a${PB}<wbr><span class="vditor-ir__marker">**</span></p>`
    expect(keepLinePlaceholder(marker)).toBe(marker)
    const have = `<p>a${PB}<wbr><br></p>`
    expect(keepLinePlaceholder(have)).toBe(have)
  })
  it('does nothing without a caret marker', () => {
    const h = `<p>a${PB}</p>`
    expect(keepLinePlaceholder(h)).toBe(h)
  })
  it('handles list items and several blocks independently', () => {
    expect(keepLinePlaceholder(`<li>a${PB}<wbr></li><p>b${PB}c</p>`)).toBe(
      `<li>a${PB}<wbr><br></li><p>b${PB}c</p>`,
    )
  })
  it('the default form follows the setting', () => {
    applyHardBreakStyle('spaces')
    expect(getHardBreakForm()).toBe('  ')
    applyHardBreakStyle('backslash')
    expect(getHardBreakForm()).toBe('\\')
    applyHardBreakStyle(undefined)
    expect(getHardBreakForm()).toBe('\\')
  })
})

const MIXED = [
  'Hard one  ',
  'hard two\\',
  'hard three',
  '',
  '> a quote',
  '',
  'Spaces three   ',
  'next',
  '',
  '- item a  ',
  '  item b\\',
  '  item c',
  '',
  'After list  ',
  'last',
].join('\n')

describe('forms survive open, spins and save (both modes)', () => {
  for (const m of MODES) {
    for (const spins of [0, 1, 3]) {
      it(`${m}: mixed document, ${spins} spins`, () => {
        expect(roundTrip(m, MIXED, spins)).toBe(MIXED)
      })
    }
    for (const n of [4, 5, 6, 9]) {
      for (const spins of [0, 1, 3]) {
        it(`${m}: a ${n}-space break through ${spins} spins`, () => {
          const md = `a${' '.repeat(n)}\nb`
          expect(roundTrip(m, md, spins)).toBe(md)
        })
      }
    }
    it(`${m}: glue case — a hard-broken paragraph followed by a quote / list in ONE call`, () => {
      const q = 'Hard one  \nhard two\\\nhard three\n\n> q'
      const l = 'Hard one  \nhard two\\\nhard three\n\n- i'
      expect(roundTrip(m, q)).toBe(q)
      expect(roundTrip(m, l)).toBe(l)
    })
    it(`${m}: breaks inside a quote and a list item`, () => {
      const md = '> a  \n> b\\\n> c\n\n- d  \n  e\\\n  f'
      expect(roundTrip(m, md, 1)).toBe(md)
    })
    it(`${m}: emphasis, strong and links across a break`, () => {
      for (const md of ['*a*  \n**b**\\\nc', '**a  \nb**', '[a  \nb](u)']) {
        expect(roundTrip(m, md, 1), md).toBe(md)
      }
    })
    it(`${m}: fenced code with trailing spaces / backslash is untouched`, () => {
      const md = 'p  \nq\n\n```\ncode  \nx\\\n```'
      expect(roundTrip(m, md, 1)).toBe(md)
      expect(build(lute, m, md).match(/data-marker="[ \\]/g)?.length).toBe(1)
    })
    it(`${m}: a table cell <br> stays a <br>`, () => {
      const md =
        '| h        | i |\n| -------- | - |\n| x<br />y | z |\n\na  \nb\n\nc\\\nd'
      expect(roundTrip(m, md, 1)).toBe(md)
    })
    it(`${m}: inline HTML <br /> typed by the user stays HTML next to real breaks`, () => {
      const md = 'a<br />b  \nc'
      expect(roundTrip(m, md)).toBe(md)
      expect(build(lute, m, md).match(/data-marker/g)?.length).toBe(1)
    })
  }
})

describe('documents that used to damage a break (both modes)', () => {
  // [label, markdown, what the saved text must still contain after open / one spin]
  const CASES: [string, string, string[]][] = [
    ['CRLF', 'a  \r\nb\\\r\nc', ['a  \nb\\\nc']],
    [
      'an HTML block preview with <br>',
      '<div>\nx<br>y\n</div>\n\na  \nb',
      ['a  \nb'],
    ],
    [
      'a nested <pre> in an HTML preview',
      '<div><pre>x</pre><br>y</div>\n\na  \nb',
      ['a  \nb'],
    ],
    ['a whitespace-only line', 'a  \n  \nb\\\nc', ['b\\\nc']],
    ['a whitespace-only quote line', '> a  \n>   \n> b\\\n> c', ['> b\\\n> c']],
    ['a marker-only text line', 'a\n2.  \nb\\\nc', ['2.  \nb\\\nc']],
    ['a marker-only text line (0.)', 'a\n0.  \nb\\\nc', ['0.  \nb\\\nc']],
    ['a marker-only text line (9))', 'a\n9)  \nb\\\nc', ['9)  \nb\\\nc']],
    ['a quoted thematic break', '> ---  \n> a\\\n> b', ['> a\\\n> b']],
    ['a quoted thematic break (***)', '> ***  \n> a\\\n> b', ['> a\\\n> b']],
    [
      'a nested quoted thematic break',
      '> > ---  \n> > a\\\n> > b',
      ['>> a\\\n>> b'],
    ],
    ['a literal private-use char before a break', 'a  \nb', ['a  \nb']],
    [
      'a literal private-use char before a soft break',
      'a\nb  \nc',
      ['a\nb  \nc'],
    ],
    ['a numeric entity next to a break', 'a&#57345;\nb  \nc', ['b  \nc']],
    [
      'a soft break next to hard ones',
      'soft one\nsoft two\\\nthree',
      ['soft one\nsoft two\\\nthree'],
    ],
    ['an escaped backslash before a newline', 'a\\\\\nb  \nc', ['b  \nc']],
  ]
  for (const m of MODES) {
    for (const [label, md, wants] of CASES) {
      for (const spins of [0, 1]) {
        it(`${m}: ${label} (${spins} spins)`, () => {
          const out = roundTrip(m, md, spins)
          for (const want of wants) expect(out).toContain(want)
        })
      }
    }
  }
})

describe('content after a break that is serializable but not visible text', () => {
  for (const m of MODES) {
    for (const form of ['\\', '  ']) {
      it(`${m}: a break before an image survives (${JSON.stringify(form)})`, () => {
        const md = `a${form}\n![](u)`
        expect(roundTrip(m, md, 1)).toBe(md)
      })
      it(`${m}: a break before a whitespace-only code span survives (${JSON.stringify(form)})`, () => {
        const md = `a${form}\n\` \` x`
        expect(roundTrip(m, md, 1)).toContain(`a${form}\n`)
      })
    }
  }
})

describe('editing shapes (the Shift+Enter handler and deletes)', () => {
  const P = (x: string) => `<p data-block="0">${x}</p>`
  const DM = '<br data-marker="\\" />'
  for (const m of MODES) {
    it(`${m}: a pending break at a block end keeps the break AND the line placeholder`, () => {
      const shifted = P('first<br data-marker="\\"><wbr><br>')
      const out = keepLinePlaceholder(spin(lute, m, shifted))
      expect(out).toBe(P(`first${DM}<wbr><br>`))
      // typing lands between the break and the placeholder: still ONE hard break
      const typed = out.replace('<wbr>', 'm<wbr>')
      const again = keepLinePlaceholder(spin(lute, m, typed))
      expect(again).toBe(P(`first${DM}m<wbr>`))
      expect(trim(save(lute, m, again.replace('<wbr>', '')))).toBe('first\\\nm')
    })

    it(`${m}: saving right after Shift+Enter writes plain "first" (no backslash, no ZWSP)`, () => {
      const out = keepLinePlaceholder(
        spin(lute, m, P('first<br data-marker="\\"><wbr><br>')),
      )
      const saved = save(lute, m, out.replace('<wbr>', ''))
      expect(trim(saved)).toBe('first')
      expect(saved).not.toContain('\u200b')
    })

    it(`${m}: a trailing marked break after deleting what followed leaves no literal backslash`, () => {
      const dom = build(lute, m, 'a\\\nb').replace('b</p>', '</p>')
      expect(trim(save(lute, m, dom))).toBe('a')
      expect(visible(spin(lute, m, dom))).not.toContain('\\')
    })

    it(`${m}: a trailing marked break after deleting an image / code span`, () => {
      const dom = build(lute, m, 'a  \n![](u)')
      const stripped = dom.replace(/<img[^>]*>/, '')
      if (m === 'ww') {
        expect(trim(save(lute, m, stripped))).not.toContain('\\')
        expect(visible(spin(lute, m, stripped))).not.toContain('\\')
      }
    })

    it(`${m}: two pending breaks, backslash form`, () => {
      const one = keepLinePlaceholder(
        spin(lute, m, P('first<br data-marker="\\"><wbr><br>')),
      )
      const two = one.replace('<wbr>', '<br data-marker="\\"><wbr>')
      const out = keepLinePlaceholder(spin(lute, m, two))
      const typed = keepLinePlaceholder(
        spin(lute, m, out.replace('<wbr>', 'm<wbr>')),
      )
      expect(trim(save(lute, m, typed.replace('<wbr>', '')))).toBe(
        'first\\\n\\\nm',
      )
    })

    it(`${m}: two pending breaks, spaces form (the second is a backslash on an empty line)`, () => {
      const one = keepLinePlaceholder(
        spin(lute, m, P('first<br data-marker="  "><wbr><br>')),
      )
      const two = one.replace('<wbr>', '<br data-marker="  "><wbr>')
      const out = keepLinePlaceholder(spin(lute, m, two))
      const typed = keepLinePlaceholder(
        spin(lute, m, out.replace('<wbr>', 'm<wbr>')),
      )
      expect(trim(save(lute, m, typed.replace('<wbr>', '')))).toBe(
        'first  \n\\\nm',
      )
    })

    it(`${m}: a break in the middle of a paragraph`, () => {
      const out = keepLinePlaceholder(
        spin(lute, m, P('ab<br data-marker="\\"><wbr>cd')),
      )
      expect(trim(save(lute, m, out.replace('<wbr>', '')))).toBe('ab\\\ncd')
    })

    it(`${m}: a break in a list item and a quote paragraph`, () => {
      for (const [md, at, want] of [
        ['- item\n', 'item', '- item\\\n  m'],
        ['> quoted\n', 'quoted', '> quoted\\\n> m'],
      ] as const) {
        const d = build(lute, m, md).replace(
          at,
          `${at}<br data-marker="\\"><wbr><br>`,
        )
        const s1 = keepLinePlaceholder(spin(lute, m, d))
        const s2 = keepLinePlaceholder(
          spin(lute, m, s1.replace('<wbr>', 'm<wbr>')),
        )
        expect(trim(save(lute, m, s2.replace('<wbr>', ''))), md).toBe(want)
      }
    })

    it(`${m}: a pending break inside **strong** at the end of a paragraph`, () => {
      const d = build(lute, m, '**bold**').replace(
        'bold',
        'bold<br data-marker="\\"><wbr><br>',
      )
      const s1 = keepLinePlaceholder(spin(lute, m, d))
      const s2 = keepLinePlaceholder(
        spin(lute, m, s1.replace('<wbr>', 'm<wbr>')),
      )
      expect(trim(save(lute, m, s2.replace('<wbr>', '')))).toContain('\\\nm')
    })

    it(`${m}: unmarked <br> shapes behave exactly like stock Lute`, () => {
      const SHAPES = [
        P('a<br>b'),
        P('a<br><br>b'),
        P('<code>a<br>b</code>'),
        '<h2 data-block="0">a<br>b</h2>',
        P('<strong>a<br></strong>'),
        P('a<br>'),
        P('<br>'),
      ]
      for (const h of SHAPES)
        expect(trim(save(lute, m, h)), h).toBe(trim(save(stock, m, h)))
    })

    it(`${m}: a marked break followed by a placeholder break is stock's two newlines`, () => {
      const a = trim(save(lute, m, P('a<br data-marker="  "><br>b')))
      const b = trim(save(stock, m, P('a<br><br>b')))
      expect(a).toBe(b)
    })

    it(`${m}: <wbr> survives a spin on a marked paragraph`, () => {
      const dom = build(lute, m, 'a  \nb')
      expect(spin(lute, m, dom.replace('b</p>', 'b<wbr></p>'))).toContain(
        '<wbr>',
      )
    })
  }

  it('patchLuteHardBreaks is idempotent and tolerant', () => {
    const l = boot(luteArtifactPath(ROOT), true)
    patchLuteHardBreaks(l as never)
    expect(trim(l.VditorIRDOM2Md(l.Md2VditorIRDOM('a  \nb')))).toBe('a  \nb')
    expect(() => patchLuteHardBreaks({} as never)).not.toThrow()
    expect(() => patchLuteHardBreaks(undefined)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Sentinels, protected source, atomic content, end-of-formatting breaks
// ---------------------------------------------------------------------------

describe('GopherJS byte-string sentinels in the format renderer', () => {
  const ZW = '\u200b'
  const P = (x: string) => `<p data-block="0">${x}</p>`
  for (const m of MODES) {
    it(`${m}: a ZWSP-only tail is NOT content: a break before it is a block-end break`, () => {
      // No caret: nothing meaningful follows → stock newline, never a literal backslash.
      expect(trim(save(lute, m, P(`a<br data-marker="\\" />${ZW}`)))).toBe('a')
    })
    it(`${m}: caret + ZWSP tail is a pending break and the spin keeps its form`, () => {
      const out = spin(lute, m, P(`a<br data-marker="\\" /><wbr>${ZW}`))
      expect(out).toContain('<br data-marker="\\"')
      expect(out).toContain('<wbr>')
    })
    it(`${m}: a ZWSP-only text before a spaces break makes it a backslash (a spaces-only line is blank)`, () => {
      expect(trim(save(lute, m, P(`${ZW}<br data-marker="  " />b`)))).toBe(
        '\\\nb',
      )
    })
    it(`${m}: NBSP is content, not whitespace`, () => {
      const out = save(lute, m, P('a<br data-marker="\\" />\u00a0'))
      expect(out).toContain('a\\\n')
    })
    it(`${m}: loose list item, immediate save — the whole document is byte-identical (following paragraph AND sibling item, ordered, no sibling)`, () => {
      for (const md of [
        '- item\n\n  other\n\n- last',
        '1. item\n\n   other\n\n2. last',
        '- item\n\n  other',
      ]) {
        const base = save(lute, m, build(lute, m, md))
        for (const form of ['\\', '  ']) {
          const d = build(lute, m, md).replace(
            'item',
            `item<br data-marker="${form}"><wbr><br>`,
          )
          const s1 = keepLinePlaceholder(spin(lute, m, d))
          expect(
            save(lute, m, s1.replace('<wbr>', '')),
            `${md} ${JSON.stringify(form)}`,
          ).toBe(base)
        }
      }
    })
  }
})

describe('marker-aware text serialization stays out of protected source', () => {
  type Html2 = {
    HTML2Md(h: string): string
    HTML2VditorDOM(h: string): string
    HTML2VditorIRDOM(h: string): string
  }
  const SHAPES = [
    '<pre><code>a<br data-marker="\\">b</code></pre>',
    '<pre><code>a<br>b</code></pre>',
    '<span data-type="code">a<br data-marker="\\">b</span>',
    '<span data-type="code">a<br>b</span>',
    '<span data-type="math-inline">a<br data-marker="\\">b</span>',
    '<span data-type="html-inline">a<br data-marker="\\">b</span>',
    '<kbd>a<br data-marker="\\">b</kbd>',
    '<kbd>a<br>b</kbd>',
    '<p><code>a<br data-marker="  ">b</code></p>',
  ]
  it('HTML2Md / HTML2VditorDOM / HTML2VditorIRDOM equal stock for marked and unmarked <br> under protected ancestors', () => {
    for (const h of SHAPES)
      for (const api of [
        'HTML2Md',
        'HTML2VditorDOM',
        'HTML2VditorIRDOM',
      ] as const) {
        const got = (lute as unknown as Html2)[api](h)
        const want = (stock as unknown as Html2)[api](h)
        expect(got, `${api} ${h}`).toBe(want)
      }
  })
  it('prose still carries the form through IR inline spans (strong across a break)', () => {
    expect(roundTrip('ir', '**a  \nb**', 1)).toBe('**a  \nb**')
  })
})

describe('the line placeholder never lands after atomic content', () => {
  const PB = '<br data-marker="\\" />'
  for (const atom of [
    '<img src="u">',
    '<svg></svg>',
    '<input type="checkbox">',
  ]) {
    it(`caret before ${atom}: no placeholder`, () => {
      const h = `<p>a${PB}<wbr>${atom}</p>`
      expect(keepLinePlaceholder(h)).toBe(h)
    })
  }
  it('closing inline tags, whitespace, ZWSP and breaks still count as an empty tail', () => {
    expect(keepLinePlaceholder(`<p><em>a${PB}<wbr></em> \u200b</p>`)).toBe(
      `<p><em>a${PB}<wbr></em> \u200b<br></p>`,
    )
  })
})

describe('a pending break at the end of inline formatting', () => {
  // The handler (hard-break-key.ts) puts the break AFTER the outermost formatting element that ends
  // at the caret; these are the DOMs it produces. Immediate save must keep the formatting.
  const CASES: [string, string][] = [
    ['strong', '**bold**'],
    ['emphasis', '*it*'],
    ['strikethrough', '~~gone~~'],
    ['nested', '***x***'],
    ['link label', '[label](u)'],
  ]
  for (const m of MODES) {
    for (const [name, md] of CASES) {
      for (const form of ['\\', '  ']) {
        it(`${m}: ${name} (${JSON.stringify(form)}) — immediate save and typing after`, () => {
          const dom = build(lute, m, md).replace(
            /<\/p>$/,
            `<br data-marker="${form}"><wbr><br></p>`,
          )
          const s1 = keepLinePlaceholder(spin(lute, m, dom))
          expect(trim(save(lute, m, s1.replace('<wbr>', '')))).toBe(md)
          const s2 = keepLinePlaceholder(
            spin(lute, m, s1.replace('<wbr>', 'm<wbr>')),
          )
          expect(trim(save(lute, m, s2.replace('<wbr>', '')))).toBe(
            `${md}${form === '\\' ? '\\' : '  '}\nm`,
          )
        })
      }
    }
  }
})

describe('an unfilled pending break contributes nothing to the whole document', () => {
  // What the document serializer (VditorDOM2Md / getValue) writes for a paragraph whose Shift+Enter
  // was never followed by typing: the marked break plus the browser's `<br>` placeholder, no caret.
  // It must be byte-identical to the same document without them.
  const CASES: [string, string][] = [
    ['a plain paragraph end', 'first\n\nsecond\n'],
    [
      'a loose list item (following paragraph AND sibling item)',
      '- item\n\n  other\n\n- last\n',
    ],
    ['a tight list item', '- item\n- last\n'],
    ['a blockquote paragraph', '> item\n\nafter\n'],
    ['the end of **bold** (break after the strong)', '**item**\n\nafter\n'],
  ]
  for (const m of MODES) {
    for (const [name, md] of CASES) {
      for (const form of ['\\', '  ']) {
        for (const breaks of [1, 2]) {
          it(`${m}: ${name}, ${JSON.stringify(form)} x${breaks}`, () => {
            const base = save(lute, m, build(lute, m, md))
            const br = `<br data-marker="${form}">`.repeat(breaks)
            const html = build(lute, m, md).replace(/<\/p>/, `${br}<br></p>`)
            // the break sits after the last text of the first block; for a list/quote that block is
            // the first <p> or, for a tight item, is closed by </li>
            const patched =
              html === build(lute, m, md)
                ? build(lute, m, md).replace(/<\/li>/, `${br}<br></li>`)
                : html
            expect(save(lute, m, patched)).toBe(base)
          })
        }
      }
    }
  }

  it('an unmarked <br> elsewhere stays exactly stock', () => {
    for (const m of MODES) {
      for (const h of [
        '<p data-block="0">a<br>b</p>',
        '<p data-block="0">a<br><br>b</p>',
        '<p data-block="0">a<br><br></p><p data-block="0">c</p>',
        '<p data-block="0">a<br></p><p data-block="0">c</p>',
      ])
        expect(save(lute, m, h), h).toBe(save(stock, m, h))
    }
  })
})
