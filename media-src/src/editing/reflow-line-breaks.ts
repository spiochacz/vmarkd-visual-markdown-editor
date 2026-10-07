// Task 83 (increment 2) — `vmarkd.editor.reflowLineBreaks`, the PREVIEW half. A soft line break (a
// single newline inside a paragraph) flows like GitHub / the VS Code preview when on; off keeps every
// source line on its own line. The editable IR/WYSIWYG/SV surfaces are NOT touched here (their DOM
// is the same either way — a later increment decorates them).
//
// The Preview renders with the SAME Lute instance as the editors, whose SoftBreak2HardBreak default is
// true (soft break -> <br>). Build patch `patchPreviewReflow` routes that one Md2HTML call through
// `window.__vmarkdPreviewMd2HTML` (boot/preload.ts); the option is flipped only around it, so every
// other Md2HTML consumer (copy-as-HTML, getHTML, …) is unchanged.
//
// `reflow === undefined` = never applied (a harness that skips the config) -> stock Lute.
import { innerVditor } from '../util/inner-vditor'

let reflow: boolean | undefined

interface MdLute {
  SetSoftBreak2HardBreak(on: boolean): void
  Md2HTML(md: string): string
}

/** Apply the setting. Returns true when the effective value changed (caller re-renders an open preview). */
export function applyReflowLineBreaks(value: boolean | undefined): boolean {
  const next = value !== false
  const changed = reflow !== next
  reflow = next
  return changed
}

export function getReflowLineBreaks(): boolean | undefined {
  return reflow
}

/** Test seam: back to "never applied". */
export function resetReflowLineBreaksForTest(): void {
  reflow = undefined
}

/** `lute.Md2HTML(md)` with soft breaks reflowed (or kept) per the setting. */
export function previewMd2Html(lute: MdLute, md: string): string {
  if (reflow === undefined) return lute.Md2HTML(md)
  lute.SetSoftBreak2HardBreak(!reflow)
  try {
    return lute.Md2HTML(md)
  } finally {
    lute.SetSoftBreak2HardBreak(true)
  }
}

/** Best-effort live refresh of an OPEN Preview overlay / split right pane after the setting flipped. */
export function rerenderOpenPreview(): void {
  const inner = innerVditor() as {
    preview?: { element?: HTMLElement; render?: (v: unknown) => void }
  } | null
  const preview = inner?.preview
  if (!preview?.element || preview.element.style.display === 'none') return
  preview.render?.(inner)
}
