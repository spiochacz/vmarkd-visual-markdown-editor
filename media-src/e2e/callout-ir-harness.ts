// Real-Vditor (IR) harness for the callout dual-node (task 106 v2). A `> [!NOTE]` blockquote +
// surrounding paragraphs so the caret can move in/out. Runs the production `observeCallouts` so the
// callout is tagged `vditor-ir__node` + gets its injected preview, then exposes helpers to drive
// the caret + Vditor's `expandMarker` and read the markdown back (round-trip).
import '../src/preload'
import Vditor from 'vditor/src/index'
import { expandMarker } from 'vditor/src/ts/ir/expandMarker'
import { observeCallouts } from '../src/callouts'

const value = `# doc

before paragraph

> [!NOTE]
> body text of the note

after paragraph
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
    ;(window as any).vditor = editor
    ;(window as any).__el = el
    ;(window as any).__bq = () =>
      el().querySelector('blockquote') as HTMLElement
    ;(window as any).__getValue = () => editor.getValue()

    // Production wiring: tag callouts + inject preview, kept in sync as the IR rebuilds.
    observeCallouts(el())

    const caretAndExpand = (node: Node, offset: number) => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      expandMarker(range, iv) // what Vditor calls on a real caret move (linchpin proven separately)
    }

    // Caret into the callout's source <p> → Vditor expands it.
    ;(window as any).__caretInside = () => {
      const p = el().querySelector(
        'blockquote[data-callout] > p',
      ) as HTMLElement
      caretAndExpand(p.firstChild as Node, 1)
    }
    // Caret into the trailing paragraph → callout collapses.
    ;(window as any).__caretOutside = () => {
      const paras = el().querySelectorAll(':scope > p')
      const after = paras[paras.length - 1] as HTMLElement
      caretAndExpand(after.firstChild as Node, 1)
    }

    // Task 179 — focus the IR surface + put the caret at the END of the callout body so a real
    // Playwright keystroke burst types into it (exercises SpinVditorIRDOM + observeCallouts).
    ;(window as any).__focusBodyEnd = () => {
      const p = el().querySelector(
        'blockquote[data-callout] > p',
      ) as HTMLElement
      const t = p.firstChild as Text // "[!NOTE]\nbody text of the note"
      el().focus()
      caretAndExpand(t, t.data.length)
    }
    // Live snapshot of the callout's editing state — re-queried fresh (the re-spin replaces nodes).
    ;(window as any).__state = () => {
      const bq = el().querySelector(
        'blockquote[data-callout]',
      ) as HTMLElement | null
      const src = bq?.querySelector(':scope > p') as HTMLElement | null
      const sel = window.getSelection()
      const anchor = sel?.rangeCount ? sel.anchorNode : null
      const host = anchor
        ? anchor.nodeType === 1
          ? (anchor as Element)
          : anchor.parentElement
        : null
      return {
        srcText: src?.textContent ?? null,
        // caret still inside the callout's editable source (not ejected, not in the preview)
        caretInCallout: !!(
          anchor &&
          bq?.contains(anchor) &&
          !host?.closest('.vmarkd-callout__preview')
        ),
        expanded: !!bq?.classList.contains('vditor-ir__node--expand'),
        editing: !!bq?.hasAttribute('data-callout-editing'),
        srcVisible: src ? getComputedStyle(src).display !== 'none' : false,
        value: editor.getValue(),
      }
    }
    ;(window as any).__ready = true
  },
})
