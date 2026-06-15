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

declare class SmiDrawer {
  constructor(moleculeOptions: object, reactionOptions: object)
  draw: (code: string, selector: string, theme?: string) => void
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

/** Re-draw every smiles preview inside `root` that has no `<svg>` (un-rendered or flattened). */
export function repairSmiles(root: ParentNode, dark: boolean): void {
  const Drawer = (window as unknown as { SmiDrawer?: typeof SmiDrawer })
    .SmiDrawer
  if (typeof Drawer !== 'function') return // smiles-drawer not loaded yet; a later mutation retries
  const broken = Array.from(
    root.querySelectorAll<HTMLElement>(PREVIEW_SEL),
  ).filter((code) => !code.querySelector('svg'))
  if (broken.length === 0) return
  let seq = 0
  for (const code of broken) {
    const smiles = smilesFor(code)
    if (!smiles) continue
    const id = `vmsmiles-${Date.now().toString(36)}-${seq++}`
    code.innerHTML = `<svg id="${id}"></svg>`
    // Mark processed so Vditor's own SMILESRender won't fight us (it also keys off data-processed).
    code.setAttribute('data-processed', 'true')
    try {
      new Drawer({}, {}).draw(smiles, `#${id}`, dark ? 'dark' : undefined)
    } catch {
      // smiles-drawer throws on a malformed string — leave the (empty) svg, don't crash the editor
    }
  }
}

/**
 * Keep smiles previews rendered as the editor rebuilds/round-trips its DOM. rAF-debounced; idempotent
 * (skips previews that already hold an `<svg>`), so our own re-draws don't re-trigger it into a loop.
 * `isDark` is read live so a theme flip re-draws with the right palette. Returns a disposer.
 */
export function observeSmiles(
  appEl: HTMLElement | null | undefined,
  isDark: () => boolean,
): () => void {
  if (!appEl) return () => {}
  let raf = 0
  const run = () => {
    raf = 0
    repairSmiles(appEl, isDark())
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
