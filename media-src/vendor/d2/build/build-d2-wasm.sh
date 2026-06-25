#!/usr/bin/env bash
# One-time prebuild of the vendored compile-only D2 WASM (rebuild only on a D2 bump).
# Produces media-src/vendor/d2/{d2-compile.wasm, wasm_exec.js}. Commit the outputs.
#
# Built with TinyGo (not stock Go): ~6x smaller wasm (1.74MB vs 10.67MB raw, −1.9MB off the .vsix),
# byte-identical compile output. TinyGo can't compile net/http for GOOS=js, which d2 pulls via
# goquery in lib/textmeasure — so we also replace that package with stub-textmeasure.go (faithful
# RenderMarkdown, stubbed measurement). See build-notes.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VENDOR="$(cd "$HERE/.." && pwd)"          # media-src/vendor/d2
# chmod before rm: Go marks its module cache (gopath/pkg/mod) read-only, so a bare rm -rf errors out.
WORK="$(mktemp -d)"; trap 'chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT
GO_VER=go1.25.0
TINYGO_VER=0.41.1      # uses Go 1.25.0; bump in lockstep with GO_VER's supported range
D2_COMMIT=2446e24      # == npm @terrastruct/d2 0.1.33

# 1. Go toolchain (TinyGo shells out to it). Set GO_PREBUILT=/path/to/goroot to reuse a cached one.
if [ -n "${GO_PREBUILT:-}" ]; then
  export GOROOT="$GO_PREBUILT"
else
  curl -sL "https://go.dev/dl/${GO_VER}.linux-amd64.tar.gz" -o "$WORK/go.tgz"
  tar -C "$WORK" -xzf "$WORK/go.tgz"
  export GOROOT="$WORK/go"
fi

# 2. TinyGo toolchain (pinned). Set TINYGO_PREBUILT=/path/to/tinygo to reuse a cached one.
if [ -n "${TINYGO_PREBUILT:-}" ]; then
  TINYGO="$TINYGO_PREBUILT"
else
  curl -sL "https://github.com/tinygo-org/tinygo/releases/download/v${TINYGO_VER}/tinygo${TINYGO_VER}.linux-amd64.tar.gz" -o "$WORK/tinygo.tgz"
  tar -C "$WORK" -xzf "$WORK/tinygo.tgz"
  TINYGO="$WORK/tinygo"
fi
export TINYGOROOT="$TINYGO"
# GOCACHE_DIR override = a persistent build cache for fast local rebuilds; default = fresh (clean build).
export GOPATH="$WORK/gopath" GOCACHE="${GOCACHE_DIR:-$WORK/gocache}"
export PATH="$TINYGO/bin:$GOROOT/bin:$PATH"
mkdir -p "$GOPATH" "$GOCACHE"

# 3. D2 source @ pinned commit
git clone https://github.com/terrastruct/d2 "$WORK/d2"
git -C "$WORK/d2" checkout "$D2_COMMIT"

# 4. Apply the stubs (drop fonts + mathjax; replace lib/textmeasure to sever goquery+freetype)
cp "$HERE/stub-d2fonts_embed_wasm.go" "$WORK/d2/d2renderers/d2fonts/d2fonts_embed_wasm.go"
cp "$HERE/stub-latex_embed_wasm.go"   "$WORK/d2/d2renderers/d2latex/latex_embed_wasm.go"
rm -f "$WORK"/d2/lib/textmeasure/*.go
cp "$HERE/stub-textmeasure.go"        "$WORK/d2/lib/textmeasure/stub-textmeasure.go"

# 5. The compile-only entrypoint
mkdir -p "$WORK/d2/d2compileonly"
cp "$HERE/main.go" "$WORK/d2/d2compileonly/main.go"

# 6. Build (TinyGo, size-optimized + stripped). asyncify scheduler kept (syscall/js callbacks + select{}).
# -opt=z is smallest and works with the minimal textmeasure stub (verified across D2's e2e corpus).
# (-opt=z miscompiled a goldmark-keeping variant — regexp memory-OOB — but the shipped stub drops it.)
cd "$WORK/d2"
OPT="${TINYGO_OPT:--opt=z}"
tinygo build -target wasm $OPT -no-debug -o "$VENDOR/d2-compile.wasm" ./d2compileonly
cp "$TINYGO/targets/wasm_exec.js" "$VENDOR/wasm_exec.js"

ls -l "$VENDOR/d2-compile.wasm"   # expect ~1.74MB raw / ~0.45MB brotli
echo "Now: update source.json sha256 (sha256sum), copy d2's LICENSE, commit the .wasm + wasm_exec.js."
