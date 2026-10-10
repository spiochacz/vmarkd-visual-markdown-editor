// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupGapParagraphs,
  ensureLeadingBlock,
  isThematicBreakParagraph,
  observeTrailingParagraph,
  promoteThematicBreaks,
} from './gap-paragraph'
// ensureTrailingParagraph moved to trailing-paragraph.ts (task 472) along with the rest of its
// own describe blocks (trailing-paragraph.test.ts) — still needed here for the one integration
// test below that exercises promoteThematicBreaks + ensureTrailingParagraph together.
import { ensureTrailingParagraph } from './trailing-paragraph'

const TRAILING = 'data-vmarkd-trailing'
const GAP = 'data-vmarkd-gap'
const LEADING = 'data-vmarkd-leading'
const ZWSP = '​'

function editorWith(innerHTML: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = innerHTML
  document.body.replaceChildren(el)
  return el
}
const trailingPs = (el: HTMLElement) =>
  el.querySelectorAll(`:scope > p[${TRAILING}]`)

beforeEach(() => {
  document.body.replaceChildren()
})

// Task 446 Part 1 — the mirror of the trailing invariant: the document must always offer AT LEAST
// ONE editable block, so caret code (caret.ts's 'document-start' intent) never has to anchor on
// the bare editable — the unpaintable Range that shipped as task 439.
describe('ensureLeadingBlock — the document always has at least one editable block', () => {
  it('a genuinely empty editor (zero element children) gets a seeded leading paragraph', () => {
    const el = editorWith('')
    expect(ensureLeadingBlock(el)).toBe(true)
    expect(el.childElementCount).toBe(1)
    const p = el.firstElementChild as HTMLElement
    expect(p.tagName).toBe('P')
    expect(p.hasAttribute(LEADING)).toBe(true)
    // ZWSP seed — Lute drops it, so the file on disk stays empty (task 439's shipped guarantee).
    expect(p.textContent).toBe(ZWSP)
  })

  it('an editor that already has a first block (even an atomic one) is left untouched', () => {
    // Deliberately narrower than a full mirror of endsWithBlock (see the file comment): a code
    // block already offers a typeable position inside it, so nothing is manufactured above it.
    const el = editorWith(
      '<div data-block="0" data-type="code-block"><pre><code>x</code></pre></div>',
    )
    expect(ensureLeadingBlock(el)).toBe(false)
    expect(el.childElementCount).toBe(1)
    expect(el.querySelector(`[${LEADING}]`)).toBeNull()
  })

  it('is idempotent — a second run adds no second leading paragraph', () => {
    const el = editorWith('')
    ensureLeadingBlock(el)
    ensureLeadingBlock(el)
    ensureLeadingBlock(el)
    expect(el.querySelectorAll(`[${LEADING}]`).length).toBe(1)
  })

  it('a leading paragraph the user typed into loses its tag (becomes real content)', () => {
    const el = editorWith('')
    ensureLeadingBlock(el)
    const p = el.firstElementChild as HTMLElement
    p.textContent = 'now real content'
    expect(ensureLeadingBlock(el)).toBe(true)
    expect(p.hasAttribute(LEADING)).toBe(false)
    // …and since the editor now has a real first block, nothing new is manufactured.
    expect(el.childElementCount).toBe(1)
  })

  it('does not get reclaimed by cleanupGapParagraphs next to a code-block neighbour', () => {
    // The trap Part 1 called out explicitly: an empty leading <p> next to a code block looks
    // exactly like a transient navigation gap to cleanupGapParagraphs, which would otherwise
    // remove it — and the observer would just re-add it next frame, flickering forever.
    const el = editorWith(
      `<p ${LEADING}="">${ZWSP}</p><div data-block="0" data-type="code-block"><pre><code>x</code></pre></div>`,
    )
    cleanupGapParagraphs(el, null)
    expect(el.querySelectorAll(`[${LEADING}]`).length).toBe(1)
    expect(el.firstElementChild?.hasAttribute(LEADING)).toBe(true)
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

// Task 486: repeated Enter below a callout/code-block built a CHAIN of empty paragraphs — each
// one Vditor's native split leaves untagged, so they look exactly like a stale navigation splice
// to the code above unless the cleanup can tell "part of the chain reaching the caret" apart from
// "caret moved on entirely".
describe('cleanupGapParagraphs — a chain of blank lines the user is building via Enter survives', () => {
  it('keeps every paragraph in an unbroken empty-<p> chain that reaches the caret', () => {
    const el = editorWith(
      `<blockquote data-block="0" data-callout="note"><p>note</p></blockquote><p data-block="0"></p><p data-block="0"></p><p data-block="0"></p>`,
    )
    const caret = el.querySelectorAll('p')[2] // the LAST (newest) blank line holds the caret
    cleanupGapParagraphs(el, caret)
    expect(el.querySelectorAll(':scope > p').length).toBe(3) // none reclaimed
  })

  it('still reclaims a stale gap paragraph when the caret moved past it into a real block', () => {
    // The chain breaks on a non-<p> sibling (a real block, not another blank line) — the
    // original transient-splice behaviour: ArrowDown past a code block, through the gap, into
    // the blockquote below it.
    const el = editorWith(
      `<div data-block="0" data-type="code-block"><pre><code>x</code></pre></div><p data-block="0"></p><blockquote data-block="0"><p>quote</p></blockquote>`,
    )
    const caret = el.querySelector('blockquote p')?.firstChild as Text
    cleanupGapParagraphs(el, caret)
    expect(el.querySelectorAll(':scope > p').length).toBe(0) // the empty gap p was reclaimed
  })
})

// The hr-adjacent gap (gap-nav.ts): its neighbours — a thematic break, front matter, a table —
// are outside isGapNeighbour's set, so the tag is what makes it self-cleaning.
describe('cleanupGapParagraphs — the tagged hr-adjacent gap paragraph', () => {
  const hrGapEditor = () =>
    editorWith(
      `<hr data-block="0"><p data-block="0" ${GAP}="">${ZWSP}</p><div data-block="0" data-type="code-block"><pre><code>x</code></pre></div>`,
    )

  it('reclaims it once the caret has left it still empty', () => {
    const el = hrGapEditor()
    cleanupGapParagraphs(el, el.querySelector('code')?.firstChild ?? null)
    expect(el.querySelectorAll(':scope > p').length).toBe(0)
  })

  it('keeps it while the caret is inside', () => {
    const el = hrGapEditor()
    const p = el.querySelector('p') as HTMLElement
    cleanupGapParagraphs(el, p.firstChild)
    expect(el.querySelectorAll(':scope > p').length).toBe(1)
  })

  it('keeps it once it holds typed text (it is real content now)', () => {
    const el = hrGapEditor()
    const p = el.querySelector('p') as HTMLElement
    p.textContent = 'between'
    cleanupGapParagraphs(el, el.querySelector('code')?.firstChild ?? null)
    expect(el.querySelector('p')?.textContent).toBe('between')
  })

  it('keeps the Enter-built blank-line chain that starts in it (task 486 rule wins)', () => {
    const el = editorWith(
      `<hr data-block="0"><p data-block="0" ${GAP}="">${ZWSP}</p><p data-block="0"></p><div data-block="0" data-type="code-block"><pre><code>x</code></pre></div>`,
    )
    const caret = el.querySelectorAll(':scope > p')[1] // the newest blank line holds the caret
    cleanupGapParagraphs(el, caret)
    expect(el.querySelectorAll(':scope > p').length).toBe(2)
  })
})

// Task 100: a `---` typed under another `---` stayed as literal `<p>--- </p>` source (the
// block-scoped re-spin never promotes the LAST one). We promote a lone thematic-break paragraph the
// caret has left to a real <hr>, and the trailing invariant then offers an escape line below it.
describe('isThematicBreakParagraph — recognising a lone rule marker', () => {
  const p = (html: string) => {
    const el = document.createElement('p')
    el.innerHTML = html
    return el
  }
  it('matches ---, ***, ___ and spaced variants (with trailing spaces / ZWSP)', () => {
    expect(isThematicBreakParagraph(p('---'))).toBe(true)
    expect(isThematicBreakParagraph(p('--- '))).toBe(true) // the live-IR `--- ` source
    expect(isThematicBreakParagraph(p('***'))).toBe(true)
    expect(isThematicBreakParagraph(p('___'))).toBe(true)
    expect(isThematicBreakParagraph(p('- - -'))).toBe(true)
    expect(isThematicBreakParagraph(p('----'))).toBe(true)
    expect(isThematicBreakParagraph(p(`${ZWSP}---${ZWSP}`))).toBe(true)
  })
  it('rejects non-rules, mid-edit, and non-paragraphs', () => {
    expect(isThematicBreakParagraph(p('--'))).toBe(false) // only two dashes
    expect(isThematicBreakParagraph(p('---foo'))).toBe(false) // has other text
    expect(isThematicBreakParagraph(p('-*-'))).toBe(false) // mixed markers
    expect(isThematicBreakParagraph(p('text'))).toBe(false)
    expect(isThematicBreakParagraph(p('---<wbr>'))).toBe(false) // mid-edit (element child)
    const hr = document.createElement('hr')
    expect(isThematicBreakParagraph(hr)).toBe(false) // already a rule, not a <p>
  })
})

describe('promoteThematicBreaks — render a left-behind `---` as an <hr>', () => {
  it('promotes a lone `--- ` paragraph the caret has left, leaving normal paragraphs alone', () => {
    const el = editorWith(
      '<p>before</p><p data-block="0">plain text</p><p data-block="0">--- </p>',
    )
    const before = el.querySelector('p:first-child')?.firstChild as Text
    expect(promoteThematicBreaks(el, before)).toBe(true)
    expect(el.querySelectorAll('hr').length).toBe(1) // only the rule promoted
    expect(el.querySelector('p:nth-child(2)')?.textContent).toBe('plain text') // normal p untouched
    expect((el.lastElementChild as HTMLElement).tagName).toBe('HR') // the `--- ` became the rule
  })

  it('does NOT promote the paragraph that holds the caret (still being edited)', () => {
    const el = editorWith('<p data-block="0">---</p>')
    const caret = el.querySelector('p')?.firstChild as Text
    expect(promoteThematicBreaks(el, caret)).toBe(false)
    expect(el.querySelectorAll('hr').length).toBe(0)
    expect(el.querySelector('p')?.textContent).toBe('---') // left as editable source
  })

  it('promoted <hr> then earns a trailing escape paragraph (integration)', () => {
    const el = editorWith('<p>x</p><p data-block="0">---</p>')
    promoteThematicBreaks(el, el.querySelector('p')?.firstChild ?? null)
    ensureTrailingParagraph(el, null)
    // the rule rendered, and there's a caret slot (trailing paragraph) below it
    expect(el.querySelector('hr')).not.toBeNull()
    const last = el.lastElementChild as HTMLElement
    expect(last.tagName).toBe('P')
    expect(last.hasAttribute(TRAILING)).toBe(true)
  })

  it('promotes every left-behind rule but keeps the focused one as source', () => {
    const el = editorWith(
      '<hr data-block="0"><p data-block="0">---</p><p data-block="0">---</p>',
    )
    const focused = el.querySelectorAll('p')[1]?.firstChild as Text // caret in the LAST one
    promoteThematicBreaks(el, focused)
    expect(el.querySelectorAll('hr').length).toBe(2) // original + the un-focused promotion
    expect(el.querySelectorAll('p').length).toBe(1) // the focused `---` stays editable
  })
})

describe('observeTrailingParagraph follows the active editor (live mode switch)', () => {
  it('asserts the invariant on whichever element the getter yields, never on null (sv)', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      queueMicrotask(cb)
      return 1
    })
    const app = document.createElement('div')
    const ir = document.createElement('div')
    const wys = document.createElement('div')
    ir.innerHTML = '<blockquote data-block="0">q</blockquote>'
    wys.innerHTML = '<blockquote data-block="0">q</blockquote>'
    app.append(ir, wys)
    document.body.replaceChildren(app)
    let active: HTMLElement | null = ir
    const dispose = observeTrailingParagraph(app, () => active)
    expect(trailingPs(ir).length).toBe(1) // bound mode has it at install
    expect(trailingPs(wys).length).toBe(0) // the hidden mode is not touched

    active = wys // toolbar switch: no re-init, only a rebuilt DOM in the new mode
    wys.appendChild(document.createElement('hr'))
    await new Promise((r) => setTimeout(r, 0))
    expect(trailingPs(wys).length).toBe(1)

    active = null // sv: nothing may be manufactured
    const sv = document.createElement('div')
    sv.innerHTML = '<div data-block="0">text</div>'
    app.appendChild(sv)
    await new Promise((r) => setTimeout(r, 0))
    expect(sv.querySelector(`[${TRAILING}]`)).toBeNull()
    dispose()
    vi.unstubAllGlobals()
  })
})
