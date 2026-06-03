# Task: Streaming / incremental render for large documents (approach B)

> **Status:** 🟡 Implemented (2026-06-03), pending real-file QA. Webview chunked
> render in `media-src/src/stream-render.ts` + pure logic in `stream-chunk.ts`
> (unit-tested); wired into `main.ts` init. Build + 274 unit tests green. Not yet
> exercised on a real 100 KB+ file in the live extension.
> **Source:** user request (2026-06-03) — large markdown files block for seconds
> on open (single monolithic Lute parse). Follow-up to the host-side instant-paint
> overlay ([task 50](50-host-side-prerender.md), `src/lute-host.ts`), which masks
> *first paint* but does not stop the live editor from parsing the whole doc.
> **Value / Risk:** 🟢 high (kills the multi-second freeze on big docs) / high
> (touches contenteditable mutation during edit + the save path — get it wrong and
> you corrupt the file).
> **Engines:** none.

## Problem
On open, the full document is handed to Vditor as `value: msg.content`
(`media-src/src/main.ts:254`). Vditor renders it with **one synchronous Lute
call** on the whole string:

- `node_modules/vditor/src/ts/toolbar/EditMode.ts:60` →
  `vditor.ir.element.innerHTML = vditor.lute.Md2VditorIRDOM(markdownText)`
- same in `setValue` → `node_modules/vditor/src/index.ts:330`

That call is **super-linear on table/mixed/reference-heavy content** and runs in
the webview's GopherJS Lute, freezing the editor UI until it finishes. The
host-side overlay (`renderForMode` / `prerenderPrefix` in `src/lute-host.ts`,
4 KB cap) only paints a static first screen; the live editor underneath still
parses everything, so the editor isn't interactive until the full parse ends.

## Goal
Render the document **in ~4 KB block-boundary chunks**, appended progressively,
so no single Lute call blocks more than ~tens of ms and the editor becomes usable
almost immediately — **without** corrupting references or the saved file.

Decision: **approach B (chunk in the webview), not A (host streams rendered
HTML).** Rationale below.

## Benchmark evidence
Measured with two harnesses that load Lute via `vm` exactly like `lute-host.ts`:
`bench-streaming.mjs` (monolithic vs chunked) and `bench-refs-chunking.mjs`
(reference correctness). ⚠️ **Both are currently untracked (working tree only)** —
commit them (e.g. under `bench/`) or recreate from the inlined algorithms above; the
task does not depend on them surviving, but the Verify step does.

1. **Chunking is a responsiveness play, not a total-CPU win.** Prose Lute is ~linear
   (195 KB ≈ 306 ms; chunked ≈ same), but the *worst single chunk* is ~15-18 ms vs
   one 300 ms+ freeze. Super-linearity only bites on tables/mixed/refs — there
   chunking also cuts total time (mixed 195 KB: **1950 ms → 817 ms, 2.39×**, worst
   chunk 103 ms; tables 195 KB: 1202 → 923 ms).
2. **A is rejected:** chunking doesn't cut total CPU for the common case, so there's
   no reason to move the full parse onto the **shared extension-host thread**, and A
   would also ship 0.5-1.1 MB of rendered HTML per file over `postMessage`. B keeps
   CPU on the disposable webview thread, no IPC, startup hidden by the overlay.
3. **Naive chunking is WRONG on references:** a chunk rendered in isolation loses
   `[label]: url` / `[^fn]:` defs → `[text][ref]`/`[^fn]` degrade to literal text.
   Measured: 70 KB / 500 refs doc, naive chunked resolved **0/500** (and looked
   "fast" only because it did less work).
4. **Fix that works — referenced-only def injection:** collect all defs up front,
   append to each chunk *only the defs that chunk actually cites*, render, strip the
   trailing defs/footnotes block, append the defs block once at the end. Measured:
   **500/500 resolved (matches monolithic), 283 ms (2.6× faster than mono), worst
   chunk 40 ms.** Appending *all* defs to every chunk is also correct but *slower
   than the monolith* (1185 ms) — must be selective.

