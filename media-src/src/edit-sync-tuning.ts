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

// Gate for the incremental IR serializer (task 69). The full `VditorIRDOM2Md` cost is
// driven by the number of top-level BLOCKS, not bytes — measured: at a fixed ~40k-char
// size the cost swings 8.9ms→67ms (7.5×) purely with block count, while at a fixed block
// count it barely moves with content length. So we gate on block count, not chars.
// At ~700 blocks the full serialize crosses one frame (~16ms) and climbs super-linearly
// past it; below that getValue() is already instant, so the incremental diff machinery
// (and its tiny drift risk) isn't worth it. `ir.element.children.length` reads this in O(1)
// and is correct for code blocks / lists / tables (each is one block = one serialize unit).
export const INCREMENTAL_MIN_BLOCKS = 700

// Pick the serialise/undo idle window (ms) for a document of the given length.
export function undoDelayForContentLength(length: number): number {
  return length >= LARGE_DOC_CHARS ? LARGE_DOC_UNDO_DELAY : DEFAULT_UNDO_DELAY
}
