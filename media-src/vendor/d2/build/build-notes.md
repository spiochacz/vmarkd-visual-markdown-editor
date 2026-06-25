# Building the compile-only D2 WASM

This directory holds the **reproducible inputs** for the vendored `d2-compile.wasm`. The
artifact is a one-time prebuild (committed, like `lute.min.js`) — rebuild only on a D2 bump.

## What it is

A **compile-only** Go→WASM: it runs D2's real compiler (`d2compiler.Compile` →
`d2graph` build) and emits a small **graph JSON** (shapes/edges/containers/styles +
bespoke-shape detection flags). It does NOT lay out or render — the webview JS side does
that (dagre/ELK + Canvas `measureText` + SVG).

Built with **TinyGo**, not stock Go: ~6× smaller (1.74 MB raw / 0.45 MB brotli vs stock's
10.67 MB / 1.83 MB) — about **−1.9 MB off the .vsix** — with **byte-identical compile output**
(verified across D2's full e2e corpus + the shipped fixtures). The d2 compile path runs ~3× slower
than stock (≈5 ms vs ≈1.7 ms per compile) but that is single-digit ms, imperceptible at render.

## Stubs (why three)

The build replaces a few files to shed weight and clear a TinyGo blocker:

- `stub-d2fonts_embed_wasm.go`, `stub-latex_embed_wasm.go` — drop the embedded font blobs (~3.1 MB)
  and the MathJax bundle. The compile path reads only the font **size CONSTANTS**, never the bytes.
- `stub-textmeasure.go` — **replaces the whole `lib/textmeasure` package.** TinyGo 0.41 cannot
  compile `net/http` for `GOOS=js` (stdlib overlay bug `roundtrip_js.go: t.roundTrip undefined`), and
  d2 pulls `net/http` via `goquery`, imported only by `lib/textmeasure` (which also pulls
  `golang/freetype`). Both are on the text-MEASUREMENT path, which our compile-only entrypoint never
  runs (the webview measures via Canvas). The stub provides the 7 externally-used symbols with
  measurement zeroed and `RenderMarkdown` as identity. (A faithful variant that keeps goldmark for
  `RenderMarkdown` compiles but crashes at runtime under `-opt=z` with a regexp memory-OOB and takes
  >20 min under `-opt=2`, so it is NOT used — RenderMarkdown's output isn't emitted by the
  compile-only graph anyway.) Keep its 7 exported symbols in sync with upstream on a d2 bump.

## Inputs

- `main.go` — the compile-only entrypoint (`js.Global().Set("d2compile", …)`). Its
  `outShape`/`outEdge`/`outGraph` structs are the **Go mirror of the `D2Graph` TypeScript
  interface in `media-src/src/d2-wasm.ts`, which is the source of truth.** Keep them in sync.
- `build-d2-wasm.sh` — downloads Go 1.25.0 + TinyGo 0.41.1, clones D2 @ `2446e24` (npm 0.1.33),
  applies the stubs + entrypoint, `tinygo build -target wasm -opt=z -no-debug`. Set
  `GO_PREBUILT=` / `TINYGO_PREBUILT=` to point at already-extracted toolchains and skip the downloads.

## How to rebuild (on a D2 version bump)

```bash
bash media-src/vendor/d2/build/build-d2-wasm.sh
# then:
#  1. sha256sum media-src/vendor/d2/d2-compile.wasm media-src/vendor/d2/wasm_exec.js
#  2. update media-src/vendor/d2/source.json (version + d2Commit + sha256)
#  3. bump D2_VER in media-src/src/d2-wasm.ts to match source.json "version"
#  4. cp the D2 repo LICENSE -> media-src/vendor/d2/LICENSE
#  5. re-verify output is unchanged vs the prior build (compile a corpus, diff the JSON)
#  6. commit d2-compile.wasm + wasm_exec.js + source.json + LICENSE
```

Expected size: ~1.74 MB raw / ~0.45 MB brotli. If it's ~10 MB, the build fell back to stock Go.
If TinyGo errors on `net/http`, a new d2 version pulled it through a fresh path — extend the
`lib/textmeasure` stub (or stub the new importer).
