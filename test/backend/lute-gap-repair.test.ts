import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as vm from 'node:vm'
import {
  beforeAll,
  describe as vitestDescribe,
  expect,
  it as vitestIt,
  vi,
} from 'vitest'
import {
  dropInsertedCodeGaps,
  inlineCodeGaps,
  patchLuteGapRepair,
  repairWysiwygDom,
  restoreCellGaps,
} from '../../src/shared/lute-gap-repair'
import {
  isLuteArtifactBuilt,
  luteArtifactPath,
  warnLuteArtifactMissing,
} from './lute-artifact'

const ZWSP = '​'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// task 476: this file boots the real Lute build artifact SYNCHRONOUSLY in the beforeAll below.
// On a fresh clone before `node build.mjs` that file doesn't exist yet — skip every test here
// LOUDLY instead of letting `fs.readFileSync` throw a raw ENOENT deep in the hook. This file's
// tests are flat at module scope (not nested under one wrapping describe), so `describe`/`it`
// are shadowed here rather than wrapping each call site in `describe.skipIf`.
const LUTE_BUILT = isLuteArtifactBuilt(ROOT)
if (!LUTE_BUILT)
  warnLuteArtifactMissing('lute-gap-repair (real Lute round-trip)', ROOT)
const describe = LUTE_BUILT ? vitestDescribe : vitestDescribe.skip
const it = LUTE_BUILT ? vitestIt : vitestIt.skip

// WASM boot is CPU-bound and its cost scales with machine contention, not code — give the hook
// a ceiling sized for a busy box, not an idle one (task 476).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// ---------------------------------------------------------------------------
// Pure string layer — no Lute needed.
// ---------------------------------------------------------------------------

describe('inlineCodeGaps', () => {
  it('reads the gap of each inline code span in document order', () => {
    expect(
      inlineCodeGaps('<p>a<code>b</code> and c <code>d</code></p>'),
    ).toEqual([false, true])
  })

  it('ignores fenced code blocks', () => {
    const html =
      '<pre><code class="language-js">x</code></pre>\n<p>a<code>b</code></p>'
    expect(inlineCodeGaps(html)).toEqual([false])
  })

  it('ignores a fenced block without a language (also a bare <code>)', () => {
    expect(inlineCodeGaps('<pre><code>x</code></pre>')).toEqual([])
  })

  it('counts a soft line break as a gap — removing one would join two lines', () => {
    expect(inlineCodeGaps('<p>a\n<code>b</code></p>')).toEqual([true])
  })

  it('treats a code span at the start of a block as un-gapped', () => {
    expect(inlineCodeGaps('<p><code>b</code>a</p>')).toEqual([false])
  })
})

describe('dropInsertedCodeGaps', () => {
  const wysiwyg = (before: string) =>
    `<p data-block="0">${before}<code data-marker="\`">${ZWSP}b</code>${ZWSP}</p>`

  it('replaces an invented space with a ZWSP', () => {
    expect(
      dropInsertedCodeGaps(wysiwyg('a '), () => '<p>a<code>b</code></p>'),
    ).toBe(wysiwyg(`a${ZWSP}`))
  })

  it('is length-preserving — the caret/offset arithmetic must not shift', () => {
    const html = wysiwyg('a ')
    expect(
      dropInsertedCodeGaps(html, () => '<p>a<code>b</code></p>'),
    ).toHaveLength(html.length)
  })

  it('keeps a space the source really has', () => {
    const html = wysiwyg('a ')
    expect(dropInsertedCodeGaps(html, () => '<p>a <code>b</code></p>')).toBe(
      html,
    )
  })

  it('never calls the oracle when there is no space to undo', () => {
    let calls = 0
    const html = wysiwyg(`a${ZWSP}`)
    expect(
      dropInsertedCodeGaps(html, () => {
        calls++
        return '<p>a<code>b</code></p>'
      }),
    ).toBe(html)
    expect(calls).toBe(0)
  })

  it('repairs only the invented one when a block mixes both', () => {
    const html =
      `<p data-block="0">x <code data-marker="\`">${ZWSP}a</code>${ZWSP}y ` +
      `<code data-marker="\`">${ZWSP}b</code>${ZWSP}</p>`
    const out = dropInsertedCodeGaps(
      html,
      () => '<p>x<code>a</code>y <code>b</code></p>',
    )
    expect(out).toContain(`x${ZWSP}<code`)
    expect(out).toContain('y <code')
  })

  it('bails out unchanged when the oracle disagrees about the code-span count', () => {
    const html = wysiwyg('a ')
    expect(dropInsertedCodeGaps(html, () => '<p>plain prose</p>')).toBe(html)
  })

  it('bails out unchanged when the oracle throws or returns nothing', () => {
    const html = wysiwyg('a ')
    expect(
      dropInsertedCodeGaps(html, () => {
        throw new Error('cold lute')
      }),
    ).toBe(html)
    expect(dropInsertedCodeGaps(html, () => undefined)).toBe(html)
  })

  it('leaves a fenced code block alone (no data-marker on its <code>)', () => {
    const html =
      '<div class="vditor-wysiwyg__block" data-type="code-block"><pre><code class="language-js">let a</code></pre></div>'
    expect(
      dropInsertedCodeGaps(
        html,
        () => '<pre><code class="language-js">let a</code></pre>',
      ),
    ).toBe(html)
  })
})

