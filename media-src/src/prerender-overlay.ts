import { findScroller } from './toolbar-scroll-guard'

// Instant-paint overlay (src/lute-host.ts) + streaming spinner + the prepaint
// scroll bridge. All pure DOM helpers reading window globals — no module state
// shared with main.ts (task 152 item 1).

// Show the REAL toolbar in the instant-paint overlay. Vditor builds its toolbar
// element synchronously in the constructor — with the real icons — but only
// attaches it to #app later, in its post-Lute initUI (~150 ms later). So right
// after `new Vditor()` (it builds synchronously now that i18n is inline) we can
// clone that built element into the overlay's empty
// placeholder bar: the teaser shows the actual toolbar (exact layout + icons, no
// host-side replication) during the Lute wait, and it's dropped with the overlay
// at the swap. Best-effort — a missing element just leaves the empty bar.
export function showRealToolbarInOverlay() {
  // With i18n passed inline (window.VditorI18n, injected by the host before main.js)
  // Vditor builds the toolbar synchronously in its constructor, so the element is
  // usually present the instant `new Vditor()` returns. Still poll per frame as a
  // fallback — if i18n was missing Vditor loads it async and the toolbar appears a
  // few frames later — until it exists (clone it in) or the overlay is gone (swap).
  let tries = 0
  const tick = () => {
    const bar = document.querySelector('#vmarkd-prerender .vditor-toolbar')
    if (!bar) return // overlay already swapped out — nothing to do
    const real = (window.vditor as any)?.vditor?.toolbar?.element as
      | HTMLElement
      | undefined
    if (real) {
      try {
        const clone = real.cloneNode(true) as HTMLElement
        // indent/outdent start disabled in the live editor (Vditor's EditMode
        // calls disableToolbar(["outdent","indent"]) until the caret is in a
        // list). The static clone hasn't run that, so grey them out to match the
        // default state and avoid a flicker when the real toolbar takes over.
        clone
          .querySelectorAll('[data-type="indent"],[data-type="outdent"]')
          .forEach((el) => {
            el.classList.add('vditor-menu--disabled')
          })
        bar.replaceWith(clone)
      } catch {}
      return
    }
    if (tries++ < 90) requestAnimationFrame(tick)
  }
  tick()
}

// Remove the host-side instant-paint overlay (see src/lute-host.ts). Called once
// the live editor is built AND themed (right after applyVditorTheme), so the
// reveal is seamless — no rAF needed. Idempotent + never throws, so it's safe to
// call from a finally as a guaranteed swap even if a later after() helper throws.
export function removePrerenderOverlay() {
  try {
    document.getElementById('vmarkd-prerender')?.remove()
  } catch {}
}

// Streaming spinner (task 49): keeps the top-right "loading" ring spinning after the
// prepaint overlay is swapped out, until a large file finishes streaming in. Styled in
// vscode-chrome.css (#vmarkd-stream-spinner) — subtly distinct from the prepaint
// spinner so the phase change is visible but quiet. Idempotent.
export function showStreamSpinner() {
  if (document.getElementById('vmarkd-stream-spinner')) return
  const dot = document.createElement('span')
  dot.id = 'vmarkd-stream-spinner'
  dot.setAttribute('aria-hidden', 'true')
  dot.title = 'vMarkd: loading large file… (read-only)'
  document.body.appendChild(dot)
}
export function removeStreamSpinner() {
  try {
    document.getElementById('vmarkd-stream-spinner')?.remove()
  } catch {}
}

// Bridge the prepaint scroll into the live editor (task 49). The inline script the
// host injects before main.js (window.__vmarkdScroll) accumulates the user's wheel/key
// scroll from the instant the teaser paints — main.js (the big bundle) executes a beat
// later, so capturing must start earlier than this code runs. Once the editor exists
// we drive its REAL scroll container (findScroller — in the VS Code webview that's
// `pre.vditor-reset`, which has a bounded height and scrolls; in other layouts it's
// the document) to that accumulated offset for a short window. This bridges the swap-in
// gap, INCLUDING the brief moment a freshly-mounted editor isn't yet responding to
// native wheel, and honours a scroll the user began on the teaser. After the window we
// stop accumulating and hand fully back to native scrolling.
interface PrepaintCapture {
  intent: number
  active: boolean
  stop?: () => void
  stopKeys?: () => void
}

// Hand the prepaint teaser scroll (window.__vmarkdScroll) to the live editor.
// Two paths, because they have fundamentally different timing:
//   • streaming (huge files > STREAM_MIN_CHARS): content arrives over time, so the
//     target offset is only reachable as the document grows AND the end-of-load
//     jump-to-top happens seconds later — a bounded rAF window is the simplest fit.
//   • monolithic (the common case): the whole document is laid out at mount, so
//     there is nothing growing over time. Pure event-driven: apply once, then guard
//     ONLY the single spurious jump-to-top reactively until the user takes over —
//     no arbitrary multi-second timer.
export function bridgePrepaintScroll(willStream: boolean): void {
  const cap = (window as any).__vmarkdScroll as PrepaintCapture | undefined
  if (!cap) return
  if (willStream) bridgeStreamingScroll(cap)
  else bridgeMonolithicScroll(cap)
}

function irEditorEl(): HTMLElement | undefined {
  return (window.vditor as any)?.vditor?.ir?.element as HTMLElement | undefined
}

// Streaming path: re-apply intent across the ~3 s load window (content grows; the
// jump-to-top lands at end-of-stream), then hand back to native scrolling.
function bridgeStreamingScroll(cap: PrepaintCapture): void {
  let frames = 0
  let keysStopped = false
  const tick = () => {
    const editorEl = irEditorEl()
    if (editorEl) {
      if (cap.intent === 0) {
        cap.stop?.()
        return
      }
      if (!keysStopped) {
        cap.stopKeys?.()
        keysStopped = true
      }
      const scroller = findScroller(editorEl)
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const target = Math.min(cap.intent, max)
      // Only ever pull DOWN toward the intended offset — honours the teaser scroll,
      // covers the swap-in dead window, and corrects the end-of-stream jump-to-top,
      // without ever yanking the user upward or fighting native scrolling.
      if (scroller.scrollTop < target) scroller.scrollTop = target
    }
    if (frames++ < 180) requestAnimationFrame(tick)
    else cap.stop?.()
  }
  tick()
}

// Monolithic path (the common case): the whole document is rendered by the Vditor
// constructor and is editable BEFORE this runs, and we apply the offset AFTER
// finishInit() (settled layout) — so there's no end-of-load jump-to-top to chase
// (that's a streaming-only symptom). Just apply the teaser offset once and hand
// fully back to native scrolling. No scroll guard, no timer.
function bridgeMonolithicScroll(cap: PrepaintCapture): void {
  const apply = () => {
    const editorEl = irEditorEl()
    if (!editorEl) {
      requestAnimationFrame(apply)
      return
    }
    if (cap.intent > 0) {
      const scroller = findScroller(editorEl)
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      scroller.scrollTop = Math.min(cap.intent, max)
    }
    // stop() removes BOTH the wheel and keydown capture (so a Space typed in the
    // freshly-opened editor isn't read as a teaser PageDown) and marks it inactive.
    cap.stop?.()
  }
  apply()
}
