// Marp slide-card overlay (task 107). CSS can't group a run of siblings between <hr>s, and
// injecting wrapper <div>s into the contenteditable tree is rejected (Lute could serialize them
// → breaks round-trip + caret). Instead an OVERLAY layer: a non-editable, pointer-events:none
// element positioned over the editor that measures top-level <hr> positions and draws subtle card
// frames + slide numbers. The editable DOM is never touched → `---` round-trips unchanged.
// Recompute on MutationObserver (DOM rebuilds per edit) + ResizeObserver (reflow). Mirrors the
// observe/teardown shape of callouts.ts. Mount only for the active IR/WYSIWYG element; in source
// mode there is no overlay.

const OVERLAY_CLASS = 'vmarkd-marp-overlay'
const CARD_CLASS = 'vmarkd-marp-card'

function topWithin(container: HTMLElement, el: HTMLElement): number {
  return (
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  )
}

/** Build/refresh the card rectangles from the editor's top-level <hr> positions. */
function layout(editor: HTMLElement, overlay: HTMLElement): void {
  // Top-level <hr>s are the slide breaks. Slides = breaks + 1.
  const hrs = (Array.from(editor.children) as HTMLElement[]).filter(
    (el) => el.tagName === 'HR',
  )
  const boundaries: number[] = [0]
  for (const hr of hrs) boundaries.push(topWithin(editor, hr))
  boundaries.push(editor.scrollHeight)

  // Reconcile card count.
  const cards = Array.from(
    overlay.querySelectorAll<HTMLElement>(`.${CARD_CLASS}`),
  )
  const wanted = boundaries.length - 1
  while (cards.length < wanted) {
    const card = document.createElement('div')
    card.className = CARD_CLASS
    const num = document.createElement('span')
    num.className = 'vmarkd-marp-card__num'
    card.appendChild(num)
    overlay.appendChild(card)
    cards.push(card)
  }
  while (cards.length > wanted) {
    const extra = cards.pop()
    extra?.remove()
  }

  cards.forEach((card, i) => {
    const top = boundaries[i]
    const height = Math.max(0, boundaries[i + 1] - boundaries[i])
    card.style.top = `${top}px`
    card.style.height = `${height}px`
    const num = card.querySelector('.vmarkd-marp-card__num')
    if (num) num.textContent = String(i + 1)
  })
}

/**
 * Mount the overlay over `editor` (the active IR/WYSIWYG element). Returns a disposer. The
 * overlay is inserted as a sibling inside the editor's offsetParent so absolute positioning lines
 * up with the editor's scroll content.
 */
export function observeSlideOverlay(
  editor: HTMLElement | null | undefined,
): () => void {
  if (!editor) return () => {}
  // Ensure the editor is a positioning context for the absolutely-placed overlay.
  if (getComputedStyle(editor).position === 'static') {
    editor.style.position = 'relative'
  }
  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS
  overlay.setAttribute('contenteditable', 'false')
  editor.appendChild(overlay)

  let raf = 0
  const run = () => {
    raf = 0
    layout(editor, overlay)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run)
  }
  const mo = new MutationObserver(schedule)
  mo.observe(editor, { childList: true, subtree: true, characterData: true })
  const ro = new ResizeObserver(schedule)
  ro.observe(editor)
  run()

  return () => {
    mo.disconnect()
    ro.disconnect()
    if (raf) cancelAnimationFrame(raf)
    overlay.remove()
  }
}
