// Inline zoom/pan for the STATIC-SVG diagram renderers (d2, mermaid, flowchart, graphviz, abc,
// smiles). markmap + the ECharts mindmap already pan/zoom via their own engines (gated by
// diagram-zoom-gate.ts) and are intentionally excluded here.
//
// Interaction (chosen with the user): wheel = zoom toward the cursor, left-drag = pan, double-click =
// reset, and a ⛶ button (top-right) opens a fullscreen view. Wheel is preventDefault'd over a diagram
// so it zooms rather than scrolls the page — the diagram is an interactive surface. (A richer
// fullscreen *preview* — overlay chrome, controls — is task 157; here ⛶ just requests native
// fullscreen on the container, which the same transform handlers keep working inside.)
//
// The transform lives on the <svg> (transformOrigin 0 0; `translate(tx,ty) scale(k)`); SVG is
// resolution-independent so scaling never blurs. State is per-svg in a WeakMap. Idempotent + driven by
// a MutationObserver on #app, so it covers async D2 renders, per-keystroke Vditor rebuilds, and IR/
// WYSIWYG/Preview switches. Scoped to RENDERED diagrams inside a preview pane — never editable source.

const STATIC_SVG_DIAGRAM = [
  '.language-d2',
  '.language-mermaid',
  '.language-flowchart',
  '.language-graphviz',
  '.language-abc',
  '.language-smiles',
].join(',')
const PREVIEW_PANES =
  '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview'

const MIN_K = 0.4
const MAX_K = 12
// The ⛶ fullscreen button is disabled until the proper fullscreen *preview* is designed (task 157).
// Inline zoom/pan still ships; flip this to re-enable the button once task 157 lands.
const FULLSCREEN_BUTTON = false

interface ZoomState {
  k: number
  tx: number
  ty: number
}
// Keyed by the WRAPPER, not the <svg>: the wrapper persists across a re-render (reRenderD2 swaps
// wrapper.innerHTML on a theme switch), the <svg> does not — so zoom/pan state must outlive the svg.
const stateOf = new WeakMap<HTMLElement, ZoomState>()

function apply(svg: SVGElement, st: ZoomState): void {
  svg.style.transform = `translate(${st.tx.toFixed(2)}px, ${st.ty.toFixed(2)}px) scale(${st.k.toFixed(4)})`
}

function reset(svg: SVGElement, st: ZoomState): void {
  st.k = 1
  st.tx = 0
  st.ty = 0
  apply(svg, st)
}

