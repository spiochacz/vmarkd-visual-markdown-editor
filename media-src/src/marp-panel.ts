// Marp right panel (task 107). Owns the panel DOM, the draggable splitter, the open/collapse
// toggle, width/open persistence (localStorage — self-contained, no host round-trip), and the
// deck re-render. The deck itself is rendered by marp-preview.ts. Gated on Marp being enabled
// (parseMarpEnabled on the live source, re-checked on each edit). Mode-agnostic: the panel sits
// beside whatever editor mode is active.
import { parseMarpEnabled } from '../../src/marp-detect'
import { injectDeck, loadMarp, type MarpApi } from './marp-preview'

const OPEN_KEY = 'vmarkd.marp.open'
const WIDTH_KEY = 'vmarkd.marp.width'
const MIN_WIDTH = 240
const MAX_WIDTH_RATIO = 0.7
const DEFAULT_WIDTH = 0.5 // fraction of the wrapper

export interface MarpPanel {
  /** Re-render the deck from new source (called on the debounced edit signal). */
  update(source: string): void
  /** Tear down: remove DOM + listeners. */
  dispose(): void
  /** The deck container element (for the overlay/sync to read slide positions). */
  readonly deckEl: HTMLElement
}

// localStorage access is best-effort: webview storage can be disabled or quota-exceeded, in which
// case getItem/setItem throw synchronously. Wrap so a throw never leaves drag/teardown half-done.
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage disabled / quota — persistence is best-effort */
  }
}

function readWidth(wrapperWidth: number): number {
  const saved = Number(lsGet(WIDTH_KEY))
  if (saved >= MIN_WIDTH)
    return Math.max(MIN_WIDTH, Math.min(saved, wrapperWidth * MAX_WIDTH_RATIO))
  return Math.round(wrapperWidth * DEFAULT_WIDTH)
}

/**
 * Mount the panel as a sibling of `editorRoot` inside a flex wrapper. Returns null (no-op) when
 * Marp is disabled for the initial `source`. `editorRoot` is the Vditor element
 * (window.vditor.vditor.element); we wrap it + the panel in a flex row.
 */
export function mountMarpPanel(
  editorRoot: HTMLElement,
  source: string,
): MarpPanel | null {
  if (!parseMarpEnabled(source)) return null

  const wrapper = document.createElement('div')
  wrapper.className = 'vmarkd-marp__wrapper'
  editorRoot.parentElement?.insertBefore(wrapper, editorRoot)
  wrapper.appendChild(editorRoot)
  editorRoot.classList.add('vmarkd-marp__editor')

  const splitter = document.createElement('div')
  splitter.className = 'vmarkd-marp__splitter'
  wrapper.appendChild(splitter)

  const panel = document.createElement('div')
  panel.className = 'vmarkd-marp__panel'
  wrapper.appendChild(panel)

  const header = document.createElement('div')
  header.className = 'vmarkd-marp__header'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'vmarkd-marp__toggle'
  toggle.textContent = 'Marp'
  toggle.setAttribute('aria-label', 'Toggle Marp slide panel')
  header.appendChild(toggle)
  panel.appendChild(header)

  const deckEl = document.createElement('div')
  deckEl.className = 'vmarkd-marp__panelbody'
  panel.appendChild(deckEl)

  // Open/collapsed state.
  const setOpen = (open: boolean) => {
    wrapper.classList.toggle('vmarkd-marp--collapsed', !open)
    toggle.setAttribute('aria-pressed', String(open))
    lsSet(OPEN_KEY, open ? '1' : '0')
  }
  setOpen(lsGet(OPEN_KEY) !== '0') // open by default

  // Width.
  const applyWidth = (w: number) => {
    panel.style.width = `${w}px`
  }
  applyWidth(readWidth(wrapper.clientWidth || window.innerWidth))

  toggle.addEventListener('mousedown', (e) => e.preventDefault()) // keep editor focus
  toggle.addEventListener('click', () => {
    setOpen(wrapper.classList.contains('vmarkd-marp--collapsed'))
  })

  // Drag the splitter to resize (mirrors outline-resize.ts).
  let dragging = false
  let startX = 0
  let startW = 0
  let raf = 0
  let pendingW = 0
  const onMove = (e: MouseEvent) => {
    if (!dragging) return
    const maxW = Math.floor(
      (wrapper.clientWidth || window.innerWidth) * MAX_WIDTH_RATIO,
    )
    pendingW = Math.min(
      maxW,
      Math.max(MIN_WIDTH, startW + (startX - e.clientX)),
    )
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        applyWidth(pendingW)
      })
  }
  const onUp = () => {
    if (!dragging) return
    dragging = false
    document.body.classList.remove('vmarkd-marp__resizing')
    if (panel.offsetWidth > 0) lsSet(WIDTH_KEY, String(panel.offsetWidth))
  }
  splitter.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault()
    dragging = true
    startX = e.clientX
    startW = panel.offsetWidth
    document.body.classList.add('vmarkd-marp__resizing')
  })
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)

  // Render.
  let api: MarpApi | null = null
  let pending: string | null = null
  const doRender = (src: string) => {
    if (api) injectDeck(deckEl, src, api)
    else pending = src
  }
  loadMarp()
    .then((a) => {
      api = a
      doRender(pending ?? source)
      pending = null
    })
    .catch((err) => {
      deckEl.innerHTML = ''
      const msg = document.createElement('div')
      msg.className = 'vmarkd-marp__error'
      msg.textContent = `Marp failed to load: ${(err as Error)?.message ?? err}`
      deckEl.appendChild(msg)
    })

  return {
    deckEl,
    update(src: string) {
      // If frontmatter flipped marp off, blank the deck (panel stays; cheap, avoids re-layout
      // churn — a full unmount/remount on every toggle is deferred to a later increment).
      if (!parseMarpEnabled(src)) {
        deckEl.innerHTML = ''
        return
      }
      doRender(src)
    },
    dispose() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (raf) cancelAnimationFrame(raf)
      // Unwrap: move the editor back out and remove the wrapper.
      editorRoot.classList.remove('vmarkd-marp__editor')
      wrapper.parentElement?.insertBefore(editorRoot, wrapper)
      wrapper.remove()
    },
  }
}
