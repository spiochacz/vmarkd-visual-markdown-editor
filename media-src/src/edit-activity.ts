// Task 161 step 1 — debounce diagram re-render while the user is typing (+ swap-when-ready, step 3).
//
// Editing a diagram's source in an IR code block re-spins the whole IR DOM on every keystroke
// (SpinVditorIRDOM): the rendered SVG is destroyed and Vditor re-runs the engine via processCodeRender
// (ir/input.ts) — mermaid ~670 ms PER keystroke, d2 a WASM compile, graphviz viz.js, etc. (baseline:
// test/vscode-e2e/d2-edit-perf.spec.ts). That freezes the main thread while you type. This gate defers
// the heavy re-render until the user pauses (~QUIET_MS) and coalesces the burst into ONE render.
//
// Vditor does NOT hide the preview while a block is expanded (the diagram stays visible BELOW the
// source you're editing — confirmed in _ir.less), so a naive defer would flicker the diagram. We keep
// the LAST render on screen via a cached, Lute-invisible overlay (data-render="1" → skipped by both AST
// walkers) and only SWAP it out once the new render is actually ready (swap-when-ready): the old image
// stays put while the engine re-renders into the (still-hidden) source child, then we reveal atomically
// — no flash to raw source ("przeskok przez białe tło z napisami").
//   - SVG engines render fine into a display:none child (they don't measure the container).
//   - CANVAS engines (echarts/mindmap/stl) DO measure → they render into a visible child kept under an
//     opaque absolute overlay (".vmarkd-cover"), revealed when the new <canvas> lands.
//
// Two render paths consult this gate:
//   - Vditor-native engines: the processCodeRender loop in ir/input.ts is routed through
//     window.__vmarkdDeferIrDiagramRender (esbuild patchIrDeferDiagramRender) — defined here.
//   - our observeCustomDiagrams (d2/wavedrom/nomnoml/geojson/topojson/vega/stl): it calls isTyping()
//     and defers its pass; on settle it calls beginSettleRender()/scheduleReveal() like the native path.

const QUIET_MS = 220
const REVEAL_TIMEOUT_MS = 3000 // force-reveal if a render never produces an svg/canvas (e.g. an error)

let timer = 0
const settleCbs = new Map<string, () => void>()

function fire(): void {
  timer = 0
  const cbs = Array.from(settleCbs.values())
  settleCbs.clear()
  for (const cb of cbs) {
    try {
      cb()
    } catch {
      /* a failed settle render must not wedge the gate */
    }
  }
}

/** True while the user is mid-burst (a keystroke landed within the last QUIET_MS). */
export function isTyping(): boolean {
  return timer !== 0
}

/** (Re)arm the quiet-timer — called on every editor input (capture phase). */
export function markEditActivity(): void {
  // On the FIRST keystroke of a burst (timer still idle), snapshot the diagrams' CURRENT renders — this
  // runs in the input CAPTURE phase, BEFORE Vditor's spin destroys them, so the overlay has a fresh
  // last-good image. Doing it only once per burst (not on every DOM mutation) is what keeps it cheap:
  // an earlier MutationObserver-driven snapshot rasterised every canvas via toDataURL ~20×/s while the
  // diagrams idle-animated, blocking the main thread (~25%) and stuttering scroll after an edit.
  if (!timer) snapshotRenders()
  if (timer) clearTimeout(timer)
  timer = window.setTimeout(fire, QUIET_MS)
}

/** Run cb once the user pauses; latest wins per key, so N keystrokes coalesce into one render. */
export function deferUntilSettle(key: string, cb: () => void): void {
  settleCbs.set(key, cb)
  if (!timer) timer = window.setTimeout(fire, QUIET_MS)
}

// Heavy Vditor-native engines whose per-keystroke render is the measured stutter — skipped while typing.
const NATIVE_DEFER = new Set([
  'mermaid',
  'graphviz',
  'echarts',
  'flowchart',
  'plantuml',
  'mindmap',
  'markmap',
  'abc',
  'smiles',
])
// Every diagram language whose rendered output we keep visible (overlay) during a burst — native +
// the custom-observer family (rendered by observeCustomDiagrams).
const CACHED = new Set([
  ...NATIVE_DEFER,
  'd2',
  'wavedrom',
  'nomnoml',
  'geojson',
  'topojson',
  'vega',
  'vega-lite',
  'stl',
])
// Canvas/WebGL engines measure their container, so they CAN'T render into a display:none child — they
// render visible under an opaque cover overlay instead. (The rest are SVG → render fine while hidden.)
const CANVAS_LANGS = new Set([
  'echarts',
  'mindmap',
  'stl',
  'geojson',
  'topojson',
])

