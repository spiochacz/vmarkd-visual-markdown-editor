# Task 530 — Hard line breaks are lost when their paragraph is edited

**Status:** 🔧 implemented (Design 1b: 8-anchor build-time Lute patch + Shift+Enter handler + `vmarkd.editor.hardBreakStyle`); real-VS-Code verification by the lead pending ·
**Impact:** 🟠 med-high (silent semantic change to the user's file: a visible line break on GitHub
becomes a space) · **Origin:** found by the task 83 spike (2026-10-07); prerequisite for task 83's
"Shift+Enter inserts a hard break in reflow mode".

## Problem

A hard line break — two trailing spaces or a trailing `\` — is saved as a plain newline (a SOFT break)
as soon as its paragraph is edited. On GitHub and in VS Code's preview the line no longer breaks.
Untouched paragraphs are safe (the minimal-diff write-back keeps their bytes), so the loss only shows
on a paragraph you typed in, which makes it easy to miss.

Measured in real VS Code, `test/vscode-e2e/hard-break-roundtrip.spec.ts` (2026-10-07; IR 2/2 runs,
WYSIWYG 1/1): three hard-broken paragraphs followed by a blockquote, a list and a paragraph, one
character typed into each, saved:

```
Before quote one␣␣          →   Before quote one
before quote two\                before quote twoQ
before quote three               before quote three
```

Same for both break forms, all three neighbours, both modes. Every untouched block stayed
byte-identical.

## Cause (measured, vendored Lute 591a695)

The editor DOM renders a hard break as `<br>`, and Lute's DOM → markdown serializers
(`VditorIRDOM2Md` / `VditorDOM2Md`) write `<br>` out as a bare `\n`:

| DOM handed to the serializer | output (IR and WYSIWYG) |
|---|---|
| `<p>a<br>b</p>` | `a\nb` — hard break lost |
| `<p>a<br>\nb</p>` | `a\n\nb` — paragraph split |
| `<p>a\\\nb</p>` (text: backslash + newline) | `a\\\nb` — **kept** |
| `<p>a  \nb</p>` (text: two spaces + newline) | `a  \nb` — **kept** |

The per-keystroke spin (`SpinVditorIRDOM` / `SpinVditorDOM`) is the same serializer followed by a
re-parse, so the edited paragraph's `<br>` is already a soft `\n` in the live DOM after the first
keystroke. (Vditor upstream #1922, noted in task 61.)

**A worse serializer-only variant** (Node probe + chromium harness, NOT seen end to end): when the
hard-broken paragraph and a FOLLOWING blockquote or list are serialized in ONE call, the breaks
vanish entirely and the words are glued — `Hard one  \nhard two\\\nhard three\n\n> q` →
`Hard onehard twohard three`. The real editor serializes the edited block on its own, which is why
the spec shows the softened form. Any whole-document `getValue()` path (mode switch, full
re-serialize fallback) could still hit the glued form — check it while fixing.

## Chosen design (user, 2026-10-07): Lute carries the form end to end (build-time patch, "Design 1b")

The form is lost at PARSE time in Lute (`parse/text.go`): `parseNewline` trims the trailing spaces off
the previous text node and makes a hard break of 2+ of them, `parseBackslash` swallows the backslash;
downstream there is only a `NodeHardBreak{Tokens:"\n"}` and the editor renderers emit a bare `<br />`.
Nothing else reads a hard break's Tokens (audited: the HTML renderer ignores it, `Md2HTML` and `FormatStr`
stay byte-identical; corpus of every tracked `.md`: 0 diffs). `SetJSRenderers` does not reach the spin, so
a JS renderer could not carry it — hence a patch of the blob, and no oracle / inference at our layer.

**Eight anchors** in `scripts/lute-blob-patch.mjs` (`patchLuteBlob`, applied by `patchLuteHardBreaks()` in
`build.mjs` to the `media/` copy ONLY; the vendored file and its source.json sha stay pristine; each anchor
must match exactly once, else the build throws "Lute changed; re-derive anchors"):

| anchor | spot | effect |
|---|---|---|
| P1 | `parse/text.go` `parseNewline` | keeps the trimmed run in `Tokens` (`"  \n"`, 4+ spaces exact) |
| P2 | `parseBackslash` | keeps `"\\\n"` |
| R_O / R_S | `renderHardBreak` (WYSIWYG / IR renderers) | emit `<br data-marker="  " />` / `<br data-marker="\" />` (open render AND every spin output) |
| W_IR / W_WYS | `genASTByVditorIRDOM` / `genASTByVditorDOM` br branch | a `<br>` with a hard-break `data-marker` becomes a `NodeHardBreak` again (after the table-cell branch, before the ZWSP "glue" branch) |
| F_CO | `FormatRenderer.renderHardBreak` | writes the form; a break that ends its block writes a plain newline (no literal `\`), a pending break (caret after it) keeps the form, a spaces form on an otherwise-empty line is written as `\` (a spaces-only line would split the paragraph). Sentinels (caret U+2038, ZWSP U+200B) are compared as GopherJS UTF-8 BYTES (`\xE2\x80\xB8`, `\xE2\x80\x8B`) and only ASCII whitespace is blank — a Go string reaches JS as bytes, never as Unicode |
| D_TXT | `util.domText0` | IR serializes inline `vditor-ir__node` spans (strong/em/link/…) by TEXT; a marked `<br>` inside them keeps its form — but NOT under PRE / CODE / KBD or a `code` / `math-inline` / `html-inline` span (protected source; HTML import stays stock) |

**Our layer** is small. `src/shared/lute-hard-break.ts`: the default form for a NEW break
(`vmarkd.editor.hardBreakStyle`, `backslash` default | `spaces`) and `keepLinePlaceholder` on the SPIN
OUTPUT (re-adds the browser's `<br>` line placeholder after a pending `<br data-marker><wbr>` at the end of
a block — decided over the whole block). `media-src/src/editing/hard-break-key.ts`: a capture-phase Shift+Enter
handler (gap-nav pattern) — in PROSE only (paragraph / tight list item, not heading, table cell, code, math,
IR marker, preview) it records Vditor's first-edit undo caret (`undo.recordFirstPosition`), inserts `<br data-marker="<form>">` — AFTER the outermost inline formatting (strong/em/s/link, IR syntax markers ignored) that ends at the caret, since a hard break must never be the last thing inside formatting — a block-scoped placeholder, the caret after it,
and dispatches `insertLineBreak` so Vditor spins/undoes/saves; everywhere else the stock behaviour stays.
The host (`lute-host.ts`) needs nothing: the patched Lute round-trips an untouched block to its own bytes.

**RE-PIN PROCEDURE.** On a Lute bump `node build.mjs` throws; open the new Lute source (`parse/text.go`,
`render/vditor_*_renderer.go`, `render/format_renderer.go`, `vditor_ir.go` / `vditor_wysiwyg.go` walker br
branch, `util/html.go domText0`), find the same spots in the new blob (GopherJS renames functions — search
`renderHardBreak=function`, `genASTByVditor`), update `LUTE_HARD_BREAK_PATCHES`, run
`test/backend/lute-hard-break-patch.test.ts` and `lute-hard-break.test.ts` (~30-45 min).

Rejected: a source-marking oracle (sentinels + re-render + alignment) and a DOM→md rewrite at our layer —
per-construct heuristics that kept growing (see git history of this file); always-backslash; host-side line
matching; an upstream PR to 88250/lute.

Undo-checkpoint caret: Vditor's undo timer (undoDelay, ~800 ms after an edit) re-places the caret through the
caret authority from a character offset; a `<br>` holds no characters, so a pending break's caret (after the
break) came back BEFORE it and the next typed character lost the break after a ≥1 s pause. The `{blockPath,
offsetInBlock}` intent (esbuild patchUndoCaretSplitRestore, caret.ts) now also carries `breaksBefore`.

Known limit: Shift+Enter then save without typing leaves one extra blank line in Lute's raw output (stock does
too: an empty trailing visual line is not representable); the block-wise host write-back rejoins blocks with
one blank line, so the file is unchanged.

## Steps

- [x] Reproduce end to end — `test/vscode-e2e/hard-break-roundtrip.spec.ts` (RED today, both
      modes). Not committed while red; it becomes the regression spec when the fix lands.
- [x] Decide the written form: keep the source form in Lute's own output via a build-time patch (`<br data-marker>`), rewrite at our layer (2026-10-07).
- [x] Implement the Lute patch + rewrite (DOM→md, spin in; IR + WYSIWYG), tables/previews excluded
      (`scripts/lute-blob-patch.mjs`, `src/shared/lute-hard-break.ts`, `media-src/src/editing/hard-break-key.ts`).
- [x] Check the glued variant on whole-document serialize paths (mode switch, full fallback).
- [x] Unit tests on the transform, chromium harness e2e (red-green-red done)
- [x] Shift+Enter handler (IR + WYSIWYG, prose only) + `vmarkd.editor.hardBreakStyle` setting; Design 1b (8 anchors)
- [ ] Real-VS-Code spec green + red-green-red (lead)

## See also

- Task 83 (reflow line breaks; Shift+Enter = hard break in reflow mode — blocked on this task).
- Task 61 (minimal-diff write-back — why untouched paragraphs are safe), task 370
  (`lute-gap-repair.ts`, the same kind of outside-the-engine Lute repair).
