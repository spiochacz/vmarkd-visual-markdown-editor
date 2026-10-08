// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

// Task 83 (increment 5) — the open-time overlay wraps soft breaks on an HTML STRING
// (src/shared/soft-break-html.ts); the live editor does it on the DOM (soft-break.ts). Two
// implementations of one rule, so this pins them together: every corpus entry must come out the same
// whichever way it is wrapped.
import { wrapSoftBreaksInHtml } from '../../../src/shared/soft-break-html'
import { wrapTopBlock } from './soft-break'

const ZWSP = String.fromCharCode(0x200b)

const CORPUS: Record<string, string> = {
  paragraph: '<p data-block="0">one\ntwo\nthree</p>',
  trailingNewline: '<p data-block="0">one\ntwo\n</p>',
  whitespaceOnlyTail: '<p>one\n  \n</p>',
  zwspTail: `<p>one\n${ZWSP}</p>`,
  leadingNewline: '<p>\none</p>',
  doubleNewline: '<p>one\n\ntwo</p>',
  twoParagraphs: '<p>a\nb</p>\n<p>c\nd</p>',
  entities: '<p>a &lt;b&gt;\n&amp; c &nbsp;\nd</p>',
  inlineMarkup: '<p>a <em>b\nc</em>\nd <strong>e</strong>\nf</p>',
  irInlineCode:
    '<p data-block="0">with <span data-type="code" class="vditor-ir__node"><span class="vditor-ir__marker">`</span><code data-newline="1">x\ny</code><span class="vditor-ir__marker">`</span></span>\nafter\nmore</p>',
  irLink:
    '<p>a <span data-type="a" class="vditor-ir__node"><span class="vditor-ir__marker vditor-ir__marker--bracket">[</span><span class="vditor-ir__link">l</span><span class="vditor-ir__marker vditor-ir__marker--link">u\nrl</span></span>\nb</p>',
  wysiwygCode: `<p>x <code data-marker="\`">${ZWSP}code\nspan</code>${ZWSP}\nafter</p>`,
  link: '<p>and a <a href="https://example.test">link</a>\nover lines.</p>',
  image: '<p>pic <img src="a.png" alt="a\nb">\nnext</p>',
  imageOnlyTail: '<p>text\n<img src="a.png"></p>',
  hardBreak: '<p>one<br data-marker="\\" />two\nthree</p>',
  hardBreakNewline: '<p>one<br data-marker="\\" />\ntwo\nthree</p>',
  hardBreakTrailing: '<p>one\ntwo<br data-marker="\\" />\n</p>',
  blockquote:
    '<blockquote data-block="0">\n<p data-block="0">q one\nq two\nq three</p>\n</blockquote>',
  nestedQuote:
    '<blockquote>\n<blockquote>\n<p>a\nb</p>\n</blockquote>\n<p>c\nd</p>\n</blockquote>',
  tightList:
    '<ul data-tight="true" data-marker="-" data-block="0">\n<li data-marker="-">First\ncontinuation</li>\n<li data-marker="-">Second\ncontinuation</li>\n</ul>',
  nestedList:
    '<ul>\n<li>parent\nline<ul>\n<li>child\nline</li>\n</ul>\ntail\nafter</li>\n</ul>',
  looseList: '<ul>\n<li>\n<p>a\nb</p>\n</li>\n</ul>',
  callout:
    '<blockquote>\n<p>[!NOTE] Title\nbody one\nbody two</p>\n</blockquote>',
  calloutNoBody: '<blockquote>\n<p>[!NOTE]\nbody</p>\n</blockquote>',
  heading: '<h1 data-block="0">title</h1>\n<p>a\nb</p>',
  codeBlock:
    '<div data-type="code-block" class="vditor-ir__node"><pre class="vditor-ir__marker">```\nx\ny\n```</pre><pre class="vditor-ir__preview" data-render="2"><code>x\ny</code></pre></div>\n<p>a\nb</p>',
  plainPre: '<pre><code>a\nb</code></pre>\n<p>c\nd</p>',
  mathInline:
    '<p>m <span data-type="math-inline" class="vditor-ir__node"><code>a\nb</code></span>\nafter</p>',
  mathBlock:
    '<div data-type="math-block" class="vditor-ir__node">$$\na\n$$</div>\n<p>x\ny</p>',
  dataRender: '<p>a <span data-render="1">x\ny</span>\nb</p>',
  readOnly: '<p>a <span contenteditable="false">x\ny</span>\nb</p>',
  readOnlyParagraph: '<p contenteditable="false">a\nb</p>\n<p>c\nd</p>',
  alreadyWrapped:
    '<p>a<span class="vmarkd-softbreak" contenteditable="false">\n</span>b\nc</p>',
  table:
    '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>\n<p>a\nb</p>',
  hr: '<p>a\nb</p>\n<hr data-block="0" />\n<p>c\nd</p>',
  svgInline: '<p>a <svg width="1"><text>x\ny</text></svg>\nb</p>',
  comment: '<p>a<!-- x\ny -->\nb</p>',
  singleQuotedAttr: "<p class='x'>a\nb</p>",
  gtInAttr: '<p>a <span title="x>y">z</span>\nb</p>',
  emptyBlockQuote: '<blockquote>\n</blockquote>',
  noNewline: '<p>no break here</p>',
}

function viaDom(html: string): string {
  const root = document.createElement('pre')
  root.className = 'vditor-reset'
  root.innerHTML = html
  for (const top of Array.from(root.children)) wrapTopBlock(top, false)
  return root.innerHTML
}

function viaString(html: string): string {
  const root = document.createElement('pre')
  root.innerHTML = wrapSoftBreaksInHtml(html)
  return root.innerHTML
}

describe('wrapSoftBreaksInHtml matches the DOM wrapper (soft-break.ts)', () => {
  for (const [name, html] of Object.entries(CORPUS)) {
    it(name, () => {
      expect(viaString(html)).toBe(viaDom(html))
    })
  }

  it('the corpus actually exercises wrapping', () => {
    const wrapped = Object.values(CORPUS).filter((h) =>
      viaDom(h).includes('vmarkd-softbreak'),
    )
    expect(wrapped.length).toBeGreaterThan(20)
  })
})