describe('patchLuteGapRepair', () => {
  it('wraps each builder once and leaves the reader alone', () => {
    const lute: Record<string, unknown> = {
      Md2VditorDOM: (md: string) => `dom:${md}`,
      SpinVditorDOM: (html: string) => `spin:${html}`,
      VditorDOM2Md: (html: string) => `md:${html}`,
      Md2HTML: (md: string) => `html:${md}`,
    }
    const readerBefore = lute.VditorDOM2Md
    const builderBefore = lute.Md2VditorDOM
    patchLuteGapRepair(lute as never)
    patchLuteGapRepair(lute as never)
    expect(lute.VditorDOM2Md).toBe(readerBefore)
    expect(lute.Md2VditorDOM).not.toBe(builderBefore)
    // Idempotent: a second patch must not double-wrap (the guard flag).
    const afterFirst = lute.Md2VditorDOM
    patchLuteGapRepair(lute as never)
    expect(lute.Md2VditorDOM).toBe(afterFirst)
  })

  it('tolerates a Lute without the wysiwyg builders (IR-only instance)', () => {
    const lute = { VditorDOM2Md: () => '', Md2HTML: () => '' }
    expect(() => patchLuteGapRepair(lute as never)).not.toThrow()
  })

  it('feeds each builder the right oracle — the markdown ITS output came from', () => {
    const invented = `<p data-block="0">a <code data-marker="\`">${ZWSP}b</code>${ZWSP}</p>`
    const seen: string[] = []
    const lute = {
      Md2VditorDOM: () => invented,
      SpinVditorDOM: () => invented,
      // Spin is md-mediated: the oracle has to go through THIS first.
      VditorDOM2Md: () => 'a`b`',
      Md2HTML: (md: string) => {
        seen.push(md)
        return '<p>a<code>b</code></p>'
      },
    }
    patchLuteGapRepair(lute as never)
    expect(lute.Md2VditorDOM('a`b`')).toContain(`a${ZWSP}<code`)
    expect(lute.SpinVditorDOM(invented)).toContain(`a${ZWSP}<code`)
    // Md2VditorDOM's oracle is its own argument; the spin's is VditorDOM2Md of its input.
    expect(seen).toEqual(['a`b`', 'a`b`'])
  })

  it('wraps the IR pair too, each with its own oracle', () => {
    const trimmed =
      '<table><tbody><tr><td>a<span data-type="strong">b</span></td></tr></tbody></table>'
    const oracle =
      '<table><tbody><tr><td>a <strong>b</strong></td></tr></tbody></table>'
    const seen: string[] = []
    const lute = {
      Md2VditorIRDOM: () => trimmed,
      SpinVditorIRDOM: () => trimmed,
      VditorIRDOM2Md: () => '| a **b** |',
      VditorDOM2Md: () => '',
      Md2HTML: (md: string) => {
        seen.push(md)
        return oracle
      },
    }
    patchLuteGapRepair(lute as never)
    expect(lute.Md2VditorIRDOM('| a **b** |')).toContain('>a <span')
    expect(lute.SpinVditorIRDOM(trimmed)).toContain('>a <span')
    expect(seen).toEqual(['| a **b** |', '| a **b** |'])
  })

  it('renders the oracle at most once per repaired WYSIWYG output', () => {
    // Both WYSIWYG repairs run on the same output; they must share one oracle render.
    let calls = 0
    const html =
      `<table><tbody><tr><td>a<strong>b</strong></td>` +
      `<td>c <code data-marker="\`">${ZWSP}d</code>${ZWSP}</td></tr></tbody></table>`
    const out = repairWysiwygDom(html, () => {
      calls++
      return '<table><tbody><tr><td>a <strong>b</strong></td><td>c<code>d</code></td></tr></tbody></table>'
    })
    expect(calls).toBe(1)
    expect(out).toContain('>a <strong') // cell gap restored
    expect(out).toContain(`c${ZWSP}<code`) // invented code space taken back out
  })

  it('survives an oracle that throws inside the shared render', () => {
    const html = `<p>a <code data-marker="\`">${ZWSP}b</code>${ZWSP}</p>`
    expect(
      repairWysiwygDom(html, () => {
        throw new Error('cold lute')
      }),
    ).toBe(html)
  })

  it('reads the reader off the instance at CALL time, so later wrappers apply', () => {
    const invented = `<p data-block="0">a <code data-marker="\`">${ZWSP}b</code>${ZWSP}</p>`
    const lute: Record<string, unknown> = {
      SpinVditorDOM: () => invented,
      VditorDOM2Md: () => 'a `b`',
      Md2HTML: (md: string) =>
        md.includes('a `b`')
          ? '<p>a <code>b</code></p>'
          : '<p>a<code>b</code></p>',
    }
    patchLuteGapRepair(lute as never)
    // Wrapped AFTER us, the way wiki-serialize.ts / wysiwyg-code-highlight.ts do it.
    lute.VditorDOM2Md = () => 'a`b`'
    expect((lute.SpinVditorDOM as (h: string) => string)(invented)).toContain(
      `a${ZWSP}<code`,
    )
  })
})

