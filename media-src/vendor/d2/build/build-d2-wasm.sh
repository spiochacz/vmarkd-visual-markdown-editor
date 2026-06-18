#!/usr/bin/env bash
# One-time prebuild of the vendored compile-only D2 WASM (rebuild only on a D2 bump).
# Produces media-src/vendor/d2/{d2-compile.wasm, wasm_exec.js}. Commit the outputs.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VENDOR="$(cd "$HERE/.." && pwd)"          # media-src/vendor/d2
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
GO_VER=go1.25.0
D2_COMMIT=2446e24      # == npm @terrastruct/d2 0.1.33

# 1. Go toolchain (pinned)
curl -sL "https://go.dev/dl/${GO_VER}.linux-amd64.tar.gz" -o "$WORK/go.tgz"
tar -C "$WORK" -xzf "$WORK/go.tgz"
export GOROOT="$WORK/go" GOPATH="$WORK/gopath" PATH="$WORK/go/bin:$PATH"

# 2. D2 source @ pinned commit
git clone https://github.com/terrastruct/d2 "$WORK/d2"
git -C "$WORK/d2" checkout "$D2_COMMIT"

# 3. Apply the stubs (drop fonts + mathjax)
cp "$HERE/stub-d2fonts_embed_wasm.go" "$WORK/d2/d2renderers/d2fonts/d2fonts_embed_wasm.go"
cp "$HERE/stub-latex_embed_wasm.go"   "$WORK/d2/d2renderers/d2latex/latex_embed_wasm.go"

# 4. The compile-only entrypoint
mkdir -p "$WORK/d2/d2compileonly"
cp "$HERE/main.go" "$WORK/d2/d2compileonly/main.go"

# 5. Build
cd "$WORK/d2"
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o "$VENDOR/d2-compile.wasm" ./d2compileonly
cp "$GOROOT/lib/wasm/wasm_exec.js" "$VENDOR/wasm_exec.js" 2>/dev/null \
  || cp "$GOROOT/misc/wasm/wasm_exec.js" "$VENDOR/wasm_exec.js"

ls -l "$VENDOR/d2-compile.wasm"   # expect ~10.6MB raw / ~1.82MB brotli
echo "Now: update source.json sha256 (sha256sum), copy d2's LICENSE, commit the .wasm + wasm_exec.js."
