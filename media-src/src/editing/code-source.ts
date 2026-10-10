// Code-block edit surface (task: edit == render, theme-driven).
//
// In Vditor's IR, a code block's editable SOURCE is `pre.vditor-ir__marker--pre > code.language-X`,
// while the RENDER is `pre.vditor-ir__preview > code.hljs` — the highlight.js theme styles `.hljs`
// (background, padding, base colour, size). Because the source lacks `.hljs`, the content/inline-code
// rules leak onto it instead, so the code text was a different size/padding/colour than the render
// and shifted when you entered edit.
//
// Fix: tag the source `<code>` with `hljs` too, so the SAME hljs-theme rules style it — making the
// editing surface identical to the render (only the syntax token colours are absent; the base text
// colour comes from the theme, which is what we want). Verified: the class is transparent to Lute's
// serializer, so the markdown round-trips unchanged.
//
// Vditor rebuilds the IR DOM on each edit via Lute's WASM HTML-string templating (SpinVditorIRDOM
// et al.) — there is no JS call site to attach a build-time source patch to (ADR-0004), so re-tagging
// must be a runtime MutationObserver, not a patch. (Not because highlight.js themes happen to be
// swappable — that was this header's old, imprecise framing; corrected, task 465.) The first batch
// of a frame is handled synchronously and same-frame bursts coalesce into one pre-paint trailing
// run (coalescePerFrame, 185/2c) — so adding the class neither causes a flash (always re-applied
// before paint) nor re-triggers the observer (attributes are not watched → no loop).

import { engineLangSet } from '../diagram-kit/engine-registry'
import { observeScopedMutations } from './mutation-scope'

// Diagram/formula blocks share `data-type="code-block"` but render to an SVG/diagram, not
// `.hljs` code — leave their source alone (it isn't syntax-highlighted code). EVERY registry
// engine qualifies (185/2a: derived, no hand-synced list).
export const CUSTOM_LANGS = engineLangSet()

/** Add `hljs` to every editable code-block source `<code>` (skipping diagram languages). */
export function tagCodeSource(root: ParentNode | null | undefined): void {
  if (!root || typeof (root as ParentNode).querySelectorAll !== 'function')
    return
  const codes = (root as ParentNode).querySelectorAll<HTMLElement>(
    '.vditor-ir__marker--pre > code',
  )
  for (const code of Array.from(codes)) {
    if (code.classList.contains('hljs')) continue
    const langClass = Array.from(code.classList).find((c) =>
      c.startsWith('language-'),
    )
    const lang = langClass ? langClass.slice('language-'.length) : ''
    if (lang && CUSTOM_LANGS.has(lang)) continue
    code.classList.add('hljs')
  }
}

/**
 * Keep code-block sources tagged `.hljs` as the IR editor rebuilds its DOM. Bind it to the STABLE
 * `#app` mount, not the mode element active at init: a toolbar mode switch does not re-init and
 * Vditor rebuilds `ir.element` on it, so an init-time binding left sv/WYSIWYG -> IR untagged. The first batch of a
 * frame runs synchronously (before paint, so no flash) and same-frame bursts coalesce into one
 * pre-paint trailing run (coalescePerFrame, 185/2c); observes childList/characterData only (NOT
 * attributes), so adding the class doesn't re-trigger the observer. Returns a disposer.
 *
 * Task 173: scoped to the top-level block(s) the batch actually touched (mutation-scope.ts) instead
 * of a whole-`editorEl` `querySelectorAll` every time — `tagCodeSource`'s selector
 * (`.vditor-ir__marker--pre > code`) is nested under the block, so re-running it scoped to just the
 * block is exactly equivalent to the full walk, just cheaper. Falls back to a full walk (mount pass,
 * ambiguous/large batches) via the same `tagCodeSource(editorEl)` call used before this task.
 */
export function observeCodeSource(
  editorEl: HTMLElement | null | undefined,
): () => void {
  // No editor root mounted yet — nothing to observe; hand back a no-op
  // disposer so callers can always call the returned teardown unconditionally.
  if (!editorEl)
    return () => {
      /* no-op disposer */
    }
  return observeScopedMutations(editorEl, {
    full: tagCodeSource,
    // `editorEl` may be the stable `#app` (finish-init), which also holds the sv pane and the
    // Preview: a block outside the IR surface has nothing to tag, and sv wraps the WHOLE document in
    // one block, so skipping it keeps sv typing off an O(document) query.
    within: (block) => {
      if (block.closest('.vditor-ir')) tagCodeSource(block)
    },
  })
}
