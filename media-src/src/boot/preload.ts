// fix cannot find global
;(window as any).global = window.global || globalThis

// Task 370: hand every Lute instance to the whitespace-gap repair the moment Vditor creates it
// (our setLute build patch calls this global). It has to be installed before ANY Vditor is
// constructed — Vditor renders the initial value from initUI, before `options.after` — and this
// module is the one thing both main.ts and every e2e harness import first, so the editor and the
// harnesses cannot drift apart on it.
import { patchLuteGapRepair } from '../../../src/shared/lute-gap-repair'
// Task 530: a hard line break keeps its form through Lute itself (build-time patch); this only keeps the
// pending-break line placeholder on the spin output (see patchLuteHardBreaks).
import { patchLuteHardBreaks } from '../../../src/shared/lute-hard-break'
// Task 83: the Preview's Md2HTML call goes through this hook (patchPreviewReflow). Unset until the
// setting is applied, so a harness that never wires the config keeps stock Lute.
import { previewMd2Html } from '../editing/reflow-line-breaks'
;(window as any).__vmarkdPreviewMd2HTML = previewMd2Html
;(window as any).__vmarkdPatchLute = (lute: any) => {
  patchLuteGapRepair(lute)
  patchLuteHardBreaks(lute)
}

// Task 470 — acquire the vscode postMessage handle here too, for the same "every real entry
// point imports this module first" reason as __vmarkdPatchLute above: main.ts and every e2e
// harness entry (media-src/e2e/*-harness.ts) already `import './preload'` (or './preload')
// as their first line, so this is the codebase's existing shared-bootstrap slot rather than a new
// pattern — a call repeated at 7 independent entry points would drift (as it already had:
// `raw-href.ts`'s comment on the OLD import-time side effect this replaced was worded differently
// from the others). vscode-api.ts itself stays free of import-time side effects (so a plain unit
// test can import it, or any module that merely re-exports its types, without a `window`-less
// crash) — initVsCodeApi() is idempotent (acquireVsCodeApi() throws if actually called twice per
// webview), so this one call covers every entry point without any of them having to remember it.
import { initVsCodeApi } from '../util/vscode-api'
initVsCodeApi()
