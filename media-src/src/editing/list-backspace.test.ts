// @vitest-environment jsdom
//
// Unit coverage for `backspaceOutdentTarget` — the pure DECISION logic (top-level-first / empty-item
// / wrong-caret-position exclusions, task/plain position-0 handling, nested-vs-top-level routing).
// That's the part of this module that changed shape in the move from a document keydown listener to
// a `fixList`-internal seam call (task 462), and it needs no Vditor/Lute instance to test.
//
// `handleListKeydown`'s DOM-mutating half (past the guard: `listOutdent` /
// `liftTopLevelItemToParagraph`) calls into Vditor's own `execAfterRender` pipeline, which needs a
// working Lute instance and a near-complete `IVditor` (options.counter, options.cache, undo stack,
// …) to run without throwing — faithfully mocking that would test the mock, not the code. That path
// is exercised for real (real Vditor, real Lute) by `media-src/e2e/list.spec.ts`'s "list-backspace.ts
// + list-tight.ts wired together" tests, by `media-src/e2e/list-scenarios.spec.ts` (task 525's
// scenario net, IR + WYSIWYG), and in the actual webview by `test/vscode-e2e/list-backspace.spec.ts`
// and `list-editing-scenarios.spec.ts`.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  backspaceOutdentTarget,
  caretOwnedByItem,
  enterSubListTarget,
  isEmptyNestedItem,
  previousVisibleLine,
  typedMarkerBeforeCaret,
} from './list-backspace'

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="ed">${html}</div>`
  return document.getElementById('ed') as HTMLElement
}

// A collapsed range at the very start of `li`'s first text node (or its contents, if none).
function rangeAtStart(li: HTMLElement): Range {
  const range = document.createRange()
  const text = [...li.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)
  if (text) range.setStart(text, 0)
  else range.selectNodeContents(li)
  range.collapse(true)
  return range
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('backspaceOutdentTarget', () => {
  it('leaves a TOP-LEVEL first item alone (fixList:474 handles it, gated to top-level-only)', () => {
    const ed = mount('<ul><li id="li">one</li><li>two</li></ul>')
    const li = ed.querySelector('#li') as HTMLElement
    expect(backspaceOutdentTarget(li, rangeAtStart(li), ed)).toBeNull()
  })

  it('routes a NESTED first item to "nested" (fixList:474 does NOT handle it cleanly — see module header)', () => {
    const ed = mount('<ul><li>parent<ul><li id="li">child</li></ul></li></ul>')
    const li = ed.querySelector('#li') as HTMLElement
    expect(backspaceOutdentTarget(li, rangeAtStart(li), ed)).toBe('nested')
  })

  it('routes a NESTED non-first item to "nested" too (task 428\'s original merge case)', () => {
    const ed = mount(
      '<ul><li>parent<ul><li>childone</li><li id="li">childtwo</li></ul></li></ul>',
    )
    const li = ed.querySelector('#li') as HTMLElement
    expect(backspaceOutdentTarget(li, rangeAtStart(li), ed)).toBe('nested')
  })

  it('routes a TOP-LEVEL non-first item to "top-level" (task 428\'s original merge case)', () => {
    const ed = mount('<ol><li>one</li><li id="li">two</li></ol>')
    const li = ed.querySelector('#li') as HTMLElement
    expect(backspaceOutdentTarget(li, rangeAtStart(li), ed)).toBe('top-level')
  })

  it('leaves an EMPTY item alone (removeEmptyItem handles it, not an outdent/lift)', () => {
    const ed = mount('<ul><li>one</li><li id="li"></li></ul>')
    const li = ed.querySelector('#li') as HTMLElement
    expect(backspaceOutdentTarget(li, rangeAtStart(li), ed)).toBeNull()
  })

  it('treats a zero-width-space-only item as empty', () => {
    const ed = mount('<ul><li>one</li><li id="li">​</li></ul>')
    const li = ed.querySelector('#li') as HTMLElement
    expect(backspaceOutdentTarget(li, rangeAtStart(li), ed)).toBeNull()
  })

  it('leaves a NON-first item alone when the caret is mid-text (not a "delete the marker" gesture)', () => {
    const ed = mount('<ul><li>one</li><li id="li">two</li></ul>')
    const li = ed.querySelector('#li') as HTMLElement
    const range = document.createRange()
    const text = li.firstChild as Text
    range.setStart(text, 2) // caret after "tw", not at the start
    range.collapse(true)
    expect(backspaceOutdentTarget(li, range, ed)).toBeNull()
  })

  it('a checklist item counts the checkbox as position 0 — caret right after it is still "the start"', () => {
    const ed = mount(
      '<ul><li>one</li><li id="li" class="vditor-task"><input type="checkbox">two</li></ul>',
    )
    const li = ed.querySelector('#li') as HTMLElement
    const range = document.createRange()
    range.setStart(li, 1) // between the checkbox and the text — position 1, the task-item start
    range.collapse(true)
    expect(backspaceOutdentTarget(li, range, ed)).toBe('top-level')
  })

  it('a checklist item past the start (caret INTO the text, not right after the checkbox) is left alone', () => {
    const ed = mount(
      '<ul><li>one</li><li id="li" class="vditor-task"><input type="checkbox">two</li></ul>',
    )
    const li = ed.querySelector('#li') as HTMLElement
    const range = document.createRange()
    const text = li.lastChild as Text
    range.setStart(text, 2) // two characters INTO "two" — well past the checklist start
    range.collapse(true)
    expect(backspaceOutdentTarget(li, range, ed)).toBeNull()
  })
})

function at(node: Node, offset: number): Range {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  return range
}

describe("previousVisibleLine (task 525 — where an empty item's Backspace lands)", () => {
  it('is the deepest last descendant of the previous sibling', () => {
    const ed = mount(
      '<ol><li>one</li><li>two<ul><li>aaa</li><li>bbb<ul><li id="deep">ccc</li></ul></li></ul></li><li id="li"></li></ol>',
    )
    expect(
      previousVisibleLine(ed.querySelector('#li') as HTMLElement)?.id,
    ).toBe('deep')
  })

  it('is the previous sibling itself when it has no sublist', () => {
    const ed = mount('<ul><li id="prev">one</li><li id="li"></li></ul>')
    expect(
      previousVisibleLine(ed.querySelector('#li') as HTMLElement)?.id,
    ).toBe('prev')
  })

  it('is the parent item for a nested FIRST item', () => {
    const ed = mount(
      '<ul><li id="parent">one<ul><li id="li"></li></ul></li></ul>',
    )
    expect(
      previousVisibleLine(ed.querySelector('#li') as HTMLElement)?.id,
    ).toBe('parent')
  })

  it('is null for a top-level first item (fixList handles that one)', () => {
    const ed = mount('<ul><li id="li"></li><li>two</li></ul>')
    expect(
      previousVisibleLine(ed.querySelector('#li') as HTMLElement),
    ).toBeNull()
  })
})

describe('caretOwnedByItem (task 525 — Tab guard)', () => {
  it("is true for a caret in the item's own text", () => {
    const ed = mount('<ul><li id="li">one</li></ul>')
    const li = ed.querySelector('#li') as HTMLElement
    expect(caretOwnedByItem(li, at(li.firstChild as Text, 1))).toBe(true)
  })

  it('is false inside a code block, table or quote within the item', () => {
    const ed = mount(
      '<ul><li id="li">one<pre><code id="c">x</code></pre><blockquote id="q">y</blockquote></li></ul>',
    )
    const li = ed.querySelector('#li') as HTMLElement
    expect(
      caretOwnedByItem(li, at(ed.querySelector('#c')!.firstChild as Text, 0)),
    ).toBe(false)
    expect(
      caretOwnedByItem(li, at(ed.querySelector('#q')!.firstChild as Text, 0)),
    ).toBe(false)
  })

  it('is false inside a code-block data-type element (IR)', () => {
    const ed = mount(
      '<ul><li id="li">one<div data-type="code-block" id="c">x</div></li></ul>',
    )
    const li = ed.querySelector('#li') as HTMLElement
    expect(
      caretOwnedByItem(li, at(ed.querySelector('#c')!.firstChild as Text, 0)),
    ).toBe(false)
  })

  it('is false when the caret is in a NESTED item (that item owns it)', () => {
    const ed = mount(
      '<ul><li id="li">one<ul><li id="n">two</li></ul></li></ul>',
    )
    const li = ed.querySelector('#li') as HTMLElement
    expect(
      caretOwnedByItem(li, at(ed.querySelector('#n')!.firstChild as Text, 1)),
    ).toBe(false)
  })
})

describe('typedMarkerBeforeCaret (task 525 — marker + Space in an empty item)', () => {
  const run = (html: string, offset: number) => {
    const ed = mount(html)
    const li = ed.querySelector('#li') as HTMLElement
    const text = li.firstChild as Text
    return typedMarkerBeforeCaret(li, at(text, offset))?.marker ?? null
  }

  it.each(['-', '*', '+', '1.', '12)'])('detects %s as a marker', (m) => {
    expect(run(`<ul><li id="li">${m}</li></ul>`, m.length)).toBe(m)
  })

  it('ignores a zero-width space around the marker', () => {
    expect(run('<ul><li id="li">\u200b-</li></ul>', 2)).toBe('-')
  })

  it('rejects a marker typed after other text', () => {
    expect(run('<ul><li id="li">one -</li></ul>', 5)).toBeNull()
  })

  it('rejects a marker with text after the caret', () => {
    expect(run('<ul><li id="li">-x</li></ul>', 1)).toBeNull()
  })

  it('rejects non-markers', () => {
    expect(run('<ul><li id="li">--</li></ul>', 2)).toBeNull()
    expect(run('<ul><li id="li">a.</li></ul>', 2)).toBeNull()
  })

  it('ignores the text of a nested sublist and counts a checkbox as not-text', () => {
    const ed = mount(
      '<ul><li id="li" class="vditor-task"><input type="checkbox">-<ul><li>zzz</li></ul></li></ul>',
    )
    const li = ed.querySelector('#li') as HTMLElement
    const text = li.childNodes[1] as Text
    expect(typedMarkerBeforeCaret(li, at(text, 1))?.marker).toBe('-')
  })
})

describe('enterSubListTarget (task 525 #7 — Enter at the end of an item with a sub-list)', () => {
  function setup(html: string, offset: number) {
    const ed = mount(html)
    const li = ed.querySelector('#li') as HTMLElement
    const text = [...li.childNodes].find(
      (n) => n.nodeType === Node.TEXT_NODE,
    ) as Text
    const range = document.createRange()
    range.setStart(text, offset)
    range.collapse(true)
    return { li, range }
  }
  const withSub = '<ul><li id="li">one<ul><li>aaa</li></ul></li></ul>'

  it('returns the direct sub-list when the caret is at the end of the own text', () => {
    const { li, range } = setup(withSub, 3)
    expect(enterSubListTarget(li, range)).toBe(li.querySelector('ul'))
  })

  it('ignores trailing blanks after the caret', () => {
    const { li, range } = setup(
      '<ul><li id="li">one  <ul><li>aaa</li></ul></li></ul>',
      3,
    )
    expect(enterSubListTarget(li, range)).not.toBeNull()
  })

  it('returns null mid-text (Vditor splits the item as before)', () => {
    const { li, range } = setup(withSub, 1)
    expect(enterSubListTarget(li, range)).toBeNull()
  })

  it('returns null for an item without a sub-list', () => {
    const { li, range } = setup('<ul><li id="li">one</li></ul>', 3)
    expect(enterSubListTarget(li, range)).toBeNull()
  })

  it('returns null for an empty item that has a sub-list', () => {
    const { li, range } = setup(
      '<ul><li id="li"><ul><li>aaa</li></ul></li></ul>'.replace(
        '<li id="li">',
        '<li id="li"> ',
      ),
      0,
    )
    expect(enterSubListTarget(li, range)).toBeNull()
  })

  it("does not treat a deeper nested list as the item's own sub-list", () => {
    const ed = mount(
      '<ul><li><ul><li id="li">x<ul><li>y</li></ul></li></ul></li></ul>',
    )
    const li = ed.querySelector('#li') as HTMLElement
    const range = document.createRange()
    range.setStart(li.firstChild as Text, 1)
    range.collapse(true)
    expect(enterSubListTarget(li, range)).toBe(li.querySelector(':scope > ul'))
  })
})

describe('isEmptyNestedItem (task 528 — Enter on an empty sub-item keeps the Shift+Tab outdent)', () => {
  const li = (html: string) => mount(html).querySelector('#li') as HTMLElement

  it('true for an empty item inside a nested list', () => {
    expect(
      isEmptyNestedItem(
        li('<ul><li>one<ul><li>a</li><li id="li"></li></ul></li></ul>'),
      ),
    ).toBe(true)
  })

  it('true for a ZWSP/blank-only nested item', () => {
    expect(
      isEmptyNestedItem(
        li('<ul><li>one<ul><li id="li">\u200b </li></ul></li></ul>'),
      ),
    ).toBe(true)
  })

  it("false for an empty TOP-LEVEL item (stays Vditor's: exits the list)", () => {
    expect(isEmptyNestedItem(li('<ul><li>a</li><li id="li"></li></ul>'))).toBe(
      false,
    )
  })

  it('false for a nested item with text or with its own sub-list', () => {
    expect(
      isEmptyNestedItem(li('<ul><li>one<ul><li id="li">x</li></ul></li></ul>')),
    ).toBe(false)
    expect(
      isEmptyNestedItem(
        li(
          '<ul><li>one<ul><li id="li"><ul><li>deep</li></ul></li></ul></li></ul>',
        ),
      ),
    ).toBe(false)
  })
})
