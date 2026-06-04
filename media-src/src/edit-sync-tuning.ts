// IR-edit responsiveness on large documents (perf C2).
//
// Vditor reserialises the WHOLE document to markdown (Lute `VditorIRDOM2Md`) on a
// debounce keyed off `undoDelay` — and that serialise is super-linear (~5s at
// 4000 paragraphs). On a small doc that's fine; on a large one it freezes the
// editor shortly after every short pause. We can't make the serialise cheap (it's
// upstream Lute), but we CAN make it fire less often by lengthening the idle window
// for large documents, so bursty editing (pauses below the window) no longer
// triggers a freeze mid-edit; the cost is deferred to a real idle / save.
//
// Trade-off: `undoDelay` also controls undo-step granularity, so on large docs an
// undo step spans more edits. Acceptable for responsiveness; small docs keep the
// snappy default. Pure + side-effect-free for unit testing.

// Above this many characters of markdown, a full reserialise is slow enough to be
// disruptive mid-edit (≈hundreds of ms and climbing), so widen the idle window.
export const LARGE_DOC_CHARS = 20_000

export const DEFAULT_UNDO_DELAY = 800
export const LARGE_DOC_UNDO_DELAY = 2_000

// Pick the serialise/undo idle window (ms) for a document of the given length.
export function undoDelayForContentLength(length: number): number {
  return length >= LARGE_DOC_CHARS ? LARGE_DOC_UNDO_DELAY : DEFAULT_UNDO_DELAY
}
