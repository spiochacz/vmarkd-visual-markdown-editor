// Harness for code/custom-block backgrounds in IR edit mode. Real Vditor (IR) with a ```js code
// block (the user's example) + a ```mermaid block. Simulates the github content theme's code panel
// background AND its inline-code background var, so the spec reproduces the editing-mode artefacts.
// Exposes a helper to expand the code block (caret into the source) + dump its computed styles.
import '../src/preload'
import Vditor from 'vditor/src/index'
import { expandMarker } from 'vditor/src/ts/ir/expandMarker'
import { observeCodeSource } from '../src/code-source'

const FENCE = '```'
const value = `# doc

${FENCE}js
function greet(name) {
  const msg = \`Hello, \${name}!\`
  return msg.toUpperCase()
}
${FENCE}

${FENCE}mermaid
graph TD
  A[Start] --> B[End]
${FENCE}
`

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  height: 500,
  cdn: `${location.origin}/vditor`,
  value,
  after() {
    const iv = (editor as any).vditor
    const el = () => iv.ir.element as HTMLElement
    // Simulate the github theme: panel bg on every `pre` + the inline-code background var.
    const st = document.createElement('style')
    // Reproduce GitHub's relevant editing-surface rules: code panel bg, inline-code bg var,
    // `pre code { display: inline }` AND the compounding `pre { 85% }` + `code { 85% }` font sizes
    // (the editable source otherwise shrinks to ~72% of base, smaller than the rendered code).
    st.textContent = [
      '.markdown-body pre { background-color: rgb(20, 27, 35); font-size: 85%; }',
      '.markdown-body { --vmarkd-code-bg: rgb(129, 139, 152); }',
      '.markdown-body pre code { display: inline; }',
      '.markdown-body code, .markdown-body tt { font-size: 85%; padding: .2em .4em; }',
      // GitHub neutralises the code bg on `pre > code` so the panel is the `pre` (not the code).
      '.markdown-body pre > code { background-color: rgba(0, 0, 0, 0); }',
      // simulate the highlight.js theme's universal block rules — these style the `.hljs`-tagged
      // source the same as the rendered code (display:block, padding:1em), so edit matches render.
      'pre code.hljs { display: block; padding: 1em; }',
    ].join('\n')
    document.head.appendChild(st)
    document.body.classList.add('markdown-body')
    ;(window as any).vditor = editor
    ;(window as any).__el = el
    // Production wiring under test: tag the editable code source with `.hljs` so the theme styles it.
    observeCodeSource(el())

    // The ```js code-block node.
    const codeNode = () =>
      Array.from(el().querySelectorAll<HTMLElement>('.vditor-ir__node')).find(
        (n) =>
          n.getAttribute('data-type') === 'code-block' &&
          !!n.querySelector('code.language-js'),
      )

    // The ```mermaid custom-block node (preview holds a `div.language-mermaid`, not a `code.hljs`).
    const mermaidNode = () =>
      Array.from(el().querySelectorAll<HTMLElement>('.vditor-ir__node')).find(
        (n) => !!n.querySelector('.vditor-ir__preview .language-mermaid'),
      )

    // Place the caret in a node's editable source + run Vditor's expandMarker (its real caret move).
    const expandNode = (node: HTMLElement | undefined) => {
      if (!node) return false
      const code = node.querySelector(
        '.vditor-ir__marker--pre code',
      ) as HTMLElement
      const range = document.createRange()
      range.setStart(code.firstChild as Node, 0)
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      expandMarker(range, iv)
      return node.classList.contains('vditor-ir__node--expand')
    }

    // Expand the code block (place the caret in its editable source, run Vditor's expandMarker).
    ;(window as any).__expandCode = () => expandNode(codeNode())
    // Expand the mermaid custom block — to prove its preview is NOT hidden while editing.
    ;(window as any).__expandMermaid = () => expandNode(mermaidNode())

    // Dump the expanded code block's structure + the computed background of every descendant that
    // paints one (so the spec can pinpoint stray backgrounds while editing).
    ;(window as any).__dumpCode = () => {
      const node = codeNode()
      if (!node) return { html: '(none)', bgs: [] as any[] }
      const bgs: any[] = []
      node.querySelectorAll('*').forEach((elm) => {
        const cs = getComputedStyle(elm as Element)
        if (
          cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
          cs.backgroundImage !== 'none'
        ) {
          bgs.push({
            tag: (elm as Element).tagName.toLowerCase(),
            cls: (elm as Element).className,
            bg: cs.backgroundColor,
            img: cs.backgroundImage.slice(0, 30),
          })
        }
      })
      return {
        html: node.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>'),
        bgs,
      }
    }
    ;(window as any).__ready = true
  },
})
