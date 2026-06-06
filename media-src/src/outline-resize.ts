// Drag-resize handle for the Vditor outline panel (tasks 07/08).
//
// Inserts a thin draggable handle as a SIBLING of .vditor-outline (not a child
// — Vditor uses `this.element.lastElementChild` as the outline render target,
// so appending a child inside it hijacks the render). The handle is positioned
// absolute relative to the outline's parent (the vditor content wrapper).
//
// Min 100px, max 50% viewport. Calls `onResize(width)` on mouseup so the
// caller can persist the value.

const MIN_WIDTH = 100
const MAX_WIDTH_RATIO = 0.5

export function setupOutlineResize(
  outlineEl: HTMLElement,
  position: 'left' | 'right',
  onResize: (width: number) => void,
): void {
  const parent = outlineEl.parentElement
  if (!parent || parent.querySelector('.outline-resize-handle')) return

  const handle = document.createElement('div')
  handle.className = 'outline-resize-handle'
  handle.dataset.side = position === 'right' ? 'left' : 'right'

  if (position === 'right') {
    parent.insertBefore(handle, outlineEl)
  } else {
    outlineEl.insertAdjacentElement('afterend', handle)
  }

  let dragging = false
  let startX = 0
  let startW = 0
  let rafId = 0
  let pendingW = 0

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault()
    dragging = true
    startX = e.clientX
    startW = outlineEl.offsetWidth
    document.body.classList.add('outline-resizing')
  })

  const applyWidth = () => {
    document.body.style.setProperty('--me-outline-width', `${pendingW}px`)
    rafId = 0
  }

  const onMove = (e: MouseEvent) => {
    if (!dragging) return
    const maxW = Math.floor(window.innerWidth * MAX_WIDTH_RATIO)
    const delta = position === 'right' ? startX - e.clientX : e.clientX - startX
    pendingW = Math.min(maxW, Math.max(MIN_WIDTH, startW + delta))
    if (!rafId) rafId = requestAnimationFrame(applyWidth)
  }

  const onUp = () => {
    if (!dragging) return
    dragging = false
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
      applyWidth()
    }
    document.body.classList.remove('outline-resizing')
    const finalW = outlineEl.offsetWidth
    if (finalW > 0) onResize(finalW)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
