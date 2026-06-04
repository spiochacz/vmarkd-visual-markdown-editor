// Busy cursor for the (slow, synchronous) large-document markdown serialize
// (task 68). The serialize blocks the main thread for seconds; we set a
// progress/wait cursor and yield one paint so the browser shows it BEFORE the
// freeze, then clear it after. (During the freeze itself the page can't repaint,
// so the cursor is the OS-rendered busy cursor — no spinner animation is possible
// on the main thread.) The class is styled in main.css (`body.vmarkd-busy`).

export function setBusyCursor(on: boolean, doc: Document = document): void {
  doc.body.classList.toggle('vmarkd-busy', on)
}

// Resolve after the browser has had a chance to paint (double-rAF → macrotask),
// so a cursor/state set just before is visible before a long synchronous call.
export function nextPaint(
  win: Window & typeof globalThis = window,
): Promise<void> {
  return new Promise((resolve) => {
    win.requestAnimationFrame(() => win.setTimeout(() => resolve(), 0))
  })
}
