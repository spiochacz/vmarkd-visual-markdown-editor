# Building the compile-only D2 WASM

This directory holds the **reproducible inputs** for the vendored `d2-compile.wasm`. The
artifact is a one-time prebuild (committed, like `lute.min.js`) — rebuild only on a D2 bump.

## What it is

A **compile-only** Go→WASM: it runs D2's real compiler (`d2compiler.Compile` →
`d2graph` build) and emits a small **graph JSON** (shapes/edges/containers/styles +
bespoke-shape detection flags). It does NOT lay out or render — the webview JS side does
that (dagre + Canvas `measureText` + SVG). The font blobs (`d2fonts`) and the MathJax
bundle (`d2latex`) are **stubbed out** (`func init() {}`) because the compile path never
reads font bytes — that sheds ~3.1 MB.

## Inputs

- `main.go` — the compile-only entrypoint (`js.Global().Set("d2compile", …)`). Its
  `outShape`/`outEdge`/`outGraph` structs are the **Go mirror of the `D2Graph` TypeScript
  interface in `media-src/src/d2-wasm.ts`, which is the source of truth.** Keep them in sync.
- `stub-d2fonts_embed_wasm.go`, `stub-latex_embed_wasm.go` — drop the embedded blobs.
- `build-d2-wasm.sh` — downloads Go 1.25.0, clones D2 @ `2446e24` (npm 0.1.33), applies the
  stubs + entrypoint, `GOOS=js GOARCH=wasm go build -ldflags="-s -w"`.

## How to rebuild (on a D2 version bump)

```bash
bash media-src/vendor/d2/build/build-d2-wasm.sh
# then:
#  1. sha256sum media-src/vendor/d2/d2-compile.wasm media-src/vendor/d2/wasm_exec.js
#  2. update media-src/vendor/d2/source.json (version + d2Commit + sha256)
#  3. bump D2_VER in media-src/src/d2-wasm.ts to match source.json "version"
#  4. cp the D2 repo LICENSE -> media-src/vendor/d2/LICENSE
#  5. commit d2-compile.wasm + wasm_exec.js + source.json + LICENSE
```

Expected size: ~10.6 MB raw / ~1.82 MB brotli. If it's ~14 MB, the stubs did not apply.
