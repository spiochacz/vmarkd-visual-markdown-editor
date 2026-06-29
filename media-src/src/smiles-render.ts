// SMILES (chemical structure) diagrams — re-render any preview whose SVG got flattened to text.
//
// Lute emits the smiles preview wrapper as `<code class="language-smiles">` — NOT a `<div>` like
// mermaid/echarts. On a DIRECT WYSIWYG open Vditor round-trips the WYSIWYG DOM through Lute at mount
// AFTER smiles-drawer has drawn the SVG; Lute treats the `<code>`-wrapped preview as a code block and
// FLATTENS the SVG to its text content (you see the SVG's internal `<style>` CSS + atom labels as raw
// text — "blok znika"), and `data-processed="true"` then sticks so Vditor never re-renders it. The
// `<div>`-wrapped diagrams (mermaid/echarts) survive the same round-trip, which is why only smiles
// breaks. The editable SOURCE keeps the real SMILES, so we re-draw the preview from it.
//
// Verified real-VS-Code-only (the Playwright harness never round-trips the drawn SVG, so it can't
// reproduce); confirmed via the xvfb real-vscode suite: drawn at ~500ms, flattened at ~1000ms,
// re-draw-from-source restores the 539×539 SVG.

import { renderDiagramError } from './diagram-error'

declare class SmiDrawer {
  constructor(moleculeOptions: object, reactionOptions: object)
  // draw(smiles, selector, theme, successCb, errorCb). smiles-drawer's draw() CATCHES a malformed-
  // SMILES parser error internally and routes it to the 5th-arg error callback — falling back to a
  // bare `console.error` if none is passed. It does NOT re-throw, so the error callback is the ONLY
  // way to detect a bad SMILES; without it a malformed molecule silently leaves an empty <svg>.
  draw: (
    code: string,
    selector: string,
    theme?: string,
    successCallback?: ((el: unknown) => void) | null,
    errorCallback?: (error: unknown) => void,
  ) => void
}

// Preview surfaces that carry an EDITABLE source we can recover from (NOT the standalone `.vditor-
// preview` pane — it renders fine via previewRender and has no source sibling).
const PREVIEW_SEL =
  '.vditor-wysiwyg__preview > code.language-smiles, .vditor-ir__preview > code.language-smiles'

/** The real SMILES for a (possibly flattened) preview `<code>`: prefer the block's editable source,
 *  fall back to the preview's own text unless it looks like a flattened SVG (`{`, `}`, `font:`). */
function smilesFor(code: HTMLElement): string {
  const block =
    code.closest('.vditor-wysiwyg__block') ?? code.closest('.vditor-ir__node')
  const src = block?.querySelector<HTMLElement>(
    'pre.vditor-wysiwyg__pre > code, pre.vditor-ir__marker--pre > code',
  )
  const fromSource = src?.textContent?.trim()
  if (fromSource) return fromSource
  const own = code.textContent?.trim() ?? ''
  return /[{}]|font:/.test(own) ? '' : own
}

/** Is the EFFECTIVE background behind `el` dark? smiles-drawer's palette must contrast the page the
 *  molecule actually sits on — and that page is the CONTENT theme's background, NOT the VS Code editor
 *  mode (a light content theme under a dark VS Code paints a white page, where the `dark` palette's
 *  white skeleton vanishes — "za jasny na białym tle"). Walk up to the first opaque background and
 *  judge it by luminance, so the molecule always contrasts whatever is actually behind it. */
function bgIsDark(el: HTMLElement): boolean {
  let node: Element | null = el
  while (node) {
    const m = getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/)
    if (m) {
      const [r, g, b, a] = m[1].split(',').map((s) => Number.parseFloat(s))
      if (a === undefined || a > 0)
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5
    }
    node = node.parentElement
  }
  return false // nothing opaque found → assume light (the webview default)
}

/**
 * (Re)draw every smiles preview inside `root` so it (a) has an SVG and (b) is themed for the page it
 * sits on. Redraws when: the preview has NO svg (un-rendered/flattened), the svg is Vditor's own (not
 * ours — Vditor themes by editor mode, which can mismatch the content-theme background), or the page
 * darkness changed since we last drew it (live theme flip). Idempotent once ours matches the bg, so
 * the observer doesn't loop.
 */
export function repairSmiles(root: ParentNode): void {
  const Drawer = (window as unknown as { SmiDrawer?: typeof SmiDrawer })
    .SmiDrawer
  if (typeof Drawer !== 'function') return // smiles-drawer not loaded yet; a later mutation retries
  let seq = 0
  for (const code of Array.from(
    root.querySelectorAll<HTMLElement>(PREVIEW_SEL),
  )) {
    const dark = bgIsDark(code)
    const svg = code.querySelector('svg')
    // Skip only if WE drew it (id prefix) AND for the current page darkness — otherwise re-theme.
    if (
      svg?.id.startsWith('vmsmiles-') &&
      code.dataset.vmsmilesDark === `${dark}`
    )
      continue
    const smiles = smilesFor(code)
    if (!smiles) continue
    // If we already rendered the error box for THIS exact source, skip — the box-render is itself a
    // mutation that re-fires the observer, so without this it would loop. Re-attempt once the source
    // changes (signature differs) — i.e. the user fixes the SMILES.
    if (
      code.dataset.vmsmilesErr === smiles &&
      code.querySelector('.vmarkd-diagram-error')
    )
      continue
    const id = `vmsmiles-${Date.now().toString(36)}-${seq++}`
    code.innerHTML = `<svg id="${id}"></svg>`
    // Mark processed so Vditor's own SMILESRender won't fight us (it also keys off data-processed).
    code.setAttribute('data-processed', 'true')
    code.dataset.vmsmilesDark = `${dark}`
    delete code.dataset.vmsmilesErr
    // Surface a malformed SMILES as the shared themed error box (task 178) instead of a silent empty
    // svg. smiles-drawer does NOT throw — its draw() catches the parser error and only `console.error`s
    // it unless we pass the 5th-arg error callback; the callback fires SYNCHRONOUSLY inside draw()
    // (parse + draw are sync), so recording vmsmilesErr here still gates the observer's re-render loop.
    // Keep the outer try/catch as belt-and-braces in case a future version re-throws instead.
    const onError = (error: unknown) => {
      code.dataset.vmsmilesErr = smiles
      renderDiagramError(code, 'smiles', error)
    }
    try {
      new Drawer({}, {}).draw(
        smiles,
        `#${id}`,
        dark ? 'dark' : 'light',
        null,
        onError,
      )
    } catch (error) {
      onError(error)
    }
  }
}

/**
 * Keep smiles previews rendered (and correctly themed) as the editor rebuilds/round-trips its DOM.
 * rAF-debounced; idempotent once a preview holds OUR svg themed for its current background, so our
 * re-draws don't re-trigger it into a loop. Page darkness is read per-preview (bgIsDark) so a theme
 * flip re-draws with the right palette automatically. Returns a disposer.
 */
export function observeSmiles(
  appEl: HTMLElement | null | undefined,
): () => void {
  if (!appEl) return () => {}
  let raf = 0
  const run = () => {
    raf = 0
    repairSmiles(appEl)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run)
  }
  const obs = new MutationObserver(schedule)
  obs.observe(appEl, { childList: true, subtree: true })
  // Initial sweep after the first render settles (smiles-drawer loads async).
  schedule()
  return () => {
    obs.disconnect()
    if (raf) cancelAnimationFrame(raf)
  }
}