describe('restoreCellGaps', () => {
  const irCell = (prefix: string) =>
    `<table><tbody><tr><td>x</td><td>${prefix}<span data-type="code" class="vditor-ir__node">c</span></td></tr></tbody></table>`
  const oracleCell = (prefix: string) =>
    `<table><tbody><tr><td>x</td><td>${prefix}<code>c</code></td></tr></tbody></table>`

  it('puts back the space Lute dropped in front of a cell element', () => {
    expect(restoreCellGaps(irCell('a'), () => oracleCell('a '))).toBe(
      irCell('a '),
    )
  })

  it('restores the source whitespace verbatim (tab, double space)', () => {
    expect(restoreCellGaps(irCell('a'), () => oracleCell('a\t'))).toBe(
      irCell('a\t'),
    )
    expect(restoreCellGaps(irCell('a'), () => oracleCell('a  '))).toBe(
      irCell('a  '),
    )
  })

  it('adds nothing when the source has no whitespace there', () => {
    expect(restoreCellGaps(irCell('a'), () => oracleCell('a'))).toBe(
      irCell('a'),
    )
  })

  it('never calls the oracle for a plain-text cell', () => {
    let calls = 0
    const html = '<table><tbody><tr><td>plain text</td></tr></tbody></table>'
    expect(
      restoreCellGaps(html, () => {
        calls++
        return html
      }),
    ).toBe(html)
    expect(calls).toBe(0)
  })

  it('bails out when the cell counts disagree', () => {
    expect(restoreCellGaps(irCell('a'), () => '<p>not a table</p>')).toBe(
      irCell('a'),
    )
  })

  it('bails out when the prefix is not the oracle minus its whitespace', () => {
    expect(restoreCellGaps(irCell('a'), () => oracleCell('DIFFERENT '))).toBe(
      irCell('a'),
    )
  })

  it('handles a cell that carries an alignment attribute', () => {
    const ir =
      '<table><tbody><tr><td align="left">a<span data-type="code">c</span></td></tr></tbody></table>'
    const oracle =
      '<table><tbody><tr><td align="left">a <code>c</code></td></tr></tbody></table>'
    expect(restoreCellGaps(ir, () => oracle)).toContain('>a <span')
  })
})

// ---------------------------------------------------------------------------
// Against the REAL vendored Lute, in the same isolated vm the host uses. This
// is the layer that proves the repair, not the shape of the strings.
// ---------------------------------------------------------------------------

