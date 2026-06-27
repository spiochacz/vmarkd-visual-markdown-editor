import { createIncrementalMd } from './incremental-md'
import { createPendingEdit } from './pending-edit'
import { innerVditor } from './inner-vditor'
import { activeModeElement } from './source-map'
import {
  undoDelayForContentLength,
  LARGE_DOC_CHARS,
  useIncrementalSerialize,
} from './edit-sync-tuning'
import { setBusyCursor, nextPaint } from './busy-cursor'
import { logToHost } from './webview-log'

// The debounced edit→host serialize subsystem (task 152 item 1, extracted from
// initVditor). The webview owns the (single) markdown serialize — Vditor no longer
// serializes per input (fixIrInputSerialize patch). On a large doc the serialize is
// multi-second and blocks the thread, so the idle path shows a busy cursor and yields
// a paint before it (task 68); Ctrl/Cmd+S flushes SYNCHRONOUSLY (no yield) so the edit
// is posted before VS Code saves (task 58). Both guard against firing mid
// extension-update / streaming (a partial getValue() would post a truncated document).
//
// Incremental IR serialization (task 69): the full `vditor.getValue()` reserializes the
// whole document (Lute, super-linear) on every idle — seconds on a large doc. For IR we
// instead diff the top-level blocks and re-serialize only what changed, keeping a cached
// full markdown. Proven byte-identical to getValue() (task-69 spike).

/** The live edit-sync controller for one editor instance. */
export interface EditSync {
  /** Schedule a debounced edit→host post (called from Vditor's input()). */
  schedule(): void
  /** Flush the pending edit synchronously (Ctrl/Cmd+S, before VS Code saves). */
  flush(): void
  /** Drop the incremental IR cache when the DOM is rebuilt outside the edit path
   *  (external setValue / streaming) so the next serialize rebaselines cleanly. */
  invalidate(): void
  /** Post the active large-doc helper set to the host (status-bar marker). */
  reportDocMode(): void
}

export interface EditSyncDeps {
  /** True while an extension-update / streaming is in flight — suppress posts (a
   *  partial getValue() would save a truncated document). Read at call time. */
  isSuppressed: () => boolean
  /** Doc-mode flags fixed for the document's lifetime, for the status-bar marker:
   *  content-visibility (≥100 KB) and streaming (>700 KB) are fixed; incremental
   *  serialization (≥700 blocks) can flip as the user edits (recomputed per report). */
  docMode: { cvActive: boolean; streamActive: boolean; docChars: number }
}

export function createEditSync(deps: EditSyncDeps): EditSync {
  const { isSuppressed } = deps
  const { cvActive, streamActive, docChars } = deps.docMode

  const incrementalIr = createIncrementalMd((html: string) =>
    innerVditor()?.lute?.VditorIRDOM2Md(html),
  )
  const irElement = (): HTMLElement | undefined => innerVditor()?.ir?.element
  const irTopBlocks = (el: HTMLElement): string[] =>
    Array.from(el.children, (c) => (c as HTMLElement).outerHTML)
  // Cache is IR-only; re-entering IR (after a mode switch) rebaselines.
  let lastSerializeMode: string | null = null
  const isLargeDoc = () =>
    (activeModeElement(window.vditor)?.textContent?.length ?? 0) >=
    LARGE_DOC_CHARS
  // The incremental serializer pays off only with enough top-level blocks — block COUNT
  // (not byte size) drives the super-linear full-serialize cost (task-69 analysis). Returns
  // the IR element when incremental should be used, else undefined (→ plain getValue()).
  // `children.length` is O(1) and correct for code/lists/tables (each is one block).
  const irIncrementalElement = (): HTMLElement | undefined => {
    const el = irElement()
    return el &&
      useIncrementalSerialize(
        window.vditor.getCurrentMode?.(),
        el.children.length,
      )
      ? el
      : undefined
  }
  const serializeForHost = (): string => {
    const el = irIncrementalElement()
    if (el) {
      if (lastSerializeMode !== 'ir-incremental') incrementalIr.invalidate()
      lastSerializeMode = 'ir-incremental'
      return incrementalIr.update(irTopBlocks(el))
    }
    lastSerializeMode = window.vditor.getCurrentMode?.() ?? null
    return vditor.getValue()
  }

  // Report which large-document helpers are active to the host. Post only when the
  // active SET changes, so it's cheap to call often.
  let lastReportedSig: string | null = null
  const reportDocMode = (): void => {
    const incremental = irIncrementalElement() !== undefined
    const blocks = irElement()?.children.length ?? 0
    const sig = `${cvActive}|${streamActive}|${incremental}`
    if (sig === lastReportedSig) return
    lastReportedSig = sig
    vscode.postMessage({
      command: 'docMode',
      contentVisibility: cvActive,
      streaming: streamActive,
      incremental,
      blocks,
      chars: docChars,
    })
  }

  // Keep Vditor's idle window mode-aware (Vditor reads options.undoDelay live). IR/SV
  // stay snappy (task 69: IR is incremental, SV serialize is trivial); only WYSIWYG, whose
  // full VditorDOM2Md is still super-linear, widens on large docs. Re-evaluated per edit so
  // a mode switch takes effect on the next edit's scheduling.
  const syncUndoDelay = () => {
    const inner = innerVditor()
    if (!inner?.options) return
    const mode = window.vditor.getCurrentMode?.()
    const len =
      mode === 'wysiwyg'
        ? (activeModeElement(window.vditor)?.textContent?.length ?? 0)
        : 0
    inner.options.undoDelay = undoDelayForContentLength(len, mode)
  }

  const postEdit = () => {
    vscode.postMessage({ command: 'edit', content: serializeForHost() })
    reportDocMode()
    syncUndoDelay()
  }
  const pendingEdit = createPendingEdit({
    wait: 250,
    onIdle: async () => {
      if (isSuppressed()) return
      // IR is now incremental → fast even on large docs (no busy cursor). WYSIWYG/SV
      // still do a full getValue(); keep the busy-cursor + paint for that slow path.
      if (window.vditor.getCurrentMode?.() !== 'ir' && isLargeDoc()) {
        setBusyCursor(true)
        await nextPaint() // let the busy cursor paint before the long serialize
        try {
          postEdit()
        } finally {
          setBusyCursor(false)
        }
      } else {
        postEdit()
      }
    },
    onFlush: () => {
      if (isSuppressed()) return
      // Save is authoritative (task 58): on a large IR doc bring the incremental cache
      // current (cheap), then audit it against a full getValue() — drift = a fast-path bug,
      // log + resync so a bad incremental result can never corrupt a saved file. Small docs
      // (below the block-count gate) serialize directly.
      const incrEl = irIncrementalElement()
      if (incrEl) {
        const incremental = incrementalIr.update(irTopBlocks(incrEl))
        const authoritative = vditor.getValue()
        if (incremental !== authoritative) {
          logToHost(
            '[task69] incremental IR markdown drifted from full serialize on save; using authoritative + resyncing',
          )
          incrementalIr.invalidate()
        }
        vscode.postMessage({ command: 'edit', content: authoritative })
      } else {
        vscode.postMessage({ command: 'edit', content: vditor.getValue() })
      }
    },
  })

  return {
    schedule: () => pendingEdit.schedule(),
    flush: () => pendingEdit.flush(),
    invalidate: () => incrementalIr.invalidate(),
    reportDocMode,
  }
}
