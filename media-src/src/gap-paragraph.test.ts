// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  TRAILING_ACTIVE_CLASS,
  cleanupGapParagraphs,
  ensureTrailingParagraph,
  markTrailingActive,
} from './gap-paragraph'

const TRAILING = 'data-vmarkd-trailing'
const ZWSP = '​'

function editorWith(innerHTML: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = innerHTML
  document.body.replaceChildren(el)
  return el
}
const lastTag = (el: HTMLElement) => el.lastElementChild?.tagName
const trailingPs = (el: HTMLElement) =>
  el.querySelectorAll(`:scope > p[${TRAILING}]`)

beforeEach(() => {
  document.body.replaceChildren()
})

// The user's bug: a document ending in a NORMAL blockquote (or any block Vditor's IR
// processKeydown doesn't route through insertAfterBlock — code only covers code-blocks /
// tables) had no caret position below it, so arrow-down dropped the selection and Vditor
// normalised it to the editor start (= "jumps to the top"). The invariant must offer a
// trailing paragraph after ANY non-text last block — not just the old whitelist.
describe('ensureTrailingParagraph — which last blocks earn a trailing paragraph', () => {
  it('a NORMAL blockquote at EOF gets one (the reported bug)', () => {
    const el = editorWith(
      '<blockquote data-block="0"><p>a normal quote</p></blockquote>',
    )
    expect(ensureTrailingParagraph(el, null)).toBe(true)
    const last = el.lastElementChild as HTMLElement
    expect(last.tagName).toBe('P')
    expect(last.hasAttribute(TRAILING)).toBe(true)
    expect((last.textContent || '').replace(ZWSP, '').trim()).toBe('')
  })

  it('a bare <div> (no data-type) at EOF gets one (whitelist→blacklist flip)', () => {
    const el = editorWith('<div data-block="0">stray div</div>')
    expect(ensureTrailingParagraph(el, null)).toBe(true)
    expect(lastTag(el)).toBe('P')
    expect(trailingPs(el).length).toBe(1)
  })

  it('a table earns a trailing paragraph; a code-block does NOT (excluded from the invariant)', () => {
    const table = editorWith(
      '<table data-block="0"><tr><td>x</td></tr></table>',
    )
    expect(ensureTrailingParagraph(table, null)).toBe(true)
    expect(lastTag(table)).toBe('P')

    // Code blocks are deliberately excluded from the persistent trailing invariant
    // (endsWithBlock checks `data-type !== 'code-block'`): Vditor's natural splice handles
    // arrow-down off a code block at EOF, and a forced trailing <p> was the over-correction
    // that got removed (see the codeblock-nav notes + codenav.spec).
    const code = editorWith(
      '<div data-block="0" data-type="code-block" class="vditor-ir__node"><pre><code>x</code></pre></div>',
    )
    expect(ensureTrailingParagraph(code, null)).toBe(false)
    expect(lastTag(code)).toBe('DIV')
  })

  it('a plain paragraph / heading / list at EOF gets NONE (already a text block)', () => {
    for (const html of [
      '<p data-block="0">just text</p>',
      '<h2 data-block="0">a heading</h2>',
      '<ul data-block="0"><li>item</li></ul>',
    ]) {
      const el = editorWith(html)
      expect(ensureTrailingParagraph(el, null)).toBe(false)
      expect(trailingPs(el).length).toBe(0)
    }
  })

  it('is idempotent — a second run adds no second trailing paragraph', () => {
    const el = editorWith('<blockquote><p>q</p></blockquote>')
    ensureTrailingParagraph(el, null)
    ensureTrailingParagraph(el, null)
    ensureTrailingParagraph(el, null)
    expect(trailingPs(el).length).toBe(1)
  })

  it('reclaims a stale trailing paragraph once a block is appended after it (streaming)', () => {
    const el = editorWith('<blockquote><p>q</p></blockquote>')
    ensureTrailingParagraph(el, null) // adds the trailing p
    const stale = el.lastElementChild as HTMLElement
    // a new block streams in AFTER the trailing paragraph
    stale.insertAdjacentHTML(
      'afterend',
      '<table><tr><td>late</td></tr></table>',
    )
    ensureTrailingParagraph(el, null)
    expect(stale.isConnected).toBe(false) // mid-document empty trailing p reclaimed
    expect(trailingPs(el).length).toBe(1) // exactly one, after the new last block
    expect(lastTag(el)).toBe('P')
  })

  it('a trailing paragraph the user typed into loses its tag (becomes real content)', () => {
    const el = editorWith('<blockquote><p>q</p></blockquote>')
    ensureTrailingParagraph(el, null)
    const typed = el.lastElementChild as HTMLElement
    typed.textContent = 'now real content'
    ensureTrailingParagraph(el, null)
    expect(typed.hasAttribute(TRAILING)).toBe(false) // promoted to a normal paragraph
    // …and since the new last block is now a plain paragraph, no fresh trailing is added
    expect(trailingPs(el).length).toBe(0)
  })
})

