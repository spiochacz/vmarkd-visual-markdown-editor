// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyHardBreakStyle } from '../../../src/shared/lute-hard-break'
import {
  proseBlockAt,
  insertHardBreak,
  setupHardBreakKey,
} from './hard-break-key'

// Task 530 — the Shift+Enter handler. Unit level: WHERE it acts (the prose-only ancestor rule) and WHAT
// it inserts. That Lute then keeps the break through a spin, and where the browser puts the caret,
// is proved on the real editors in media-src/e2e/hard-break.spec.ts.

let editor: HTMLElement
let dispose: (() => void) | undefined

const mount = (html: string) => {
  document.body.innerHTML = `<div id="ed" contenteditable="true">${html}</div>`
  editor = document.getElementById('ed') as HTMLElement
  return editor
}
const caretAt = (node: Node, offset: number) => {
  const r = document.createRange()
  r.setStart(node, offset)
  r.collapse(true)
  const s = getSelection() as Selection
  s.removeAllRanges()
  s.addRange(r)
  return r
}
const shiftEnter = (init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', {
    key: 'Enter',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  document.dispatchEvent(e)
  return e
}

beforeEach(() => {
  document.body.replaceChildren()
})
afterEach(() => {
  applyHardBreakStyle('backslash')
  dispose?.()
  dispose = undefined
})

describe('proseBlockAt — the prose-only ancestor rule', () => {
  it.each([
    ['a paragraph', '<p>text</p>', true],
    ['a tight list item', '<ul><li>text</li></ul>', true],
    [
      'a paragraph in a blockquote',
      '<blockquote><p>text</p></blockquote>',
      true,
    ],
    ['inside strong', '<p><strong>text</strong></p>', true],
    ['a heading', '<h2>text</h2>', false],
    [
      'a table cell',
      '<table><tbody><tr><td>text</td></tr></tbody></table>',
      false,
    ],
    ['a code block', '<pre><code>text</code></pre>', false],
    ['inline code', '<p><code>text</code></p>', false],
    [
      'an IR syntax marker',
      '<p><span class="vditor-ir__marker">text</span></p>',
      false,
    ],
    ['a rendered preview', '<p><span data-render="1">text</span></p>', false],
    ['inline math', '<p><span data-type="math-inline">text</span></p>', false],
    ['inline code node', '<p><span data-type="code">text</span></p>', false],
    ['inline html', '<p><span data-type="html-inline">text</span></p>', false],
  ])('%s -> %s', (_name, html, want) => {
    mount(html)
    const t = editor.querySelector('p, li, h2, td, code, span, strong')
    const text = (
      t?.firstChild?.nodeType === 3
        ? t.firstChild
        : (t?.querySelector('*')?.firstChild ?? t?.firstChild)
    ) as Node
    const leaf = (function find(n: Node): Node {
      return n.firstChild ? find(n.firstChild) : n
    })(editor)
    expect(allowed(leaf ?? text, editor)).toBe(want)
  })

  it('is false outside the editor surface', () => {
    mount('<p>text</p>')
    const stray = document.createElement('p')
    document.body.append(stray)
    expect(allowed(stray, editor)).toBe(false)
  })
})

