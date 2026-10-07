// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { boundaries, boundaryToward, needsGap } from './gap-boundary'

// Task 292 phase 1: the boundary matrix IS the spec. Every row here is a measured case from the
// probes recorded in the task file — where a caret stop exists today, and where the document has a
// position you simply cannot reach.

const CODE =
  '<div data-block="0" data-type="code-block"><pre><code>x</code></pre></div>'
const FRONT =
  '<div data-block="0" data-type="yaml-front-matter"><pre><code>t: 1</code></pre></div>'
const TABLE =
  '<table data-block="0" data-type="table"><tr><td>a</td></tr></table>'
const QUOTE = '<blockquote data-block="0"><p>quote</p></blockquote>'
const HR = '<hr data-block="0">'
const PARA = '<p data-block="0">para</p>'
const HEAD = '<h2 data-block="0">head</h2>'
const LIST = '<ul data-block="0"><li>item</li></ul>'

function editorWith(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}
// needsGap flags in document order: [before first, …between pairs…, after last]
const flags = (html: string) =>
  boundaries(editorWith(html)).map((b) => b.needsGap)

describe('needsGap — a boundary nothing else can reach', () => {
  const pair = (html: string) => {
    const [a, b] = Array.from(editorWith(html).children) as HTMLElement[]
    return needsGap(a, b)
  }

  it.each([
    ['rule ↔ code block', `${HR}${CODE}`],
    ['code block ↔ rule', `${CODE}${HR}`],
    ['rule ↔ front matter', `${HR}${FRONT}`],
    ['code block ↔ code block', `${CODE}${CODE}`],
    ['table ↔ code block', `${TABLE}${CODE}`],
    ['blockquote ↔ code block', `${QUOTE}${CODE}`],
    ['rule ↔ rule', `${HR}${HR}`],
  ])('%s needs one', (_name, html) => {
    expect(pair(html)).toBe(true)
  })

  it.each([
    ['paragraph ↔ rule', `${PARA}${HR}`],
    ['rule ↔ paragraph', `${HR}${PARA}`],
    ['heading ↔ code block', `${HEAD}${CODE}`],
    ['code block ↔ list', `${CODE}${LIST}`],
    ['paragraph ↔ paragraph', `${PARA}${PARA}`],
  ])('%s does not — Enter already opens a line there', (_name, html) => {
    expect(pair(html)).toBe(false)
  })

  it('treats the edges of the document as needing one against an atomic block', () => {
    expect(
      needsGap(null, editorWith(CODE).firstElementChild as HTMLElement),
    ).toBe(true)
    expect(
      needsGap(editorWith(TABLE).firstElementChild as HTMLElement, null),
    ).toBe(true)
  })

  it('does not against a text block at the edges', () => {
    expect(
      needsGap(null, editorWith(PARA).firstElementChild as HTMLElement),
    ).toBe(false)
    expect(
      needsGap(editorWith(PARA).firstElementChild as HTMLElement, null),
    ).toBe(false)
  })
})

describe('boundaries — every boundary in document order', () => {
  it('flags the unreachable slots of the task-496 fixture', () => {
    // front-matter | hr | p | hr | code | hr | p
    expect(flags(`${FRONT}${HR}${PARA}${HR}${CODE}${HR}${PARA}`)).toEqual([
      true, // doc start ↔ front matter
      true, // front matter ↔ hr
      false, // hr ↔ p
      false, // p ↔ hr
      true, // hr ↔ code block
      true, // code block ↔ hr
      false, // hr ↔ p
      false, // p ↔ doc end
    ])
  })

  it('flags the measured hole above a document that starts with a code block', () => {
    expect(flags(`${CODE}${PARA}`)[0]).toBe(true)
  })

  it('flags nothing in a document of plain text blocks', () => {
    expect(flags(`${HEAD}${PARA}${LIST}${PARA}`)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('boundaryToward — what an arrow key leaving a block reaches first', () => {
  const at = (html: string, index: number, down: boolean) => {
    const el = editorWith(html)
    const block = el.children[index] as HTMLElement
    return boundaryToward(el, block, down)
  }

  it('down from the paragraph above a rule: the p↔hr boundary, no gap', () => {
    const b = at(`${PARA}${HR}${CODE}`, 0, true)
    expect(b?.after?.tagName).toBe('HR')
    expect(b?.needsGap).toBe(false)
  })

  it('down from a rule sitting above a code block: gap', () => {
    const b = at(`${PARA}${HR}${CODE}`, 1, true)
    expect(b?.needsGap).toBe(true)
  })

  it('up from a code block below a rule: the same boundary, gap', () => {
    const b = at(`${PARA}${HR}${CODE}`, 2, false)
    expect(b?.before?.tagName).toBe('HR')
    expect(b?.needsGap).toBe(true)
  })

  it('up from the first block: the start-of-document boundary', () => {
    const b = at(`${CODE}${PARA}`, 0, false)
    expect(b?.before).toBeNull()
    expect(b?.needsGap).toBe(true)
  })

  it('down from the last block: the end-of-document boundary', () => {
    const b = at(`${PARA}${CODE}`, 1, true)
    expect(b?.after).toBeNull()
    expect(b?.needsGap).toBe(true)
  })

  it('returns null for an element that is not a content child', () => {
    const el = editorWith(`${PARA}${CODE}`)
    expect(boundaryToward(el, document.createElement('p'), true)).toBeNull()
  })
})