interface RealLute {
  Md2VditorDOM(md: string): string
  Md2VditorIRDOM(md: string): string
  Md2HTML(md: string): string
  VditorDOM2Md(html: string): string
  VditorIRDOM2Md(html: string): string
  SpinVditorDOM(html: string): string
  SpinVditorIRDOM(html: string): string
  SetVditorWYSIWYG(v: boolean): void
  SetSpin(v: boolean): void
}

let lute: RealLute
/** WYSIWYG round-trip, repaired — what the editor writes back after a mode switch. */
let wysiwygRoundTrip: (md: string) => string
/** IR round-trip — the canonical form the minimal-diff write-back compares against. */
let irRoundTrip: (md: string) => string

beforeAll(() => {
  if (!LUTE_BUILT) return // every test in this file is already skipped above
  const src = fs.readFileSync(luteArtifactPath(ROOT), 'utf8')
  const sandbox: Record<string, unknown> = {
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'lute.min.js' })
  lute = (sandbox as { Lute: { New(): RealLute } }).Lute.New()
  lute.SetVditorWYSIWYG(true)
  lute.SetSpin(true)
  const trim = (s: string) => s.replace(/\n+$/, '')
  wysiwygRoundTrip = (md) =>
    trim(
      lute.VditorDOM2Md(
        repairWysiwygDom(lute.Md2VditorDOM(md), () => lute.Md2HTML(md)),
      ),
    )
  irRoundTrip = (md) =>
    trim(
      lute.VditorIRDOM2Md(
        restoreCellGaps(lute.Md2VditorIRDOM(md), () => lute.Md2HTML(md)),
      ),
    )
})

describe('the WYSIWYG round-trip, repaired', () => {
  // The whole defect: every one of these gained a space before the fix.
  it.each([
    'a`b`',
    'a`b`c',
    'foo`bar`baz',
    'text`code` and `more` end',
    'a``b``c',
    '**a**`b`',
    'a *b*`c`',
    '# head`x`',
    '> quote`x`',
    '[l`x`](u)',
    '- item`x`\n- two `y`',
    'CJK中文`code`',
  ])('stops inventing a space in %j', (md) => {
    expect(wysiwygRoundTrip(md)).toBe(irRoundTrip(md))
  })

  // The other direction — over-correcting would be a worse bug than the one fixed.
  it.each([
    'a `b`',
    'a  `b`',
    '`b`',
    '`b`a',
    'a\n`b`',
    '```\nfenced`x`\n```',
    'a\\`b`c`',
  ])('leaves %j exactly as the source has it', (md) => {
    expect(wysiwygRoundTrip(md)).toBe(irRoundTrip(md))
  })

  it('makes the document a semantic no-op again, which is what the write-back reads', () => {
    // The measured symptom (tasks/370): one keystroke after a mode switch rewrote 88 characters.
    // What decides that is isSemanticNoop — both sides reserialized through the IR path. Column
    // padding and other reflow differences wash out there (they are re-normalized on both sides),
    // so this is the assertion that maps onto the file: before, the editor's output was NOT a
    // no-op against the source and the blocks were rewritten; after, it is and the original bytes
    // are kept.
    const md = [
      '| engine | note |',
      '|---|---|',
      '| graphviz | plain cell |',
      '',
      'SVG post-processing`currentColor` is the reported line.',
      '',
    ].join('\n')
    const reserialize = (s: string) =>
      lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(s))
    const raw = lute.VditorDOM2Md(lute.Md2VditorDOM(md))
    expect(reserialize(raw)).not.toBe(reserialize(md)) // the bug
    expect(reserialize(wysiwygRoundTrip(md))).toBe(reserialize(md)) // the fix
  })
})

