// The lazy Marp chunk (built to media/dist/marp.js, loaded at runtime only when a doc is a
// deck — see marp-preview.ts). marp-core is markdown-it based, independent of Lute/Vditor; the
// deck is a SECOND render of the same source. We keep ONE Marp instance and expose a single
// render() on window so main.js never imports marp-core (no bloat for non-Marp docs).
//
// Marpit wraps output in <div class="marpit"> and scopes the theme CSS under `.marpit` by
// default, so the deck's CSS can't restyle .vditor-reset / .markdown-body. math:false and
// html:false per the Phase-1 spec (no KaTeX; no raw-HTML execution in the deck).
import { Marp } from '@marp-team/marp-core'

const marp = new Marp({ math: false, html: false })

;(window as any).__vmarkdMarp = {
  render(source: string): { html: string; css: string } {
    const { html, css } = marp.render(source)
    return { html, css }
  },
}