// A diagram is a rendered static-SVG block inside a preview pane (not the editable source).
function decorate(wrapper: HTMLElement): void {
  const svg = wrapper.querySelector('svg')
  if (!svg) return // D2/async renderers attach the <svg> later — the observer will retry then.

  // The wrapper clips the zoomed/panned svg; the svg transforms from its top-left. Re-apply on EVERY
  // pass: a re-render (reRenderD2 on a theme switch) replaces the svg, and we must re-style + re-apply
  // the saved transform to the new one. State is per-wrapper so zoom/pan survives the re-render.
  svg.style.transformOrigin = '0 0'
  const existing = stateOf.get(wrapper)
  const st: ZoomState = existing ?? { k: 1, tx: 0, ty: 0 }
  if (!existing) stateOf.set(wrapper, st)
  apply(svg, st)

  if (wrapper.dataset.vmarkdZoom === '1') return // handlers already bound — don't duplicate
  wrapper.dataset.vmarkdZoom = '1'
  wrapper.style.position ||= 'relative'
  wrapper.style.overflow = 'hidden'

  // Handlers resolve the CURRENT svg via wrapper.querySelector (NOT a closure) — a re-render swaps the
  // svg out, and a stale closure would transform the detached old node (the reported "pan stops working
  // after a D2 theme reload"). The wrapper + its `st` persist, so the gestures keep working.
  // Ctrl/Cmd + wheel = zoom toward the cursor; a PLAIN wheel is left alone so the page scrolls (no
  // hijack — "przy dojechaniu do diagramu zaczyna zmieniać rozmiar"). Same model as markmap/mindmap.
  wrapper.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return // plain wheel → page scrolls (don't hijack)
      const cur = wrapper.querySelector('svg')
      if (!cur) return
      e.preventDefault()
      const rect = wrapper.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const newK = Math.min(MAX_K, Math.max(MIN_K, st.k * factor))
      if (newK === st.k) return
      // Keep the point under the cursor fixed: tx' = px - (px - tx) * newK/k.
      const ratio = newK / st.k
      st.tx = px - (px - st.tx) * ratio
      st.ty = py - (py - st.ty) * ratio
      st.k = newK
      apply(cur, st)
    },
    { passive: false },
  )

  // Ctrl/Cmd + left-drag = pan. A plain drag is left alone (text selection / normal behaviour).
  let dragging = false
  let sx = 0
  let sy = 0
  wrapper.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || (!e.ctrlKey && !e.metaKey)) return
    dragging = true
    sx = e.clientX - st.tx
    sy = e.clientY - st.ty
    const cur = wrapper.querySelector('svg')
    if (cur) cur.style.cursor = 'grabbing'
    wrapper.setPointerCapture(e.pointerId)
  })
  wrapper.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return
    const cur = wrapper.querySelector('svg')
    if (!cur) return
    st.tx = e.clientX - sx
    st.ty = e.clientY - sy
    apply(cur, st)
  })
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    const cur = wrapper.querySelector('svg')
    if (cur) cur.style.cursor = ''
    try {
      wrapper.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }
  wrapper.addEventListener('pointerup', endDrag)
  wrapper.addEventListener('pointercancel', endDrag)

  // Double-click = reset to the fit-width view.
  wrapper.addEventListener('dblclick', (e) => {
    e.preventDefault()
    const cur = wrapper.querySelector('svg')
    if (cur) reset(cur, st)
  })

  // ⛶ fullscreen button (top-right). data-render="1" keeps it out of any Lute serialization (defense
  // in depth — preview panes aren't serialized, but this can't leak even if one races a serialize).
  // Gated off until task 157 designs the real fullscreen preview (the click below is the minimal
  // native-fullscreen entry point it will replace).
  if (FULLSCREEN_BUTTON) {
    const btn = document.createElement('button')
    btn.className = 'vmarkd-diagram-fs'
    btn.type = 'button'
    btn.title = 'Fullscreen'
    btn.setAttribute('aria-label', 'Fullscreen diagram')
    btn.setAttribute('data-render', '1')
    btn.textContent = '⛶'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      // webview may block the Fullscreen API — task 157 will add an in-webview overlay fallback
      void wrapper.requestFullscreen?.()?.catch(() => {})
    })
    wrapper.appendChild(btn)
  }
}

function decorateAll(root: ParentNode): void {
  for (const pane of root.querySelectorAll<HTMLElement>(PREVIEW_PANES)) {
    if (pane.matches(STATIC_SVG_DIAGRAM)) decorate(pane)
    for (const d of pane.querySelectorAll<HTMLElement>(STATIC_SVG_DIAGRAM))
      decorate(d)
  }
  // A diagram block can itself be the pane (rare) — also handle top-level matches under root.
  for (const d of root.querySelectorAll<HTMLElement>(STATIC_SVG_DIAGRAM)) {
    if (d.closest(PREVIEW_PANES)) decorate(d)
  }
}

let observer: MutationObserver | null = null

/** Wire inline zoom/pan + the ⛶ button on every rendered static-SVG diagram. Idempotent; observes
 *  #app so it survives async renders, per-keystroke rebuilds, and mode switches. Returns a disposer. */
export function observeDiagramZoom(app: HTMLElement | null): () => void {
  if (!app) return () => {}
  let scheduled = false
  const run = () => {
    scheduled = false
    decorateAll(app)
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(run)
  }
  observer?.disconnect()
  observer = new MutationObserver(schedule)
  observer.observe(app, { childList: true, subtree: true })
  schedule()
  return () => {
    observer?.disconnect()
    observer = null
  }
}
