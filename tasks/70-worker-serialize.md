# Task: Off-main-thread markdown serialize (Web Worker)

> **Status:** 🅿️ PARKED (2026-06-05). [Task 69 — incremental serialize](69-incremental-ir-serialize.md)
> (merged, PR #69) already removed the large-doc edit freeze (O(block) instead of O(doc)),
> so the Worker win is no longer needed. Revisit only if the very largest docs still stutter
> after incremental serialize. **Source:** follow-up to
> [68 — IR edit latency](68-ir-edit-serialize-perf.md) / [69 — incremental serialize](69-incremental-ir-serialize.md).
> **Value / Risk:** 🟢🟢 the only approach that makes large-doc editing both
> *responsive AND visibly working* (animated spinner) / medium-high (worker plumbing;
> hinges on Lute running in a Worker).

## Why
`getMarkdown` (IR) = `lute.VditorIRDOM2Md(ir.element.innerHTML)` is synchronous and
super-linear (~5s @ 4000 paragraphs — see task 68). On the main thread it freezes the
editor: caret stops, and any "busy" UI can't animate (no repaint during the freeze).
Task 68 deferred + cursor-wrapped it, but the freeze remains, and there's a *second*
sync cost (Vditor's undo-stack diff, ~100–300ms) we can't pre-paint either.

A Web Worker moves the serialize off the main thread → the editor stays responsive,
the host-sync happens in the background, and the top-right spinner (task 49,
`showStreamSpinner`) can **actually animate** while it runs.

## Spike FIRST (go/no-go)
Lute is a Go→JS/WASM bundle (`media/vditor/dist/js/lute/lute.min.js`). Verify it loads
and runs in a Worker:
1. Worker: `importScripts('/vditor/dist/js/lute/lute.min.js')`, `const lute = Lute.New()`,
   `lute.VditorIRDOM2Md(htmlString)` → markdown.
2. **Risk:** the bundle may touch `window`/`document` at load (GopherJS/Go-WASM output
   sometimes does) → throws in a Worker. If so, this approach is blocked — STOP and
   report (fall back to task 69 incremental, or accept task 68).
3. Confirm the markdown matches main-thread `VditorIRDOM2Md` for the same HTML (a battery
   of docs incl. lists/tables/defs).

## Design (if spike passes)
- `media-src/src/serialize-worker.ts` (worker entry) + a `media-src/src/serialize-client.ts`
  main-thread client: `serialize(html): Promise<string>` (postMessage round-trip, request id).
- Host-sync (`pending-edit` onIdle): read `ir.element.innerHTML` (cheap, ~2ms) on the main
  thread, send to the worker, `await` the markdown, post `edit` to the host. Show the
  animated stream spinner while awaiting; no busy cursor / no freeze.
- **Serialize is async now** — keep the Ctrl/Cmd+S guarantee (task 58): a save must use a
  serialize that has resolved. Options: keep a synchronous main-thread `getValue()` ONLY on
  the save path (one freeze on explicit save is acceptable), or await the worker before
  letting save proceed (needs care vs VS Code's save timing). Decide in design.
- Worker lifecycle: one worker per webview; rebuild on mode switch; the IR innerHTML is a
  transferable string. Coalesce in-flight requests (only the latest matters).
- CSP: the worker script + `importScripts` of the lute asset must be allowed by the webview
  CSP (`worker-src`/`script-src`); the host serves `/vditor/...` already.

## Verify
- Typing/pasting on a 4000-line doc: no caret freeze; the spinner animates while the
  background serialize runs; host doc updates shortly after.
- Worker markdown is byte-identical to main-thread `VditorIRDOM2Md`.
- Save persists current content (task 58 still holds).
- Falls back gracefully (main-thread serialize) if the worker fails to start.

## Boundary cost — measured (PoC, 2026-06-05)
Before the spike, we measured the data-boundary cost in isolation (Node v24). **Goal:** decide whether the
per-keystroke marshaling kills responsiveness. **Method (the idea):** isolate *only* the cost of moving the
document string across a boundary, with no real parsing, so the number is purely the marshaling tax:
- **(a) JS↔WASM:** write the doc into a real `WebAssembly.Memory` via `TextEncoder.encodeInto`, call a trivial
  hand-assembled WASM function (measures dispatch), read it back via `TextDecoder` — i.e. `encode + dispatch +
  decode`. This is a **lower bound**: Go's `syscall/js` (`CopyBytesToGo`, `js.Value` boxing, `FuncOf`) adds more.
- **(b) Web Worker:** ping-pong the doc to a worker that just echoes it back, measuring full round-trip latency;
  compared three payloads — empty (floor), string (structured clone), and transferable `ArrayBuffer`.
Docs were synthetic markdown (PL + emoji, so UTF-8 length ≠ UTF-16) at 1/4/16/64/256 KB.
**Answer: no — the boundary is cheap; the real cost is asynchrony, not bytes.**

**(a) JS↔WASM string boundary** (`encodeInto` in + dispatch + `decode` out — the path Lute-WASM would pay):

| doc (UTF-8) | boundary total | % of 16.7ms frame |
|---|---|---|
| 1 KB | 4.9 µs | 0.03 % |
| 16 KB | 42.9 µs | 0.26 % |
| 64 KB | 153 µs | 0.92 % |
| 256 KB | 884 µs | 5.3 % |

WASM call dispatch itself = **0.005 µs** (the "expensive call" is a myth; cost is purely the UTF-8 copy).
This is a **lower bound**: Go's `syscall/js` (`CopyBytesToGo`, `js.Value` boxing, `FuncOf`) adds ~3–10×
on top — but even ×10, 256 KB ≈ 9 ms (still sub-frame) and typical docs stay negligible.

**(b) Web Worker round-trip** (the boundary *this task* actually crosses):

| doc (UTF-8) | string `postMessage` (clone) RT | transferable AB RT |
|---|---|---|
| floor (empty ping) | **63.7 µs** | — |
| 1 KB | 58.8 µs | 106 µs |
| 16 KB | 64.8 µs | 202 µs |
| 64 KB | 92.4 µs | 563 µs |
| 256 KB | 939 µs | 2601 µs |

Findings:
- Round-trip latency is **dominated by a fixed ~64 µs scheduling floor**, not payload size. For real docs
  (1–64 KB) the whole round-trip is **50–95 µs** (<0.6% of a frame). **Worker latency is not a blocker.**
- **Naive `postMessage(string)` beats hand-rolled transferable here** — V8 clones strings in native C++ fast;
  the transferable path added 4 UTF-8 passes + a copy and lost. Transfer only wins if the worker consumes
  **raw bytes without decoding to a JS string** (which Go-WASM does internally). → For the spike, **start with
  a plain string round-trip**; don't prematurely optimize with transferables.

**The real cost is NOT the boundary (both are µs-range). It's that this task converts Lute's *synchronous*
`Spin`/`VditorIRDOM2Md` contract into an *asynchronous* one.** Today the re-serialized/normalized DOM is
applied inside the same keydown handler, before repaint. With a Worker the result arrives ~64 µs *later*,
after the handler returned — so:
- The user may have typed more chars in the gap → the worker's result is computed on **stale** input and must
  be reconciled against the current DOM.
- Caret/selection reconciliation becomes systemic (cf. the `caret-preserve` fix, #1912) — not incidental.
- The keydown handler **must not block** on the worker (that re-freezes the UI and defeats the point).
This async-reconciliation problem — not copy cost — is the bulk of the work and the main risk. Latency is free.

**Implication for sequencing:** task 69 (incremental, in-block serialize) reduces the work *at the source*,
stays **synchronous** (no async-reconciliation problem at all), and needs neither a Worker nor WASM — so it is
the cheaper, lower-risk first win. Reach for this Worker task when 69 alone isn't enough on the very largest docs.

## See also
- `tasks/68-ir-edit-serialize-perf.md` (A/C2 + cursor, shipped), `tasks/69-incremental-ir-serialize.md`
  (C3 alternative). `media-src/src/main.ts` `showStreamSpinner`/`removeStreamSpinner` (task 49)
  — reuse for the animated indicator. `media-src/src/pending-edit.ts` — onIdle host-sync.
