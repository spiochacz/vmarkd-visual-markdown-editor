# Task 50 — Host-side pre-render for instant warm-open paint

**Status:** spike (perf/host-side-prerender) — awaiting visual review

## Problem

Opening a markdown file shows a blank editor for ~150–190 ms before any content
paints. Profiling (this session) pinned the cause: the webview's first paint is
gated on loading + running the **3.8 MB GopherJS Lute runtime** in every new
webview realm. Breakdown measured in V8 (Node = same engine as the webview):

| phase | cost | note |
|---|---:|---|
| compile (parse 3.8 MB) | ~100–160 ms | V8 code-cached in the browser → ~1 ms warm |
| **`$init` (Go runtime bootstrap)** | **~150 ms** | runs fresh per realm; **cannot be cached** |
| `Lute.New()` | ~3 ms | |
| `Md2VditorIRDOM` (render) | **~1 ms warm** | the markdown work itself is trivial |

So the bottleneck is the Go-runtime-in-JS bootstrap, not the markdown rendering.
It can't be shrunk without leaving GopherJS (TinyGo/WASM was prototyped — compiles,
byte-identical output, ~33% faster init — but blocked by Vditor's `SetJSRenderers`
JS-callback path across the wasm boundary + a 40-method shim; rejected).

## Approach

The extension host is a **single long-lived Node process**, and `lute.min.js`
runs in Node. So pay the Lute `$init` **once** on the host and reuse it:

1. `src/lute-host.ts` loads Lute in an isolated `vm` context (no host-global
   pollution) at activation (`prewarmLute`, ~250 ms once, deferred off the
   activation path).
2. On open, `_getHtmlForWebview` calls `renderIR(content)` →
   `lute.Md2VditorIRDOM` (~1 ms) and inlines the result as a **static, read-only
   overlay** (`#vmarkd-prerender`) in the initial HTML. It paints during HTML
   parse, before `main.js` runs.
3. The live Vditor builds underneath; `media-src/src/main.ts` removes the overlay
   in `after()` (rAF-deferred). Both renders come from the **same Lute**, so the
   swap is visually seamless.

`renderIR` returns `undefined` when Lute isn't warm yet → caller falls back to
the normal render path (no regression, never blocks HTML generation on the load).

## Verified

- Sandboxed host Lute output **byte-identical** to the webview's Lute (headings,
  lists, code, tables, task-lists, math).
- `global.Lute` stays undefined in the host (clean isolation).
- tsc / biome / 189 tests green.

## Open / to refine after visual review

- Overlay layout fidelity vs the live editor: full-width vs max-width centering
  (body option attrs are set by `main.js` only after the ready round-trip, so the
  static overlay may differ slightly), toolbar-height top offset, content theme /
  code theme colors before `applyVditorTheme` runs.
- Wiki links (`[[…]]`) aren't custom-rendered host-side — they show as plain on
  the instant paint and correct on swap.
- Decide whether to also set `<body>` data-attrs statically to tighten the match.
