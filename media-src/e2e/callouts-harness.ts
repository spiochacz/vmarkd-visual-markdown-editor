// Callouts harness (task 106) — unit-level DOM test of applyCallouts. Builds the blockquote shapes
// Lute emits for `> [!TYPE]` (`<blockquote><p>[!NOTE]<br>body</p></blockquote>`), plus a plain
// quote and a `[!tip]-` fold-suffix case (the suffix is accepted but IGNORED — fold support dropped). Exposes applyCallouts so the spec can assert the dual-node DOM output (tag
// + injected preview) and that the editable source is left intact (round-trip). The source⇄preview
// VISIBILITY swap needs Vditor's expandMarker, so it's tested in the real-Vditor `callout-ir`
// harness instead.
import { applyCallouts } from '../src/callouts'

const app = document.getElementById('app') as HTMLElement
app.innerHTML = `
  <div class="vditor-reset">
    <blockquote id="note"><p>[!NOTE]<br>Body of the note.</p></blockquote>
    <blockquote id="warning"><p>[!WARNING] Careful<br>Watch out.</p></blockquote>
    <blockquote id="fold"><p>[!tip]-<br>Hidden tip.</p></blockquote>
    <blockquote id="plain"><p>Just a normal quote.</p></blockquote>
  </div>
`
;(window as any).__apply = () => applyCallouts(document.body)
;(window as any).__ready = true
