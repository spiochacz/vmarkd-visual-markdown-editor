// Marp preview intercept (task 107). Installs window.__vmarkdRenderMarpPreview, the gate the
// esbuild patch calls inside Vditor's preview render. For a `marp: true` doc it returns the Marp
// deck HTML (string) to drop into `.vditor-preview`; else null → Vditor's normal Lute render.
//
// Sync contract: Vditor's render is synchronous, but the marp chunk loads async. If the chunk
// isn't loaded yet we kick off loadMarp(), return a placeholder, and repaint via
// vditor.preview.render once it lands (then the chunk is cached → synchronous). Also owns the
// deck sync: caret→active-slide highlight + click→source-offset, targeting the preview's sections.
import { parseMarpEnabled } from '../../src/marp-detect'
import { loadMarp, renderMarpPreview, type MarpApi } from './marp-preview'
import { offsetForSlideIndex, slideIndexForOffset } from './marp-slide-map'

const PLACEHOLDER = '<div class="vmarkd-marp__error">Loading Marp…</div>'
let api: MarpApi | null = null

function repaint(): void {
  const v = (window as any).vditor
  // Re-run Vditor's preview render now that the chunk is loaded (synchronous this time).
  v?.vditor?.preview?.render?.(v.vditor) ?? v?.preview?.render?.(v)
}

/** Install the gate. Idempotent. */
export function installMarpPreview(): void {
  ;(window as any).__vmarkdRenderMarpPreview = (
    markdownText: string,
  ): string | null => {
    if (!parseMarpEnabled(markdownText)) return null
    if (api) return renderMarpPreview(markdownText, api)
    // Chunk not ready: load, then repaint. Show a placeholder this pass.
    loadMarp()
      .then((a) => {
        api = a
        repaint()
      })
      .catch(() => {
        /* leave the placeholder; load failed */
      })
    return PLACEHOLDER
  }
  installDeckSync()
}

// ── Deck sync (forward: caret→highlight; reverse: click→source offset) ──────────────────────
const PREVIEW_SEL = '.vditor-preview'
const ACTIVE = 'vmarkd-marp__active'

function previewSections(): HTMLElement[] {
  const preview = document.querySelector<HTMLElement>(PREVIEW_SEL)
  if (!preview || preview.style.display === 'none') return []
  return Array.from(preview.querySelectorAll<HTMLElement>('section'))
}

let activeIdx = -1
/** Highlight + scroll the preview deck to the slide containing `offset`. No-op if no deck shown. */
export function highlightPreviewSlide(source: string, offset: number): void {
  const sections = previewSections()
  if (!sections.length) return
  const idx = slideIndexForOffset(source, offset)
  if (idx < 0 || idx >= sections.length || idx === activeIdx) return
  sections.forEach((s, i) => {
    s.classList.toggle(ACTIVE, i === idx)
  })
  sections[idx].scrollIntoView({ block: 'nearest' })
  activeIdx = idx
}

function installDeckSync(): void {
  // Reverse-nav: click a slide in the preview → report its source offset. Delegated so it survives
  // the preview being re-rendered. (The host consumer of __vmarkdMarpNav is wired separately.)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    const section = target?.closest('section')
    const preview = target?.closest(PREVIEW_SEL)
    if (!section || !preview) return
    const sections = Array.from(preview.querySelectorAll('section'))
    const idx = sections.indexOf(section)
    if (idx < 0) return
    const src = (window as any).vditor?.getValue?.() ?? ''
    ;(window as any).__vmarkdMarpNav?.(offsetForSlideIndex(src, idx))
  })
}
