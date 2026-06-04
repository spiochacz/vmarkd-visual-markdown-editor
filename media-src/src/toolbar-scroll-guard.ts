// Scroll preservation for toolbar clicks.
//
// When a large doc is scrolled WITHOUT a caret ever being placed, a toolbar action makes
// Vditor fall back to a doc-start caret and re-render (getEditorRange's fallback, EditMode
// focus, a mode switch). The re-render replaces the editor's innerHTML, which resets the
// scroll container's scrollTop to 0 SILENTLY (no scroll event) — so the view jumps to the
// top. The reset is often DEBOUNCED (the IR input re-render lands ~250ms after the click),
// so a single post-click restore is too early. Instead we snapshot the scroller on toolbar
// mousedown (capture, before Vditor) and then PIN it for a short window after the click:
// the first frame the view jumps upward we restore it and stop. It's a no-op when the
// click didn't move the scroll (a real caret → local re-render → scroll already preserved),
// and it only ever corrects an upward jump (never yanks the user down).
const PIN_MS = 600

// Nearest scrollable ancestor of `start` (overflow auto/scroll/overlay AND actually
// overflowing); falls back to the document scroller. Lets callers target whatever
// element really scrolls in the current layout (pre.vditor-reset in the VS Code webview,
// the document elsewhere).
export function findScroller(start: HTMLElement): HTMLElement {
  let el: HTMLElement | null = start
  while (el && el !== document.body) {
    const oy = getComputedStyle(el).overflowY
    if (
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      return el
    }
    el = el.parentElement
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement
}

export function guardToolbarScroll(vditor: any): void {
  const toolbar = document.querySelector('.vditor-toolbar')
  if (!toolbar || (toolbar as { __vmScrollGuard?: boolean }).__vmScrollGuard)
    return
  ;(toolbar as { __vmScrollGuard?: boolean }).__vmScrollGuard = true
  const editorEl = (): HTMLElement | undefined =>
    vditor?.vditor?.[vditor.getCurrentMode()]?.element as
      | HTMLElement
      | undefined
  let saved = -1
  toolbar.addEventListener(
    'mousedown',
    (event) => {
      const el = editorEl()
      saved = el ? findScroller(el).scrollTop : -1
      // Prevent the focus shift the mousedown would otherwise cause: moving focus to
      // the button (or onto the editor) makes the browser scroll the editor's caret —
      // which sits at the top when the user only scrolled and never placed one — into
      // view, jerking the viewport to the top WHILE the button is pressed. Suppressing
      // the default keeps focus/selection put (this is exactly what Vditor already does
      // for its built-in formatting buttons), so there's no scroll to undo. Click still
      // fires, so every button keeps working.
      event.preventDefault()
    },
    true,
  )
  // The editor wrapper — a stable ancestor we can observe for re-renders across mode
  // switches (the per-mode element itself gets replaced).
  const root = toolbar.parentElement || document.body
  toolbar.addEventListener('click', () => {
    if (saved < 0) return
    const target = saved
    saved = -1
    const restore = () => {
      const el = editorEl()
      if (!el) return
      const sc = findScroller(el)
      // Only ever pull UP toward target — never fight a downward user scroll.
      if (sc.scrollTop < target - 4) {
        const max = Math.max(0, sc.scrollHeight - sc.clientHeight)
        sc.scrollTop = Math.min(target, max)
      }
    }
    // 1) Synchronous restore, same task as the click. A SYNCHRONOUS re-render (e.g. a
    //    mode switch: Vditor's button handler runs, re-renders, THEN this bubble
    //    listener runs) has already reset scrollTop to 0 by now — restoring here, before
    //    the task yields, means the browser never paints the top state → no flash.
    restore()
    // 2) The re-render can also be DEBOUNCED (the IR format path re-renders ~250ms
    //    later) and resets scrollTop by REPLACING the editor's innerHTML. A
    //    MutationObserver callback runs as a microtask right after that mutation —
    //    before the next paint — so restoring there avoids a flash too (a plain
    //    requestAnimationFrame restore runs one painted frame too late). Observe the
    //    editor wrapper so it also catches a full re-render on a later mode switch.
    const mo = new MutationObserver(restore)
    mo.observe(root, { childList: true, subtree: true })
    // rAF fallback to bound the window and catch any non-mutation reset (e.g. a focus
    // scroll), then disconnect. Restores are upward-only, so this can't fight the user.
    const start = performance.now()
    const tick = () => {
      restore()
      if (performance.now() - start < PIN_MS) requestAnimationFrame(tick)
      else mo.disconnect()
    }
    requestAnimationFrame(tick)
  })
}
