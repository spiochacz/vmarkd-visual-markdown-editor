package textmeasure

// vMarkd compile-only stub: replaces the WHOLE lib/textmeasure package for the TinyGo js/wasm build.
//
// WHAT it fixes: TinyGo 0.41 cannot compile `net/http` for GOOS=js (stdlib overlay bug
// `net/http/roundtrip_js.go: t.roundTrip undefined`). The d2 compile graph pulls net/http via
// `goquery`, which is imported ONLY by lib/textmeasure (markdown.go's MeasureMarkdown); textmeasure.go
// additionally pulls `golang/freetype`. Both are on the text-MEASUREMENT path only.
//
// WHY this is the MINIMAL variant (no goldmark): a faithful version that keeps goldmark for
// RenderMarkdown compiles but (a) crashes at runtime under -opt=z with a regexp memory-OOB and
// (b) takes >20 min to build under -opt=2 (LLVM chokes on goldmark's code size). The minimal stub
// builds clean at -opt=z and is ~0.7 MB smaller. It is safe because our entrypoint
// (d2compileonly/main.go) calls only d2compiler.Compile and emits graph STRUCTURE — it never runs
// layout/SetDimensions (so Measure/MeasureMono/MeasureMarkdown are dead code) and never emits
// rendered markdown (so RenderMarkdown's output is invisible to our JSON). Verified byte-identical to
// the stock-Go build across D2's full e2e corpus (68 files) + the shipped fixtures + targeted samples.
// The only behavioural delta is that a malformed `|md|` block / tooltip no longer raises d2's
// "malformed Markdown" compile error (goldmark almost never errors anyway) — an accepted, near-empty
// edge case for a markdown editor that re-renders markdown itself on the JS side.
//
// HOW it is consumed: build-d2-wasm.sh removes lib/textmeasure/*.go and drops this single file in.
// Keep the 7 externally-used symbols (Ruler/NewRuler/HasFontFamilyLoaded/Measure/MeasureMono,
// RenderMarkdown/MeasureMarkdown/ReplaceSubstitutionsMarkdown, CODE_LINE_HEIGHT/MarkdownFontSize) in
// sync with upstream lib/textmeasure on a d2 bump.

import (
	"strings"

	"oss.terrastruct.com/d2/d2renderers/d2fonts"
)

const CODE_LINE_HEIGHT = 1.3

var MarkdownFontSize = d2fonts.FONT_SIZE_M

// RenderMarkdown — identity. Upstream renders md→HTML for measurement/validation; our compile-only
// output never carries the rendered HTML, so passing the source through is invisible to our JSON.
func RenderMarkdown(m string) (string, error) { return m, nil }

// ReplaceSubstitutionsMarkdown — naive ${var} replacement (upstream skips code spans via a goldmark
// AST walk; we drop goldmark, so we substitute everywhere). Markdown-label var substitution is a niche
// path and its result isn't emitted by the compile-only graph either.
func ReplaceSubstitutionsMarkdown(mdText string, variables map[string]string) string {
	for k, v := range variables {
		mdText = strings.ReplaceAll(mdText, "${"+k+"}", v)
	}
	return mdText
}

// --- measurement: stubbed (dead code on the compile path; severs goquery + freetype) ---

// Ruler keeps only the one field d2graph reads (LineHeightFactor); the glyph atlas / truetype machinery
// is dropped. The compile path builds a Ruler but never measures with it (the webview measures via
// Canvas), so the methods can return zero.
type Ruler struct {
	LineHeightFactor float64
}

func NewRuler() (*Ruler, error) { return &Ruler{LineHeightFactor: 1.}, nil }

func (r *Ruler) HasFontFamilyLoaded(fontFamily *d2fonts.FontFamily) bool { return true }

func (r *Ruler) Measure(font d2fonts.Font, s string) (width, height int) { return 0, 0 }

func (r *Ruler) MeasureMono(font d2fonts.Font, s string) (width, height int) { return 0, 0 }

func MeasureMarkdown(mdText string, ruler *Ruler, fontFamily *d2fonts.FontFamily, monoFontFamily *d2fonts.FontFamily, fontSize int) (width, height int, err error) {
	return 0, 0, nil
}