## Approach (webview: `media-src/src/`)
A new module (e.g. `stream-render.ts`) invoked from `initVditor` in `main.ts`,
replacing the constructor `value` path for over-cap docs.

0. **Spike first (highest-risk unknown):** confirm you can bypass the constructor
   `value` and append blocks into `vditor.ir.element` while keeping Vditor's internal
   state consistent (the `vditor.ir` model, undo stack, input pipeline). Programmatic
   DOM writes don't fire `input`, so they *should* leave undo clean — verify on a real
   build before building the rest. If Vditor's internals fight raw appends, fall back
   to chunked `setValue` accumulation or `insertMD` (renders a fragment, splices at
   cursor — see `node_modules/vditor/src/index.ts:301`).
1. **Don't hand Vditor the full `value`.** Construct Vditor with `value: ''` (or the
   first chunk), let it build, then stream the rest into `vditor.ir.element`.
2. **Chunk boundaries:** the same boundary logic as `src/lute-host.ts:prerenderPrefix`
   (cut on blank line, else newline; drop a dangling unterminated ``` fence), applied
   repeatedly to walk the whole doc. Host (`src/`) and webview (`media-src/`) are
   separate build units — either a shared util or a deliberate copy; keep it in sync
   with `prerenderPrefix`. Reference impl (validated in the benches):
   ```js
   const CAP = 4_000 // == MAX_PRERENDER_CHARS in lute-host.ts
   function chunkize(md) {
     const chunks = []; let rest = md
     while (rest.length > CAP) {
       let s = rest.slice(0, CAP)
       const blank = s.lastIndexOf('\n\n')
       if (blank >= CAP / 2) s = s.slice(0, blank)
       else { const nl = s.lastIndexOf('\n'); if (nl > 0) s = s.slice(0, nl) }
       const fences = [...s.matchAll(/^```/gm)]
       if (fences.length % 2 === 1) s = s.slice(0, fences[fences.length - 1].index)
       if (!s.length) s = rest.slice(0, CAP) // safety: never empty
       chunks.push(s); rest = rest.slice(s.length)
     }
     if (rest.length) chunks.push(rest)
     return chunks
   }
   ```
3. **Referenced-only ref injection (correctness from the first frame).** Pre-scan the
   full markdown for link-ref defs `[label]: …` and footnote defs `[^label]: …`; build
   a `label → def-line` map; remove def lines from the streamed content. Per chunk,
   append only the defs that chunk cites, render, strip the duplicated trailing defs
   blocks, concat; append the single defs block once at the end. Reference impl
   (validated — resolves 500/500 refs, 2.6× faster than monolithic):
   ```js
   const RE_FN_DEF   = /^\s{0,3}\[\^[^\]]+\]:/          // [^label]: …
   const RE_LINK_DEF = /^\s{0,3}\[[^\]^][^\]]*\]:\s*\S/  // [label]: dest
   // defs render AFTER content, so truncating at the first defs/footnotes block
   // drops both cleanly (handles the nested footnotes-def divs without regex pain):
   function stripTrailingDefs(html) {
     let cut = html.length
     const a = html.indexOf('<div data-block="0" data-type="link-ref-defs-block"')
     const b = html.indexOf('<div data-block="0" data-type="footnotes-block"')
     if (a >= 0) cut = Math.min(cut, a)
     if (b >= 0) cut = Math.min(cut, b)
     return html.slice(0, cut)
   }
   // per chunk: collect labels used via /\]\[([^\]]+)\]/g and /\[\^([^\]]+)\]/g,
   // look each up in the def map, append only those def lines:
   //   out += stripTrailingDefs(lute.Md2VditorIRDOM(chunk + '\n\n' + neededDefs))
   // after the loop, once:
   //   out += lute.Md2VditorIRDOM(allDefsText)
   ```
   ⚠️ Appending *all* defs to every chunk is also correct but ends up *slower than the
   monolith* (re-parses every def N times) — the selection is what makes it a win.
4. **Append below the viewport, never re-render placed blocks.** Because refs
   resolve at append time, nothing above the caret/viewport ever changes → scroll
   position stays stable, no jumps.
5. **Read-only during streaming + suspend sync (data-loss guard).** `getValue()` runs
   over the *current* DOM; mid-stream it returns a **truncated** document, and
   `input()` (`main.ts:317-325`) would `postMessage({command:'edit', …})` that
   truncated text → file corruption. Reuse the existing suppression pattern: a
   `streaming` flag mirroring `applyingExtensionUpdate` (`main.ts:42,318`) so
   `input()` early-returns; keep the editor read-only until done. Flip to
   editable + enable sync only when all chunks are in and state is consistent;
   `getValue()` then returns the full doc.
6. **Yield between chunks** (`requestIdleCallback`/`setTimeout(…,0)`) so the thread
   stays responsive; show a loading sentinel at the bottom for users who scroll to
   the frontier.
7. **Re-trigger post-processing on appended blocks:** code highlight
   (`.vditor-ir__preview[data-render='2']`), Mermaid/KaTeX/ECharts lazy render, and
   the project's `fixTableIr` / `fixResponsiveTables` / `custom-renderer` /
   `diff-markers` passes — currently run once in `after()`; they must also run for
   streamed-in blocks (re-run scoped to the new nodes, or re-run at stream end).

## Risks / gotchas
- **Truncated `getValue()` → save corruption** is the critical one; the `streaming`
  flag must be set *before* the first append and cleared only after the last.
- **Label normalization:** CommonMark labels are case-insensitive and collapse
  internal whitespace — the def map must normalize (the bench regex was approximate
  but matched 1:1 on the test doc).
- **Multi-line footnote defs:** `[^fn]:` can have indented continuation lines; the
  extractor must capture the whole def, not one line (bench used single-line). ✅ done
  (`buildDefMap` consumes indented continuation lines).
- **Footnote display numbering (benign):** per-chunk rendering numbers footnotes
  locally (each chunk restarts at 1) instead of global 1..N. The number is a hidden
  IR marker and is not in the source, so `getValue()`/save round-trips byte-identical
  to monolithic (verified). Left as-is for v1; footnote-heavy 100 KB+ docs are rare.
- **Lazy-asset height shifts:** images without dimensions / Mermaid / KaTeX resize a
  block *after* it's placed → if above the viewport, scroll jumps. Reserve space /
  render synchronously per chunk / rely on `overflow-anchor`.
- **Undo stack:** appends must bypass Vditor's input pipeline (direct DOM writes
  don't fire `input`, so they shouldn't pollute undo) — verify the undo stack is
  clean after a streamed load.
- **Editable-during-stream** (edits above the frontier, sync suspended, one re-sync
  at end) is feasible but needs careful append-vs-spin race + caret handling →
  defer to **v2**; ship read-only-during-stream first.
- Keep the existing overlay: it covers the brief read-only window so the open still
  *looks* instant.

## Verify
- `node bench-streaming.mjs` — chunked total ≤ monolithic, worst chunk ≤ ~100 ms.
  (If the script is gone, recreate from the §Approach `chunkize` impl.)
- `node bench-refs-chunking.mjs` — referenced-only resolves the full ref count
  (matches monolithic), faster than mono. Re-run against the user's real large file
  to confirm 1:1 correctness + speedup before shipping.
- Manual: open a large (100 KB+) table/ref-heavy doc — first screen appears at once,
  body fills in progressively, **scroll stays put** (no jumps), references render
  resolved from the start. Editing is blocked until load completes; after completion,
  edit a block and confirm the **full** document saves (not truncated). Toggling
  modes (`ir`/`wysiwyg`/`sv`) and the overlay path still work.
