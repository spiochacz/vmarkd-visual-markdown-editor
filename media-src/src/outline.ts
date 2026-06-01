import type Vditor from 'vditor'

// Flash the heading you click in the outline (task 13). Vditor's outline items
// carry `span[data-target-id]` = the heading element's id; after Vditor scrolls
// to it, we flash that heading. Mode-independent (IR/WYSIWYG/SV) — it resolves
// the heading by id, so there is no source-line mapping to get wrong.

export const FLASH_CLASS = 'heading-flash'
const SCROLL_SETTLE_MS = 60
const FLASH_DURATION_MS = 1400

export function setupOutlineFlash(vditor: Vditor): void {
  const outlineEl: HTMLElement | undefined = (vditor as any)?.vditor?.outline
    ?.element
  if (!outlineEl) {
    return
  }
  // Capture phase: Vditor's own outline handler (on the inner list) calls
  // stopPropagation() on item clicks, so a bubble-phase listener here would
  // never fire. Capture runs top-down before that, so we still see the click.
  outlineEl.addEventListener(
    'click',
    (e) => {
      const item = (e.target as HTMLElement | null)?.closest('[data-target-id]')
      const id = item?.getAttribute('data-target-id')
      if (!id) {
        return
      }
      // Let Vditor scroll first, then flash the heading it landed on.
      setTimeout(() => flashHeading(id), SCROLL_SETTLE_MS)
    },
    true,
  )
}

export function flashHeading(id: string): void {
  const heading = document.getElementById(id)
  if (!heading) {
    return
  }
  heading.classList.add(FLASH_CLASS)
  setTimeout(() => heading.classList.remove(FLASH_CLASS), FLASH_DURATION_MS)
}
