// Callouts harness (task 106) — unit-level DOM test of applyCallouts. Builds the blockquote shapes
// Lute emits for `> [!TYPE]` (`<blockquote><p>[!NOTE]<br>body</p></blockquote>`), plus a plain
// quote and a `[!tip]-` fold-suffix case (the suffix is accepted but IGNORED — fold support dropped). Exposes applyCallouts so the spec can assert the dual-node DOM output (tag
// + injected preview) and that the editable source is left intact (round-trip). The source⇄preview
// VISIBILITY swap needs Vditor's expandMarker, so it's tested in the real-Vditor `callout-ir`
// harness instead.
import { applyCallouts, calloutWysiwygToolbar } from '../src/callouts'

const app = document.getElementById('app') as HTMLElement
app.innerHTML = `
  <div class="vditor-reset">
    <blockquote id="note"><p>[!NOTE]<br>Body of the note.</p></blockquote>
    <blockquote id="warning"><p>[!WARNING] Careful<br>Watch out.</p></blockquote>
    <blockquote id="fold"><p>[!tip]-<br>Hidden tip.</p></blockquote>
    <blockquote id="plain"><p>Just a normal quote.</p></blockquote>
  </div>
  <!-- WYSIWYG: no expandMarker, so callouts get a type-dropdown + hidden marker (NOT the dual-node).
       Lute emits the marker + first body line in ONE editable <p> separated by a newline. -->
  <div class="vditor-wysiwyg">
    <div class="vditor-reset" contenteditable="true">
      <blockquote id="wy-note"><p data-block="0">[!NOTE]
Body of the note.</p></blockquote>
      <blockquote id="wy-warning"><p data-block="0">[!WARNING] Careful
Watch out.</p></blockquote>
      <blockquote id="wy-plain"><p data-block="0">Just a normal quote.</p></blockquote>
    </div>
  </div>
`
;(window as any).__apply = () => applyCallouts(document.body)
// Simulate Vditor's `customWysiwygToolbar('blockquote', popover)` hook: put the caret inside the
// given WYSIWYG callout, then run the toolbar builder against a fresh popover element. Returns the
// popover so the spec can assert the injected <select>.
;(window as any).__toolbar = (calloutId: string): HTMLElement => {
  const bq = document.getElementById(calloutId) as HTMLElement
  const body = bq.querySelector(':scope > p') as HTMLElement
  const range = document.createRange()
  range.selectNodeContents(body)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  const popover = document.createElement('div')
  popover.className = 'vditor-panel'
  document.body.appendChild(popover)
  calloutWysiwygToolbar('blockquote', popover)
  return popover
}
;(window as any).__ready = true