describe('insertHardBreak', () => {
  it('inserts a marked <br> mid-text and puts the caret right after it', () => {
    mount('<p>abcd</p>')
    const t = editor.querySelector('p')?.firstChild as Text
    insertHardBreak(editor, caretAt(t, 2), '\\')
    const p = editor.querySelector('p') as HTMLElement
    expect(p.innerHTML).toBe('ab<br data-marker="\\">cd')
    const r = (getSelection() as Selection).getRangeAt(0)
    expect(r.collapsed).toBe(true)
    expect(r.startContainer).toBe(p)
    expect(r.startOffset).toBe(2) // after "ab" and the <br>
  })

  it('adds the browser line placeholder when nothing follows in the BLOCK', () => {
    mount('<p>abcd</p>')
    const t = editor.querySelector('p')?.firstChild as Text
    insertHardBreak(editor, caretAt(t, 4), '  ')
    expect(editor.querySelector('p')?.innerHTML).toBe(
      'abcd<br data-marker="  "><br>',
    )
  })

  it('decides over the whole block: a trailing placeholder inside strong still counts as nothing', () => {
    mount('<p><strong>bold</strong></p>')
    const t = editor.querySelector('strong')?.firstChild as Text
    insertHardBreak(editor, caretAt(t, 4), '\\')
    expect(editor.querySelector('p')?.innerHTML).toBe(
      '<strong>bold</strong><br data-marker="\\"><br>',
    )
  })

  it('no placeholder when text follows, in the block or after an inline element', () => {
    mount('<p><strong>bold</strong> tail</p>')
    const t = editor.querySelector('strong')?.firstChild as Text
    insertHardBreak(editor, caretAt(t, 4), '\\')
    expect(editor.querySelector('p')?.innerHTML).toBe(
      '<strong>bold</strong><br data-marker="\\"> tail',
    )
  })

  it('deletes a selection first', () => {
    mount('<p>abcd</p>')
    const t = editor.querySelector('p')?.firstChild as Text
    const r = document.createRange()
    r.setStart(t, 1)
    r.setEnd(t, 3)
    ;(getSelection() as Selection).removeAllRanges()
    ;(getSelection() as Selection).addRange(r)
    insertHardBreak(editor, r, '\\')
    expect(editor.querySelector('p')?.innerHTML).toBe('a<br data-marker="\\">d')
  })

  it('dispatches an insertLineBreak input event on the editor', () => {
    mount('<p>abcd</p>')
    const seen: string[] = []
    editor.addEventListener('input', (e) =>
      seen.push((e as InputEvent).inputType),
    )
    const t = editor.querySelector('p')?.firstChild as Text
    insertHardBreak(editor, caretAt(t, 1), '\\')
    expect(seen).toEqual(['insertLineBreak'])
  })
})