const STALE_CLASS = 'vmarkd-deferred' // typing / svg-settle: source children display:none, overlay static
const COVER_CLASS = 'vmarkd-cover' // canvas-settle: source visible+sized, overlay absolute opaque on top
const OVERLAY_CLASS = 'vmarkd-stale-overlay'

// Last rendered VISUAL snapshot (svg outerHTML, or an <img> of a canvas), keyed `${lang}#${ordinal}`
// (ordinal = position among IR code-block nodes of that language; stable during a typing burst).
const renderCache = new Map<string, string>()

function irRoot(): HTMLElement | null {
  return document.querySelector('.vditor-ir')
}

// The language always lives on the editable SOURCE code (`.vditor-ir__marker--pre code.language-X`),
// which persists whether the preview is raw or rendered — unlike the preview's firstElementChild,
// which becomes the <svg> once rendered.
function nodeLang(node: Element): string {
  const code = node.querySelector('.vditor-ir__marker--pre code')
  const m =
    code && /(?:^|\s)language-([\w-]+)/.exec((code as HTMLElement).className)
  return m ? m[1] : ''
}

function ordinalOf(node: Element, lang: string, root: HTMLElement): number {
  let i = 0
  for (const n of Array.from(
    root.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
  )) {
    if (nodeLang(n) === lang) {
      if (n === node) return i
      i++
    }
  }
  return -1
}

function previewOf(node: Element): HTMLElement | null {
  return node.querySelector('.vditor-ir__preview')
}

// The diagram render lives INSIDE the `.language-X` wrapper. Scope to that — other svgs in the preview
// are Vditor UI (the copy-code button is `<svg><use #vditor-icon-copy>`), which must NOT be treated as
// the render (snapshotting it showed a "copy" icon instead of the diagram).
const RENDER_SEL = '[class*="language-"] svg, [class*="language-"] canvas'

// A render is "present" once the diagram wrapper holds an svg/canvas OUTSIDE our overlay (i.e. the
// engine finished re-rendering into the source child).
function hasFreshRender(preview: Element): boolean {
  for (const el of Array.from(preview.querySelectorAll(RENDER_SEL))) {
    if (!el.closest(`.${OVERLAY_CLASS}`)) return true
  }
  return false
}

// A clean, language-class-free snapshot of the current render so the overlay never re-matches an
// engine's element selector. Canvas can't be cloned (its bitmap is lost) → rasterise via toDataURL.
function visualSnapshot(preview: Element): string | null {
  for (const el of Array.from(preview.querySelectorAll(RENDER_SEL))) {
    if (el.closest(`.${OVERLAY_CLASS}`)) continue
    if (el instanceof HTMLCanvasElement) {
      try {
        return `<img class="vmarkd-stale-img" alt="" src="${el.toDataURL()}">`
      } catch {
        return null // tainted canvas — fall through (no overlay; brief flash, rare)
      }
    }
    return (el as SVGElement).outerHTML
  }
  return null
}

// Show the cached last-good render in a deferred preview. Called SYNCHRONOUSLY from the patched
// processCodeRender loop (before paint) → no flicker to raw source. The overlay is appended AFTER the
// source <code> (which stays firstElementChild, so processCodeRender's language switch still works) and
// carries data-render="1" so Lute never serialises it.
function restoreOverlay(node: Element, lang: string, root: HTMLElement): void {
  const preview = previewOf(node)
  if (!preview) return
  preview.classList.remove(COVER_CLASS)
  if (preview.querySelector(`.${OVERLAY_CLASS}`)) {
    preview.classList.add(STALE_CLASS)
    return
  }
  const ord = ordinalOf(node, lang, root)
  const html = ord >= 0 ? renderCache.get(`${lang}#${ord}`) : undefined
  if (!html) return // nothing cached yet (first keystroke before any render) → raw shows briefly
  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS
  overlay.setAttribute('data-render', '1')
  overlay.innerHTML = html
  preview.classList.add(STALE_CLASS)
  preview.appendChild(overlay)
}

function revealPreview(preview: Element): void {
  for (const o of Array.from(preview.querySelectorAll(`.${OVERLAY_CLASS}`)))
    o.remove()
  preview.classList.remove(STALE_CLASS, COVER_CLASS)
}

// At settle, before the engines re-render: switch the CANVAS-engine previews from the display:none
// "deferred" state into the "cover" state (source child visible + sized so echarts/three can measure;
// the opaque overlay still hides it). SVG previews stay deferred (they render fine while hidden).
export function beginSettleRender(): void {
  const root = irRoot()
  if (!root) return
  for (const node of Array.from(
    root.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
  )) {
    const lang = nodeLang(node)
    if (!CANVAS_LANGS.has(lang)) continue
    const preview = previewOf(node)
    if (preview?.classList.contains(STALE_CLASS)) {
      preview.classList.remove(STALE_CLASS)
      preview.classList.add(COVER_CLASS)
    }
  }
}

