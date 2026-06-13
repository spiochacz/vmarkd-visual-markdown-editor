import { loadMarp, injectDeck } from '../src/marp-preview'
import {
  mountMarpPanel,
  slideIndexForOffset,
  offsetForSlideIndex,
  type MarpPanel,
} from '../src/marp-panel'
import { observeSlideOverlay } from '../src/marp-slide-overlay'

;(window as any).__vmarkdMarpSrc = '/marp-chunk.js'

const panel = document.getElementById('panel') as HTMLElement
const mount = document.getElementById('mount') as HTMLElement

;(window as any).__renderDeck = async (source: string): Promise<number> => {
  const marp = await loadMarp()
  return injectDeck(panel, source, marp)
}
;(window as any).__marpLoaded = () => !!(window as any).__vmarkdMarp

// Panel mount over a fake editor element. We stub window.vditor.getValue() so the panel's
// reverse-nav reads the current source; the spec sets it per render.
let currentSource = ''
;(window as any).vditor = { getValue: () => currentSource }

let lastNavOffset = -1
;(window as any).__vmarkdMarpNav = (off: number) => {
  lastNavOffset = off
}
;(window as any).__lastNavOffset = () => lastNavOffset

let mp: MarpPanel | null = null
;(window as any).__mountPanel = async (source: string): Promise<void> => {
  currentSource = source
  mp?.dispose()
  const editorRoot = document.createElement('div')
  editorRoot.className = 'vditor'
  mount.appendChild(editorRoot)
  mp = mountMarpPanel(editorRoot, source)
  await loadMarp() // ensure the deck has rendered before the spec asserts
  await new Promise((r) => setTimeout(r, 50))
}
;(window as any).__setCaretToSlide = (idx: number) => {
  const off = offsetForSlideIndex(currentSource, idx)
  mp?.highlightForOffset(currentSource, off)
}
;(window as any).__activeSlideIndex = () => mp?.activeIndex() ?? -1
;(window as any).__slideIndexForOffset = (off: number) =>
  slideIndexForOffset(currentSource, off)

const editor = document.getElementById('editor') as HTMLElement
let disposeOverlay: (() => void) | null = null
// Build an editable-like element: paragraphs separated by top-level <hr>s. Idempotent — only
// rebuilds when the editor is empty so a snapshot taken between build and overlay-mount is stable.
const buildEditor = (hrCount: number) => {
  if (editor.querySelector('p')) return
  editor.innerHTML = ''
  for (let i = 0; i <= hrCount; i++) {
    const p = document.createElement('p')
    p.textContent = `slide ${i + 1} content`
    p.style.height = '80px'
    editor.appendChild(p)
    if (i < hrCount) editor.appendChild(document.createElement('hr'))
  }
}
;(window as any).__buildEditor = (hrCount: number) => buildEditor(hrCount)
;(window as any).__mountOverlay = (hrCount: number) => {
  buildEditor(hrCount)
  disposeOverlay?.()
  disposeOverlay = observeSlideOverlay(editor)
}
;(window as any).__editorHtml = () => {
  // The editable content, EXCLUDING the overlay layer (which is appended last).
  const clone = editor.cloneNode(true) as HTMLElement
  clone.querySelector('.vmarkd-marp-overlay')?.remove()
  return clone.innerHTML
}
;(window as any).__editorHrCount = () =>
  Array.from(editor.children).filter(
    (el) => (el as HTMLElement).tagName === 'HR',
  ).length

;(window as any).__ready = true
