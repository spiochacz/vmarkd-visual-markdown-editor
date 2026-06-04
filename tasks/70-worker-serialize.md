# Task: Off-main-thread markdown serialize (Web Worker)

> **Status:** ⬜ Not started (spike first). **Source:** follow-up to
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

## See also
- `tasks/68-ir-edit-serialize-perf.md` (A/C2 + cursor, shipped), `tasks/69-incremental-ir-serialize.md`
  (C3 alternative). `media-src/src/main.ts` `showStreamSpinner`/`removeStreamSpinner` (task 49)
  — reuse for the animated indicator. `media-src/src/pending-edit.ts` — onIdle host-sync.