// Reveal each deferred/cover preview the moment its new render lands (swap-when-ready), with a timeout
// fallback so an erroring render never gets stuck behind a stale overlay. Paused while the user types.
let revealRaf = 0
let revealDeadline = 0
function revealTick(): void {
  revealRaf = 0
  const root = irRoot()
  if (!root) return
  if (isTyping()) {
    // a new burst started — don't swap mid-typing; restoreOverlay handles the visuals, just wait.
    revealDeadline = performance.now() + REVEAL_TIMEOUT_MS
    revealRaf = requestAnimationFrame(revealTick)
    return
  }
  const now = performance.now()
  let remaining = false
  for (const preview of Array.from(
    root.querySelectorAll(`.${STALE_CLASS}, .${COVER_CLASS}`),
  )) {
    if (hasFreshRender(preview) || now > revealDeadline) revealPreview(preview)
    else remaining = true
  }
  if (remaining) revealRaf = requestAnimationFrame(revealTick)
}
export function scheduleReveal(): void {
  revealDeadline = performance.now() + REVEAL_TIMEOUT_MS
  if (!revealRaf) revealRaf = requestAnimationFrame(revealTick)
}

// Decision hook called from the patched ir/input.ts processCodeRender loop. While typing, cached
// diagram langs are skipped (and shown via the cached overlay); the heavy NATIVE engines are
// re-rendered once on settle. Cheap langs (code highlight, math) render immediately as before.
function deferIrDiagramRender(
  vditor: { ir: { element: HTMLElement } },
  processCodeRender: (el: HTMLElement, v: unknown) => void,
): void {
  const root = vditor.ir.element
  const previews = Array.from(
    root.querySelectorAll<HTMLElement>(".vditor-ir__preview[data-render='2']"),
  )
  let deferredNative = false
  for (const preview of previews) {
    const node = preview.closest('.vditor-ir__node')
    const lang = node ? nodeLang(node) : ''
    if (isTyping() && CACHED.has(lang)) {
      if (node) restoreOverlay(node, lang, root)
      if (NATIVE_DEFER.has(lang)) deferredNative = true
      continue // skip the heavy render this keystroke
    }
    processCodeRender(preview, vditor)
  }
  if (deferredNative) {
    deferUntilSettle('ir-native-diagrams', () => {
      beginSettleRender() // canvas previews → cover mode (visible+sized under the overlay)
      vditor.ir.element
        .querySelectorAll<HTMLElement>(".vditor-ir__preview[data-render='2']")
        .forEach((it) => {
          processCodeRender(it, vditor)
        })
      scheduleReveal() // swap each overlay out when its new render lands
    })
  }
}

// Keep renderCache fresh: snapshot a preview once it actually holds a render, but ONLY when the user
// isn't typing AND the preview isn't one of our overlays (so we never cache the stale image we
// injected). Read-only — it can't loop the observer. rAF-coalesced so the open-time render burst
// doesn't pay per-mutation.
function snapshotRenders(): void {
  const root = irRoot()
  if (!root || isTyping()) return
  for (const node of Array.from(
    root.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
  )) {
    const lang = nodeLang(node)
    if (!CACHED.has(lang)) continue
    const preview = previewOf(node)
    if (
      !preview ||
      preview.classList.contains(STALE_CLASS) ||
      preview.classList.contains(COVER_CLASS)
    )
      continue
    const html = visualSnapshot(preview)
    if (!html) continue
    const ord = ordinalOf(node, lang, root)
    if (ord >= 0) renderCache.set(`${lang}#${ord}`, html)
  }
}

// Install: arm the gate on every editor input (CAPTURE phase → runs BEFORE Vditor's own input handler,
// so isTyping() is already true when the processCodeRender loop runs in the same tick) and expose the
// native defer hook for the esbuild patch. The render cache is captured on the first keystroke of a
// burst (see markEditActivity) — NOT via a MutationObserver, which rasterised canvases continuously and
// stuttered scrolling while the diagrams idle-animated.
export function installEditActivity(
  app: HTMLElement | null | undefined,
): () => void {
  if (!app) return () => {}
  ;(window as unknown as Record<string, unknown>).__vmarkdDeferIrDiagramRender =
    deferIrDiagramRender
  const onInput = () => markEditActivity()
  app.addEventListener('input', onInput, true)
  return () => {
    app.removeEventListener('input', onInput, true)
    if (timer) {
      clearTimeout(timer)
      timer = 0
    }
    if (revealRaf) {
      cancelAnimationFrame(revealRaf)
      revealRaf = 0
    }
    settleCbs.clear()
    delete (window as unknown as Record<string, unknown>)
      .__vmarkdDeferIrDiagramRender
  }
}
