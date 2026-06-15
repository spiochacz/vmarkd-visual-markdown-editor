// abc (music notation, abcjs) renders an `<svg width="W" height="H">` with NO viewBox. Without a
// viewBox the svg's coordinate system is 1:1 with pixels, so CSS `max-width` shrinks the svg's
// viewport box but the notation stays at its original coordinates and just CLIPS (doesn't scale) —
// it's even clipped at the default column width (intrinsic ~755px > the ~545px column). Give the svg
// a viewBox; then the CSS in main.css (`max-width:100%`, `height:auto`) scales the content
// responsively.
//
// Use the CONTENT bbox (getBBox), NOT the width/height attrs: abcjs pads the svg far wider than the
// actual notation (width attr ~755 but the staff is only ~450 wide), so an attrs-based viewBox would
// scale that trailing whitespace in too → a big empty margin on the right. The content bbox crops to
// the real notation so it fills the column. getBBox is safe here (abc is a static one-shot render
// with no d3 transition — unlike markmap, whose mid-fit bbox blew up). Idempotent: `:not([viewBox])`.

/** Give every abc svg lacking a viewBox one tight to its rendered content (getBBox). */
export function fitAbc(root: ParentNode): void {
  const svgs = root.querySelectorAll<SVGSVGElement>(
    '.language-abc svg:not([viewBox])',
  )
  for (const svg of Array.from(svgs)) {
    let bb: { x: number; y: number; width: number; height: number }
    try {
      bb = (svg as unknown as SVGGraphicsElement).getBBox()
    } catch {
      continue // getBBox throws on a detached/0-size svg
    }
    if (bb.width < 1 || bb.height < 1) continue // not rendered yet
    // A hair of padding so strokes at the edges aren't clipped by the tight bbox.
    const pad = 2
    const w = bb.width + pad * 2
    const h = bb.height + pad * 2
    svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${w} ${h}`)
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    // Pin the intrinsic size to the CONTENT size (abcjs's width attr is ~755, far wider than the
    // staff) so `max-width:100%` caps abc at its NATURAL size — it renders at most this big when the
    // column is wide (not upscaled to fill it) and only shrinks when the column is narrower. Without
    // this the viewBox would scale the content UP to the full column (bigger than before).
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(h))
  }
}

/**
 * Keep abc svgs responsive as the editor renders/rebuilds them. rAF-debounced; idempotent (a svg with
 * a viewBox is skipped, and the observer watches childList/subtree — not attributes — so our own
 * viewBox write doesn't re-trigger it). Returns a disposer.
 */
export function observeAbc(appEl: HTMLElement | null | undefined): () => void {
  if (!appEl) return () => {}
  let raf = 0
  const run = () => {
    raf = 0
    fitAbc(appEl)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run)
  }
  const obs = new MutationObserver(schedule)
  obs.observe(appEl, { childList: true, subtree: true })
  schedule()
  return () => {
    obs.disconnect()
    if (raf) cancelAnimationFrame(raf)
  }
}
