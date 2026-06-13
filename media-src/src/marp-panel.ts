// Marp right panel (task 107). Owns the panel DOM, the draggable splitter, the open/collapse
// toggle, width/open persistence (localStorage — self-contained, no host round-trip), and the
// deck re-render. The deck itself is rendered by marp-preview.ts. Gated on Marp being enabled
// (parseMarpEnabled on the live source, re-checked on each edit). Mode-agnostic: the panel sits
// beside whatever editor mode is active.
import { parseMarpEnabled } from '../../src/marp-detect'
import { injectDeck, loadMarp, type MarpApi } from './marp-preview'

/**
 * First content line AFTER a leading YAML frontmatter block (--- … ---). Returns 0 when there is
 * no frontmatter. Shared by both map helpers so their frontmatter-skip can't diverge.
 */
function frontmatterStartLine(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0
  for (let k = 1; k < lines.length; k++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[k])) return k + 1
  }
  return 0
}

/**
 * Source offset → slide index: the number of top-level `---` slide-break lines before `offset`.
 * Frontmatter's closing `---` is NOT a slide break, so we start counting after the frontmatter
 * block. A line is a slide break only if it is exactly `---` on its own (trimmed). Monotonic: the
 * frontmatter end is computed from the FULL source and breaks are compared by line-start offset,
 * so the index never flips up-then-down as `offset` crosses a `---` boundary.
 */
export function slideIndexForOffset(source: string, offset: number): number {
  const lines = source.split(/\r?\n/)
  const start = frontmatterStartLine(lines)
  const clamped = Math.max(0, offset)
  let slide = 0
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    if (i >= start && lines[i].trim() === '---' && pos < clamped) slide++
    pos += lines[i].length + 1
  }
  return slide
}

/** Source offset of the START of slide `index`'s content (line after its opening `---`). */
export function offsetForSlideIndex(source: string, index: number): number {
  const lines = source.split(/\r?\n/)
  const start = frontmatterStartLine(lines)
  if (index <= 0) {
    return charOffsetOfLine(lines, start)
  }
  let slide = 0
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      slide++
      if (slide === index) return charOffsetOfLine(lines, i + 1)
    }
  }
  return charOffsetOfLine(lines, lines.length)
}

// Assumes LF line endings (`+1` per line for the stripped `\n`); the editor source is LF.
function charOffsetOfLine(lines: string[], line: number): number {
  let off = 0
  for (let i = 0; i < Math.min(line, lines.length); i++)
    off += lines[i].length + 1
  return off
}

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
  /** Highlight + scroll the deck to the slide at this source offset. */
  highlightForOffset(source: string, offset: number): void
  /** Active slide index currently highlighted (or -1). */
  activeIndex(): number
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

  let activeSlide = -1
  const highlight = (idx: number) => {
    const sections = deckEl.querySelectorAll<HTMLElement>('section')
    if (idx < 0 || idx >= sections.length) return
    if (activeSlide === idx) return
    sections.forEach((s, i) => {
      s.classList.toggle('vmarkd-marp__active', i === idx)
    })
    sections[idx].scrollIntoView({ block: 'nearest' })
    activeSlide = idx
  }

  // Reverse-nav: clicking a slide places the caret at its source start. We post a host message
  // (the host owns reveal-in-source); the webview also moves Vditor's caret if it can map offset
  // → DOM. For P1 we post the offset; the host/main.ts caret move reuses existing reveal wiring.
  deckEl.addEventListener('click', (e) => {
    const section = (e.target as HTMLElement)?.closest('section')
    if (!section) return
    const sections = Array.from(deckEl.querySelectorAll('section'))
    const idx = sections.indexOf(section)
    if (idx < 0) return
    const src = (window as any).vditor?.getValue?.() ?? ''
    const offset = offsetForSlideIndex(src, idx)
    ;(window as any).__vmarkdMarpNav?.(offset)
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
    highlightForOffset(src: string, offset: number) {
      highlight(slideIndexForOffset(src, offset))
    },
    activeIndex() {
      return activeSlide
    },
  }
}