describe('setupHardBreakKey', () => {
  it('handles a plain Shift+Enter in prose and swallows the key', () => {
    mount('<p>abcd</p>')
    dispose = setupHardBreakKey(
      () => editor,
      () => '\\',
    )
    const t = editor.querySelector('p')?.firstChild as Text
    caretAt(t, 2)
    const e = shiftEnter()
    expect(e.defaultPrevented).toBe(true)
    expect(editor.querySelector('br')?.getAttribute('data-marker')).toBe('\\')
  })

  it('uses the CURRENT form (a setting can change while the editor is open)', () => {
    mount('<p>abcd</p>')
    dispose = setupHardBreakKey(() => editor)
    applyHardBreakStyle('spaces')
    caretAt(editor.querySelector('p')?.firstChild as Text, 1)
    shiftEnter()
    expect(editor.querySelector('br')?.getAttribute('data-marker')).toBe('  ')
  })

  it.each([
    ['a heading', '<h2>abcd</h2>'],
    ['inline code', '<p><code>abcd</code></p>'],
    ['a code block', '<pre><code>abcd</code></pre>'],
  ])('leaves %s to the editor (stock behaviour)', (_n, html) => {
    mount(html)
    dispose = setupHardBreakKey(
      () => editor,
      () => '\\',
    )
    const leaf = (function find(n: Node): Node {
      return n.firstChild ? find(n.firstChild) : n
    })(editor)
    caretAt(leaf, 1)
    const e = shiftEnter()
    expect(e.defaultPrevented).toBe(false)
    expect(editor.querySelector('br')).toBeNull()
  })

  it.each([
    ['plain Enter', { shiftKey: false }],
    ['Ctrl+Shift+Enter', { ctrlKey: true }],
    ['Alt+Shift+Enter', { altKey: true }],
    ['Meta+Shift+Enter', { metaKey: true }],
    ['an IME composition', { isComposing: true }],
  ])('ignores %s', (_n, init) => {
    mount('<p>abcd</p>')
    dispose = setupHardBreakKey(
      () => editor,
      () => '\\',
    )
    caretAt(editor.querySelector('p')?.firstChild as Text, 2)
    const e = shiftEnter(init as KeyboardEventInit)
    expect(e.defaultPrevented).toBe(false)
    expect(editor.querySelector('br')).toBeNull()
  })

  it('ignores a caret outside the editor, and an absent editor (sv / preview)', () => {
    mount('<p>abcd</p>')
    const other = document.createElement('p')
    other.textContent = 'elsewhere'
    document.body.append(other)
    dispose = setupHardBreakKey(
      () => editor,
      () => '\\',
    )
    caretAt(other.firstChild as Text, 2)
    expect(shiftEnter().defaultPrevented).toBe(false)
    dispose()
    dispose = setupHardBreakKey(
      () => null,
      () => '\\',
    )
    caretAt(editor.querySelector('p')?.firstChild as Text, 2)
    expect(shiftEnter().defaultPrevented).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Where the break goes, and what the handler declines
// ---------------------------------------------------------------------------

const allowed = (node: Node, root: HTMLElement) =>
  proseBlockAt(node, root) !== null

const lastText = (el: Node): Text => {
  let n: Node = el
  while (n.lastChild) n = n.lastChild
  return n as Text
}

describe('a break is never the last thing inside inline formatting', () => {
  it('goes AFTER a strong that ends at the caret', () => {
    mount('<p><strong>bold</strong></p>')
    const t = editor.querySelector('strong')?.firstChild as Text
    insertHardBreak(editor, caretAt(t, 4), '\\')
    expect(editor.querySelector('p')?.innerHTML).toBe(
      '<strong>bold</strong><br data-marker="\\"><br>',
    )
    const r = (getSelection() as Selection).getRangeAt(0)
    expect(r.startContainer).toBe(editor.querySelector('p'))
    expect(r.startOffset).toBe(2)
  })

  it('goes after the OUTERMOST element that ends at the caret (nested)', () => {
    mount('<p><em><strong>x</strong></em></p>')
    insertHardBreak(
      editor,
      caretAt(editor.querySelector('strong')?.firstChild as Text, 1),
      '  ',
    )
    expect(editor.querySelector('p')?.innerHTML).toBe(
      '<em><strong>x</strong></em><br data-marker="  "><br>',
    )
  })

  it('goes after a link whose label ends at the caret', () => {
    mount('<p><a href="u">label</a></p>')
    insertHardBreak(
      editor,
      caretAt(editor.querySelector('a')?.firstChild as Text, 5),
      '\\',
    )
    expect(editor.querySelector('p')?.innerHTML).toBe(
      '<a href="u">label</a><br data-marker="\\"><br>',
    )
  })

  it('stays INSIDE formatting when the caret is mid-element', () => {
    mount('<p><strong>bold</strong></p>')
    insertHardBreak(
      editor,
      caretAt(editor.querySelector('strong')?.firstChild as Text, 2),
      '\\',
    )
    expect(editor.querySelector('strong')?.innerHTML).toBe(
      'bo<br data-marker="\\">ld',
    )
  })

  it('stays inside when only the INNER element ends at the caret but text follows in the outer one', () => {
    mount('<p><em><strong>x</strong>y</em></p>')
    insertHardBreak(
      editor,
      caretAt(editor.querySelector('strong')?.firstChild as Text, 1),
      '\\',
    )
    expect(editor.querySelector('p')?.innerHTML).toBe(
      '<em><strong>x</strong><br data-marker="\\">y</em>',
    )
  })

  it('IR: syntax-marker spans after the caret do not count — the break leaves the whole node', () => {
    mount(
      '<p><span data-type="strong" class="vditor-ir__node"><span class="vditor-ir__marker vditor-ir__marker--bi">**</span><strong data-newline="1">bold</strong><span class="vditor-ir__marker vditor-ir__marker--bi">**</span></span></p>',
    )
    insertHardBreak(
      editor,
      caretAt(editor.querySelector('strong')?.firstChild as Text, 4),
      '\\',
    )
    const p = editor.querySelector('p') as HTMLElement
    expect(p.children[0].getAttribute('data-type')).toBe('strong')
    expect(p.children[1].tagName).toBe('BR')
    expect(p.children[1].getAttribute('data-marker')).toBe('\\')
  })

  it('an image after the caret inside the element is content: the break stays inside', () => {
    mount('<p><strong>bold<img src="u"></strong></p>')
    insertHardBreak(
      editor,
      caretAt(editor.querySelector('strong')?.firstChild as Text, 4),
      '\\',
    )
    expect(editor.querySelector('strong')?.innerHTML).toContain(
      'bold<br data-marker="\\">',
    )
  })
})

describe('a selection across blocks is not ours', () => {
  const across = (
    html: string,
    from: [string, number],
    to: [string, number],
  ) => {
    mount(html)
    const find = (sel: string) => lastText(editor.querySelector(sel) as Element)
    const a = (editor.querySelector(from[0]) as Element).firstChild as Text
    const b = (editor.querySelector(to[0]) as Element).firstChild as Text
    void find
    const r = document.createRange()
    r.setStart(a, from[1])
    r.setEnd(b, to[1])
    const s = getSelection() as Selection
    s.removeAllRanges()
    s.addRange(r)
    dispose = setupHardBreakKey(
      () => editor,
      () => '\\',
    )
    return shiftEnter()
  }
  it('declines across two paragraphs', () => {
    const e = across('<p id="a">abc</p><p id="b">def</p>', ['#a', 1], ['#b', 2])
    expect(e.defaultPrevented).toBe(false)
    expect(editor.innerHTML).toBe('<p id="a">abc</p><p id="b">def</p>')
  })
  it('declines across two list items', () => {
    const e = across(
      '<ul><li id="a">abc</li><li id="b">def</li></ul>',
      ['#a', 1],
      ['#b', 2],
    )
    expect(e.defaultPrevented).toBe(false)
    expect(editor.querySelector('br')).toBeNull()
  })
  it('declines across a code block in between', () => {
    const e = across(
      '<p id="a">abc</p><pre><code>x</code></pre><p id="b">def</p>',
      ['#a', 1],
      ['#b', 2],
    )
    expect(e.defaultPrevented).toBe(false)
    expect(editor.querySelector('br')).toBeNull()
  })
  it('still handles a selection inside ONE paragraph spanning inline elements', () => {
    mount('<p id="a">ab<strong>cd</strong>ef</p>')
    const r = document.createRange()
    r.setStart((editor.querySelector('#a') as Element).firstChild as Text, 1)
    r.setEnd(lastText(editor.querySelector('#a') as Element), 1)
    const s = getSelection() as Selection
    s.removeAllRanges()
    s.addRange(r)
    dispose = setupHardBreakKey(
      () => editor,
      () => '\\',
    )
    expect(shiftEnter().defaultPrevented).toBe(true)
    expect(editor.querySelector('#a br')?.getAttribute('data-marker')).toBe(
      '\\',
    )
  })
})

describe('protected / read-only ancestors anywhere on the chain', () => {
  const at = (html: string, sel: string) => {
    mount(html)
    return allowed(
      (editor.querySelector(sel) as Element).firstChild as Node,
      editor,
    )
  }
  it('rejects a paragraph inside a callout preview', () => {
    expect(
      at(
        '<blockquote data-callout="note"><p>[!NOTE]</p><div class="vditor-ir__preview vmarkd-callout__preview" contenteditable="false"><div class="vmarkd-callout__body"><p id="x">body</p></div></div></blockquote>',
        '#x',
      ),
    ).toBe(false)
  })
  it('rejects anything under contenteditable=false (the readonly callout marker)', () => {
    expect(
      at(
        '<blockquote data-callout="note"><p><span class="vmarkd-callout__marker" contenteditable="false"><b id="x">[!NOTE]</b></span>body</p></blockquote>',
        '#x',
      ),
    ).toBe(false)
  })
  it('rejects a paragraph under a [data-render] block', () => {
    expect(at('<div data-render="1"><p id="x">t</p></div>', '#x')).toBe(false)
  })
  it('accepts the editable body of a callout and a quote paragraph', () => {
    expect(
      at(
        '<blockquote data-callout="note"><p><span class="vmarkd-callout__marker" contenteditable="false">[!NOTE]</span><span id="x">body</span></p></blockquote>',
        '#x',
      ),
    ).toBe(true)
    expect(at('<blockquote><p id="x">q</p></blockquote>', '#x')).toBe(true)
  })
})

describe("the first edit records Vditor's undo caret", () => {
  const fakeVditor = (seen: string[], tag: () => string) => ({
    undo: { recordFirstPosition: () => seen.push(tag()) },
  })
  it('records BEFORE mutating, and only for a handled key', () => {
    mount('<p>abcd</p>')
    const seen: string[] = []
    dispose = setupHardBreakKey(
      () => editor,
      () =>
        fakeVditor(seen, () =>
          editor.querySelector('br') ? 'after' : 'before',
        ),
    )
    caretAt(editor.querySelector('p')?.firstChild as Text, 2)
    shiftEnter()
    expect(seen).toEqual(['before'])
    // a declined key never reaches it
    mount('<h2>head</h2>')
    dispose()
    dispose = setupHardBreakKey(
      () => editor,
      () => fakeVditor(seen, () => 'declined-called'),
    )
    caretAt(editor.querySelector('h2')?.firstChild as Text, 2)
    shiftEnter()
    expect(seen).toEqual(['before'])
  })
})
