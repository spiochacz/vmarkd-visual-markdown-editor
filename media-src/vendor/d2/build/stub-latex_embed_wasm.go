//go:build js && wasm

package d2latex

// vMarkd compile-only stub: replaces the embedded MathJax/polyfill blobs (the original
// latex_embed_wasm.go //go:embed's polyfills.js, setup.js, mathjax.js.br) with empty
// strings. The untagged latex_common.go declares NO these vars but references them in
// d2latex.Render — which is ONLY on the layout/measure path. vMarkd's compile path
// (d2compiler.Compile -> d2graph build) never calls Render, so empty values are safe and
// drop the multi-MB MathJax blob. Declaring them keeps the package compiling.
var polyfillsJS = ""
var setupJS = ""
var mathjaxJS = ""
