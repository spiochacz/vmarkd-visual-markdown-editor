//go:build js && wasm

package d2fonts

// vMarkd compile-only stub: drops embedded font blobs + ttf embed.FS.
// d2compiler.Compile -> d2graph build never reads font BYTES (only the size/
// style CONSTANTS in the untagged d2fonts_common.go). FontEncodings/FontFaces
// stay zero-value SyncMaps; nothing on the compile path calls GetLabelSize/
// SetDimensions/ruler.MeasureMono. Removes ~3.1MB, zero semantic change.
func init() {}
