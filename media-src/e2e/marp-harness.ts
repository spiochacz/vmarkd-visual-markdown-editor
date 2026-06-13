import {
  installMarpPreview,
  highlightPreviewSlide,
} from '../src/marp-preview-intercept'

;(window as any).__vmarkdMarpSrc = '/marp-chunk.js'

const preview = document.querySelector('.vditor-preview') as HTMLElement
const reset = preview.querySelector('.vditor-reset') as HTMLElement
let source = ''
let lastNavOffset = -1
;(window as any).__vmarkdMarpNav = (o: number) => {
  lastNavOffset = o
}
;(window as any).__lastNavOffset = () => lastNavOffset

// Minimal Vditor stub: preview.render writes the gate's HTML (or a Lute-ish fallback) into reset.
;(window as any).vditor = {
  getValue: () => source,
  vditor: {
    preview: {
      render() {
        const html = (window as any).__vmarkdRenderMarpPreview(source)
        reset.innerHTML = html ?? `<p>lute: ${source.length} chars</p>`
      },
    },
  },
}

installMarpPreview()

;(window as any).__setSource = (s: string) => {
  source = s
}
;(window as any).__renderPreview = () =>
  (window as any).vditor.vditor.preview.render()
;(window as any).__sectionCount = () => reset.querySelectorAll('section').length
;(window as any).__previewVisible = (v: boolean) => {
  preview.style.display = v ? 'block' : 'none'
}
;(window as any).__highlight = (off: number) =>
  highlightPreviewSlide(source, off)
;(window as any).__activeIdx = () =>
  Array.from(reset.querySelectorAll('section')).findIndex((s) =>
    (s as HTMLElement).classList.contains('vmarkd-marp__active'),
  )
;(window as any).__marpLoaded = () => !!(window as any).__vmarkdMarp
;(window as any).__ready = true