// The real jump-to-top culprit: our own #fix-table-ir-wrapper (a contenteditable=false 0×0
// box pinned at top:0) is appended INSIDE the editor, so it lands in the block chain. Vditor's
// insertAfterBlock does selectNodeContents(table.nextElementSibling) → into the wrapper → the
// caret jumps to the page top. The trailing paragraph MUST sit between the last block and the
// wrapper so the caret lands in the in-flow paragraph instead.
describe('ensureTrailingParagraph — the #fix-table-ir-wrapper (table panel) trap', () => {
  const wrapper =
    '<div id="fix-table-ir-wrapper" contenteditable="false" style="position:absolute;top:0;left:0;width:0;height:0"></div>'

  it('inserts the trailing paragraph BETWEEN the table and the wrapper (never after it)', () => {
    const el = editorWith(
      `<table data-block="0"><tr><td>x</td></tr></table>${wrapper}`,
    )
    expect(ensureTrailingParagraph(el, null)).toBe(true)
    const kids = Array.from(el.children)
    // order: table, trailing <p>, wrapper
    expect(kids[0].tagName).toBe('TABLE')
    expect(kids[1].tagName).toBe('P')
    expect(kids[1].hasAttribute(TRAILING)).toBe(true)
    expect(kids[2].id).toBe('fix-table-ir-wrapper')
    // the table's next sibling is the editable paragraph — NOT the wrapper (= no jump)
    expect((kids[0] as HTMLElement).nextElementSibling?.tagName).toBe('P')
  })

  it('heals a trailing paragraph stranded AFTER the wrapper (the observed broken DOM)', () => {
    // exactly what the diagnostic showed: [table][wrapper][trailing p]
    const el = editorWith(
      `<table data-block="0"><tr><td>x</td></tr></table>${wrapper}<p ${TRAILING}="">${ZWSP}</p>`,
    )
    ensureTrailingParagraph(el, null)
    const kids = Array.from(el.children)
    expect(
      kids.map((k) => (k.tagName === 'P' ? 'P' : k.id || k.tagName)),
    ).toEqual(['TABLE', 'P', 'fix-table-ir-wrapper'])
    expect(trailingPs(el).length).toBe(1)
    expect(
      (kids[0] as HTMLElement).nextElementSibling?.hasAttribute(TRAILING),
    ).toBe(true)
  })

  it('the wrapper alone (no content block) earns no trailing paragraph', () => {
    const el = editorWith(`<p>text</p>${wrapper}`)
    expect(ensureTrailingParagraph(el, null)).toBe(false)
    expect(trailingPs(el).length).toBe(0)
  })
})

// Guard the interaction the selector collision exposed: the maintained trailing paragraph
// must NOT be reclaimed by the gap cleanup (they look alike — both empty <p> — but the
// trailing one is load-bearing).
describe('cleanupGapParagraphs leaves the trailing paragraph alone', () => {
  it('does not remove a data-vmarkd-trailing paragraph next to a callout', () => {
    const el = editorWith(
      `<blockquote data-block="0" data-callout="note"><p>note</p></blockquote><p ${TRAILING}="">${ZWSP}</p>`,
    )
    cleanupGapParagraphs(el, null)
    expect(trailingPs(el).length).toBe(1)
    expect(el.lastElementChild?.hasAttribute(TRAILING)).toBe(true)
  })
})

describe('markTrailingActive — reveal the trailing paragraph only with the caret inside', () => {
  it('adds the active class when the caret is inside the trailing paragraph', () => {
    const el = editorWith(
      `<blockquote><p>q</p></blockquote><p ${TRAILING}="">${ZWSP}</p>`,
    )
    const tp = el.lastElementChild as HTMLElement
    markTrailingActive(el, tp.firstChild) // caret in the trailing <p>
    expect(tp.classList.contains(TRAILING_ACTIVE_CLASS)).toBe(true)
  })

  it('removes the active class when the caret is elsewhere', () => {
    const el = editorWith(
      `<blockquote><p>q</p></blockquote><p ${TRAILING}="" class="${TRAILING_ACTIVE_CLASS}">${ZWSP}</p>`,
    )
    const quote = el.firstElementChild as HTMLElement
    markTrailingActive(el, quote.querySelector('p')!.firstChild) // caret in the quote
    expect(
      (el.lastElementChild as HTMLElement).classList.contains(
        TRAILING_ACTIVE_CLASS,
      ),
    ).toBe(false)
  })

  it('is a no-op when there is no trailing paragraph', () => {
    const el = editorWith(`<p>only content</p>`)
    expect(() => markTrailingActive(el, null)).not.toThrow()
  })
})