describe('the IR round-trip in a table cell, repaired', () => {
  const cell = (content: string) => `| h | n |\n|---|---|\n| x | ${content} |\n`
  const rowOf = (md: string) => irRoundTrip(md).split('\n')[2]

  // Every inline type loses its space before the fix — this is NOT an inline-code defect.
  it.each([
    'a `b`',
    'a **b**',
    'a *b*',
    'a [l](u)',
    'a $x$',
    'a ~~s~~',
    'a ![i](u)',
    'a `b` c `d` e',
  ])('keeps the space in front of the first element: %j', (content) => {
    expect(rowOf(cell(content))).toContain(content)
  })

  it('restores the source whitespace verbatim, not a normalised single space', () => {
    expect(rowOf(cell('a  `b`'))).toContain('a  `b`')
    expect(rowOf(cell('a\t`b`'))).toContain('a\t`b`')
  })

  it.each(['a`b`', '`b` a', 'plain text', 'a\\|b `c`'])(
    'invents nothing for %j',
    (content) => {
      expect(rowOf(cell(content))).toContain(content)
    },
  )

  it('repairs header cells too', () => {
    expect(irRoundTrip('| a `x` | n |\n|---|---|\n| p | q |\n')).toContain(
      'a `x`',
    )
  })

  it('survives the spin — SpinVditorIRDOM re-deletes it on every keystroke', () => {
    const md = cell('a `b` c')
    let dom = restoreCellGaps(lute.Md2VditorIRDOM(md), () => lute.Md2HTML(md))
    for (let i = 0; i < 3; i++) {
      dom = restoreCellGaps(lute.SpinVditorIRDOM(dom), () =>
        lute.Md2HTML(lute.VditorIRDOM2Md(dom)),
      )
    }
    expect(lute.VditorIRDOM2Md(dom)).toContain('a `b` c')
  })

  it('agrees with the WYSIWYG side, so a mode switch is neutral for tables too', () => {
    const md = cell('a `b` and **c**')
    expect(rowOf(md)).toContain('a `b` and **c**')
    expect(wysiwygRoundTrip(md).split('\n')[2]).toContain('a `b` and **c**')
  })

  // Task 526: the Lute pin at 591a695 (lute#231) no longer trims the cell in the WYSIWYG
  // builder, so the unrepaired output already keeps the space. Before that pin it was lost for every
  // inline type and repairWysiwygDom had to restore it. The repair stays as a safety net; here we
  // pin that the repaired output is unchanged either way.
  it.each(['a **b**', 'a *b*', 'a [l](u)', 'a $x$', 'a ~~s~~'])(
    'the WYSIWYG builder keeps the cell space (engine fix, lute#231), repair is a no-op: %j',
    (content) => {
      const md = cell(content)
      expect(lute.VditorDOM2Md(lute.Md2VditorDOM(md)).split('\n')[2]).toContain(
        content,
      ) // unrepaired: the space is already there
      expect(wysiwygRoundTrip(md).split('\n')[2]).toContain(content)
    },
  )

  it('keeps two spaces before inline code in a cell, the old residual is gone', () => {
    // Before the 526 pin Lute trimmed both and re-added exactly one (a known residual that was
    // pinned here as a single space). The new engine keeps the source whitespace.
    expect(wysiwygRoundTrip(cell('a  `b`')).split('\n')[2]).toContain('a  `b`')
    expect(rowOf(cell('a  `b`'))).toContain('a  `b`') // IR keeps both
  })
})

describe('the spin repair (every keystroke)', () => {
  const spin = (html: string) =>
    repairWysiwygDom(lute.SpinVditorDOM(html), () =>
      lute.Md2HTML(lute.VditorDOM2Md(html)),
    )
  const build = (md: string) =>
    repairWysiwygDom(lute.Md2VditorDOM(md), () => lute.Md2HTML(md))

  it('is stable — spin re-inserts the space, the repair keeps taking it back out', () => {
    let dom = build('x`a`y `b`')
    for (let i = 0; i < 3; i++) dom = spin(dom)
    expect(lute.VditorDOM2Md(dom).replace(/\n+$/, '')).toBe('x`a`y `b`')
  })

  it('handles the keystroke that CREATES the code span (typing the closing backtick)', () => {
    const typed = '<p data-block="0">a`b`<wbr></p>'
    expect(lute.VditorDOM2Md(spin(typed)).replace(/\n+$/, '')).toBe('a`b`')
  })

  it('keeps a genuine space through that same keystroke', () => {
    const typed = '<p data-block="0">a `b`<wbr></p>'
    expect(lute.VditorDOM2Md(spin(typed)).replace(/\n+$/, '')).toBe('a `b`')
  })

  it('keeps the caret marker where it was', () => {
    const dom = `<p data-block="0">a<wbr><code data-marker="\`">${ZWSP}b</code>${ZWSP}</p>`
    expect(spin(dom)).toContain('a<wbr>')
    expect(spin(dom)).not.toContain('<wbr> <code')
  })
})
