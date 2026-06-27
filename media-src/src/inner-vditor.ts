// Typed accessor for the Vditor INTERNAL instance (window.vditor.vditor — Vditor's
// own IVditor, which the published `vditor` types don't expose). main.ts reached it
// ~11× via `(window.vditor as any).vditor.<x>`; this centralises those casts behind
// one documented surface (task 152 item 2) covering only the internals we touch, so a
// Vditor shape change surfaces here instead of at every call site.
export interface InnerVditor {
  ir?: { element?: HTMLElement }
  wysiwyg?: { element?: HTMLElement }
  preview?: { previewElement?: HTMLElement }
  outline?: { element?: HTMLElement }
  options?: { undoDelay?: number; cdn?: string }
  lute?: { VditorIRDOM2Md(html: string): string }
}

/** The Vditor internal instance, or null before the first init. */
export function innerVditor(): InnerVditor | null {
  return (
    (window.vditor as unknown as { vditor?: InnerVditor } | null)?.vditor ??
    null
  )
}
