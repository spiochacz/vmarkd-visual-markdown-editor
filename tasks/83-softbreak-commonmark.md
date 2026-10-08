# Task: Soft line breaks like CommonMark (flow wrapped lines)

> **Status:** 🚧 in progress (2026-10-07) — **scope EXTENDED 2026-10-07** (editor reflow + break markers + toolbar
> toggle, see the first section). The 2026-06-13 preview-only design below is still part of it.
> Increments 1-5 delivered (setting + Preview, editor decorator, toolbar toggle, open parity); remaining: the
> copy-as-HTML / export / D2 decision below (the file sat in `done/` by mistake after a bulk archive; reopened).
> **Source:** user request (2026-06-09) — comparing the GitHub/VS Code markdown
> preview render to vMarkd's render of the same file (task 82 theme work). A
> paragraph (or blockquote) that is soft-wrapped across several source lines shows
> as **separate lines** in vMarkd, but **flows into one wrapped paragraph** on
> GitHub / in VS Code's preview. Re-confirmed 2026-06-13 (VS Code 1.123 preview parity work).
> **Value / Risk:** 🟢 fidelity-to-CommonMark / **low (as scoped)** — preview-only +
> default-off setting makes it a single Vditor source-patch with no round-trip impact.
> **Engines:** Lute (bundled) — `SetSoftBreak2HardBreak`.

## Scope extension (2026-10-07) — reflow IN THE EDITOR, show where the line breaks are

User request (2026-10-07): a **toolbar toggle** that makes ordinary (soft) line breaks flow like
VS Code's markdown preview does, **in the editor itself (IR and WYSIWYG)**, and marks every place
where the file has a newline with a **small inline glyph** (a little box / `↵`), so the source
wrapping stays visible while the text reflows. Toggle off = today's behaviour.

### Measured (2026-10-07, vendored Lute 591a695, Node probe + chromium)

- **In the editor DOM a soft break is a literal `\n` text character inside the `<p>`**, shown as a
  new line only because the IR/WYSIWYG surfaces use `white-space: pre-wrap` (`_ir.less`,
  `_wysiwyg.less`). Hard breaks (`two spaces` / `\`) are `<br />`. `Md2VditorIRDOM` /
  `Md2VditorDOM` emit the SAME DOM with `SetSoftBreak2HardBreak(true)` and `(false)`, so **the
  Lute knob from the design below does nothing for the editor** — it only affects `Md2HTML`
  (the preview).
- **Pure CSS is not enough.** Reflow needs "newline → space, but keep runs of spaces"
  (`white-space-collapse: preserve-spaces`), which Chromium 148 does NOT support
  (`CSS.supports` false). `white-space: normal` on the whole block collapses double spaces and, in a
  contenteditable, makes typed spaces come out as `&nbsp;` — which would leak into the markdown.
- **Sketch that fits our existing patterns:** a decorator wraps each soft-break `\n` text run in
  `<span class="vmarkd-softbreak">\n</span>`; the span gets `white-space: normal` (the newline
  renders as a space, the rest of the block stays `pre-wrap`) and a `::before`/`::after` glyph for
  the marker. A bare wrapper span round-trips clean through Lute (its text, the `\n`, serializes as
  before — must be asserted byte-identical); the per-keystroke spin drops the spans, so it re-applies
  from a MutationObserver/selectionchange the way `callouts.ts` / `code-source.ts` decorate
  (memories: editable-IR styling = attrs + observer; injected DOM is transient). The marker glyph
  must be pseudo-element content, NOT a text node (a text node would serialize).
- **Toggle:** a toolbar button (pressed state) backed by a setting so it persists, e.g.
  `vmarkd.editor.reflowLineBreaks`; it should also drive the preview half (the 2026-06-13 design),
  so one switch gives the same picture in edit and Preview.

### Risks to measure before building

- **Caret around the wrapped `\n`:** ArrowLeft/Right/Up/Down, Home/End and click-placement across
  a newline that now renders as a space; typing at either edge of the span (must land as text in
  the paragraph, not inside the span, or be harmless when it does); Enter/Backspace at the break.
- **Selection/copy** across a marker must not copy the glyph.
- **Cost:** the decorator walks text nodes of the edited block per spin — keep it block-scoped
  (memory: prose typing on large docs is already rebuild+reflow bound).
- **Hard breaks become visibly different from soft ones once reflow is on — and the editor already
  LOSES hard breaks** in any paragraph it re-serializes: measured `line  \nnext` and `line\\\nnext`
  both come back from `VditorIRDOM2Md` / `VditorDOM2Md` as `line\nnext` (known since task 61, Vditor
  #1922; the minimal-diff write-back only protects UNTOUCHED blocks). Measured on the serializer
  in a Node probe only — reproduce it end-to-end in the editor (edit such a paragraph, save) first. With reflow on, editing a
  paragraph would visibly merge its hard-broken lines. Decide with the user whether that is fixed
  first, as part of this task, or tracked separately.

### Spike result (2026-10-07) — the decorator approach WORKS; three things left to settle

Throwaway code: `tmp/softbreak/` (`decorator.js` = the decorator, `spike.mjs` = the matrix in the
list harness, `?md=&mode=`, both IR and WYSIWYG; gitignored). Final design that passed:

- `<span class="vmarkd-softbreak" contenteditable="false">\n</span>` around every soft-break `\n`
  inside a block (not a trailing one), CSS `white-space: normal` on the span (renders as a space) +
  `::before { content: '↵' }` glyph (zero-advance, raised to the TOP of the text line like a superscript, `translate(-0.15em, -0.7em)`, 2026-10-08; it used to hang below the baseline). **`contenteditable=false` is required:** with an editable span,
  Chromium's whitespace canonicalisation turned the `\n` into `" "` as soon as you typed next to it
  (`one\nXbeta` saved as `one Xbeta` — first run).
- MutationObserver re-wraps **only the top-level blocks the mutation touched** (whole-root walk cost
  160 ms per keystroke on a 1500-paragraph doc in IR; block-scoped: **1.3–1.8 ms**).
- **Structural keys (Enter / Shift+Enter / Backspace / Delete): unwrap the block's spans and
  `normalize()` it in a window capture-phase keydown, with the caret kept as a character offset, and
  hold the observer off until a `setTimeout(0)`.** Without the hold, the observer's microtask
  re-wraps between our listener and Vditor's; without `normalize()`, Shift+Enter found the caret at
  the END of a text node and Vditor inserted `\n\n` → split the paragraph into two.
- `selectionchange`: a caret that lands inside the span (click on the glyph) moves to offset 0 of the
  next text node.

Measured, both modes identical:

| check | result |
|---|---|
| saved markdown with the decorator vs without | byte-identical |
| 3-line soft-wrapped paragraph | 3 visual lines → 1 |
| selection text across a marker | `"Alpha one beta two gamma three"` (no glyph) |
| ArrowRight across the break | one press |
| type at end of line 1 / start of line 2 / after ArrowLeft/Right / after glyph click | lands in the right place, newline kept |
| typing a word, blockquote soft break, list-item continuation line | correct |
| Enter at the break | new paragraph, same as without the decorator |
| Shift+Enter at the break | soft break inserted, same as without the decorator |
| Backspace at line-2 start / Delete at line-1 end | deletes the newline → `onebeta` (same as without the decorator; visually you deleted the "space") |
| End / Home | go to the VISUAL line ends (= the paragraph ends once reflowed) |
| decorate a fresh 1500-paragraph doc (3000 breaks) | **1.2–1.9 s — too slow for open as-is**; needs idle chunking or viewport-only decoration |

Still open:

1. **Undo** not measured: Ctrl+Z does nothing in the list harness WITHOUT the decorator either, so
   it has to be checked in real VS Code (Vditor's undo snapshots the DOM, spans included).
2. **Open cost** above — chunk on idle (`requestIdleCallback`) or decorate what is on screen.
3. ~~What Shift+Enter should do in reflow mode~~ — **DECIDED (user, 2026-10-07): in reflow mode
   Shift+Enter inserts a HARD break**, so the line visibly breaks (GitHub semantics: soft break =
   space, hard break = new line). Default form: backslash + newline (`\` survives editors that trim
   trailing whitespace; two trailing spaces do not). Reflow off = today's behaviour (soft break).
   **Blocked by the Lute hard-break bug below** — the hard break must survive serialization first.

**Separate bug found by the spike — now [task 530](done/530-hard-line-breaks-lost-on-edit.md), reproduced end to end in real VS Code (softened form):** a paragraph
with hard breaks that is followed by a blockquote or a list serializes with the breaks DROPPED and
the words glued: `Hard one  \nhard two\\\nhard three\n\n> q` → `Hard onehard twohard three`
(IR and WYSIWYG). The same paragraph followed by a plain paragraph comes back as soft breaks
(`Hard one\nhard two`), also lossy. Not yet reproduced end-to-end in VS Code.

### Decisions (user, 2026-10-07, evening)

- **One setting for editor AND preview:** `vmarkd.editor.reflowLineBreaks`, **default `true`** (reflow
  like GitHub / the VS Code preview out of the box). Supersedes the 2026-06-13
  `vmarkd.preview.reflowLineBreaks` default-`false` design below. The toolbar button flips the same
  setting.
- **Open cost:** decorate in `requestIdleCallback` chunks (~5 ms each), blocks on screen first.
- Delivered as separate increments, one commit each (setting + preview → editor decorator →
  toolbar toggle → open parity).

### Steps

- [x] Spike: decorator + CSS in the chromium harness — reflow, marker glyph, round-trip
      byte-identical, caret matrix above (IR and WYSIWYG).
- [x] Decide the hard-break question: Shift+Enter = hard break in reflow mode (2026-10-07).
- [x] Hard breaks must round-trip (prerequisite — DONE 2026-10-07, [task 530](done/530-hard-line-breaks-lost-on-edit.md)): reproduce in real VS Code, fix
      at our layer (no Lute engine patch), then Shift+Enter → `\` + newline in reflow mode.
- [x] Setting `vmarkd.editor.reflowLineBreaks` (default `true`) + PREVIEW half wired (increment 2, 2026-10-07):
      protocol/editor-config/init/live config-changed; `patchPreviewReflow` routes `vditor.lute.Md2HTML` in
      `preview/index.ts` through `window.__vmarkdPreviewMd2HTML` (reflow-line-breaks.ts); an open Preview
      re-renders on a flip. NOTE: the Preview does NOT use `md2html` (previewRender.ts) — it calls the
      editor's `vditor.lute.Md2HTML`, so the patch is on `preview/index.ts` and the option is flipped only
      around that call. Unset flag (a harness that never applies the setting) = stock Lute.
- [x] DECIDED (user, 2026-10-08): copy-as-HTML (`getHTML.ts`), Vditor export and D2 `|md|` labels keep
      rendering soft breaks as `<br>` for now (they call Lute `Md2HTML` with the stock option); not in scope.
- [x] Editor-surface decorator (reflow + break markers) in IR and WYSIWYG (increment 3, 2026-10-08):
      `editing/soft-break.ts` (DOM: marker spans, caret-kept wrap/unwrap, idle chunk scheduler) +
      `editing/soft-break-observer.ts` (block-scoped MutationObserver on `#app`, window-capture structural-key
      unwrap, caret-out-of-marker, IME hold, live toggle through `onReflowLineBreaksChange`), registered as
      `observers.set('soft-breaks', …)` in `boot/finish-init.ts`; CSS in `main.css`; caret.ts resolvers skip the
      marker text; a Vditor source patch (`patchUndoSnapshotStripSoftBreaks`) keeps the spans out of undo snapshots.
      SV untouched. Decisions made on the way (each measured, see below): marker spans carry
      `contenteditable=false`; Ctrl+Backspace / Ctrl+Delete are structural keys too; the selection is re-written
      after a wrap that changed the DOM; selection reads happen once per chunk, not per block.
- [x] Toolbar toggle (pressed state, live re-apply) — increment 4 (2026-10-08): `reflow-line-breaks` Custom
      item next to Outline (`chrome/reflow-toggle.ts`: `vditor-menu--current` + `aria-pressed`, synced at init
      incl. before the overlay clone, on every effective change, optimistic apply on click); `set-reflow-line-breaks`
      message -> host writes the most specific scope that defines the value (folder > workspace > user); overflow
      cluster added. Real-VS-Code spec `reflow-toolbar.spec.ts` (two editors, More-menu press, Settings-side flip).
- [x] Open parity — increment 5 (2026-10-08): the instant-paint overlay is host HTML painted before any script, so the
      rule is applied on the HTML string host-side: `src/shared/soft-break-html.ts` (`wrapSoftBreaksInHtml`, same
      rule as `editing/soft-break.ts`, class name shared) called from `renderForMode(…, reflowLineBreaks)`; the
      provider passes `vmarkd.editor.reflowLineBreaks`. Marker CSS is in `main.css`, loaded before the overlay
      paints. Covers IR and WYSIWYG, the streaming large-doc open (same overlay prefix) and the remember /
      defaultMode path (the overlay follows `savedMode`); SV has no overlay. Reflow off = overlay unchanged.
      Tests: `test/backend/soft-break-html.test.ts`, `lute-host.test.ts` (flag), `soft-break-html-parity.test.ts`
      (43 corpus entries, string wrapper == DOM wrapper in jsdom), real-VS-Code `prerender-reflow-parity.spec.ts`.
- [x] Unit + chromium e2e + real-VS-Code e2e for the editor half, red-green-red (increment 3):
      `soft-break.test.ts`, `soft-break-observer.test.ts`, `caret.test.ts`, `vditor-source-patches.test.ts`,
      `media-src/e2e/soft-break-reflow.spec.ts`, `test/vscode-e2e/soft-break-reflow.spec.ts` (IR + WYSIWYG).

### Increment 3 measurements (2026-10-08, chromium harness, 1500 paragraphs x 3 lines = 3000 breaks)

- Open (`setValue` of the document): first screen decorated **~100 ms after the call, before the first paint**
  (the first 5 ms chunk runs inside the observer callback, blocks on screen first, confirmed on screen);
  the whole document **~170-200 ms** in ~600 idle chunks. No long task beyond the ones the same `setValue` has
  with the setting off (one ~90 ms task both ways).
- Two things the spike did not see, both fixed: (1) reading the selection after a DOM change forces a style +
  layout flush (~1.2 ms per call; per block it made the whole pass 6-8 s and one pass 1.8 s of self time) —
  now read once per chunk and only when the editor is focused; (2) Vditor's undo diffs consecutive `innerHTML`
  snapshots (diff-match-patch, 1 s timeout), and our spans made the first snapshot after a decorated open differ
  at every break — a 1003 ms `diff_bisect_` — so the snapshot clone is taken span-free (build patch).
- Per keystroke (median of 30, `execCommand('insertText')` to the end of the microtask checkpoint, caret in
  the middle of the 1500-paragraph document): IR 10.5 ms vs 6.7 ms off (+3.8), WYSIWYG 8.0 vs 7.4 (+0.6); the
  block-scoped decoration itself is ~1-2 ms.
- Copy across a marker puts `text/plain` = the markdown with `\n` on the clipboard (no glyph, no space);
  `Selection.toString()` reads the paint (spaces) — both pinned in the chromium spec.
- Real VS Code 1.129 (both modes, one boot each): one visual line + generated ↵, selection text, mid-paragraph
  edit across a marker, undo / undo again / redo each restore text and caret (the next keystroke lands there),
  Shift+Enter at a paragraph end saves `\` + newline, live flip off/on, saved bytes exact.
- Known, accepted: End/Home go to the ends of the VISUAL line, which after reflow is the whole paragraph;
  Backspace/Delete across a break deletes the newline (the "space" disappears), same markdown as with the
  setting off.

### Increment 5 measurements (2026-10-08, real VS Code 1.129, `prerender-reflow-parity.spec.ts`)

Fixture: heading + 3 soft-wrapped paragraphs + blockquote + list with continuation lines + hard break + tail.
Block top (relative to the root) / height, overlay -> live editor, reflow ON, before the fix (IR and WYSIWYG
identical): paragraph 1 84 -> 42 px (3 markers), paragraph 2 top 188.97 -> 146.97, blockquote 268.83 -> 184.83
(63 -> 21 px), list 347.83 -> 221.83 (87.5 -> 45.5 px), last paragraph 530.33 -> 341.33 — a ~190 px jump of the
bottom of the first screen, and the overlay had no markers at all. Reflow OFF: overlay == live (no mismatch).
After the fix: all four cases (ir/wysiwyg x on/off) equal, markers present on both sides. Deliberately
disabling the call in `renderForMode` reproduces exactly the original diff. Cost: `wrapSoftBreaksInHtml` on a
12 kB overlay prefix (the host cap) ~0.2 ms; a document with no newline in a block returns the same string.

## Resolved (2026-06-13)

**Root cause (verified):** Lute exposes `SetSoftBreak2HardBreak`, default **`true`** (soft `\n` →
hard `<br>`). Vditor's `setLute.ts` calls ~18 Lute setters but **never** calls this one, so the
default wins → vMarkd emits `<br>`. The vendored `media/vditor/dist/js/lute/lute.min.js` DOES
expose `SetSoftBreak2HardBreak`. Vditor is the outlier — both VS Code (markdown-it/CommonMark) and
GitHub.com reflow soft-wrapped prose.

**Scope = PREVIEW ONLY (investigate option (a), confirmed safe).** `previewRender.ts → md2html()`
builds its **own** Lute (`const lute = setLute({…})` + `lute.Md2HTML()`) and renders **exactly** the
preview surfaces (SPLIT right pane + IR/WYSIWYG "Preview" button overlay `.vditor-preview`). The
edit surfaces (IR/WYSIWYG/SV) use **separate** Lute instances → patching only `md2html` flips reflow
in the preview while **editing keeps line-break preservation**. This makes the round-trip risk
(Investigate #2) **moot by construction**: the editor serializer is never touched, so on-disk
wrapping is unchanged. Host-side prerender (`src/lute-host.ts`) renders the **editor** first paint,
not the preview → leave it (consistent with "edit preserves breaks").

**Decisions (approved by user):**
- **Setting:** `vmarkd.preview.reflowLineBreaks` (boolean). `true` → reflow like VS Code/GitHub
  (`SetSoftBreak2HardBreak(false)`); `false` → keep `<br>` (current).
- **Default:** `false` (no behaviour change for existing docs; opt-in to parity).
- **Surface:** preview only (scope a) **+** a setting (scope c). NOT the live IR editing surface (b).

**Concrete approach (mechanism = `window.__vmarkd*` flag + esbuild source-patch — mirrors existing
patches; per ADR-0003 "behaviour, not CSS" → esbuild TS patch):**
1. `package.json` — add `vmarkd.preview.reflowLineBreaks` (boolean, default `false`) to the
   "Appearance" group; description notes "Preview surface only — editing keeps manual line breaks".
2. `src/extension.ts` — `collectConfigOptions()` (~line 1485) add
   `reflowLineBreaks: c.get<boolean>('preview.reflowLineBreaks')` (flows to webview via init +
   `config-changed`).
3. `media-src/esbuild-shared.mjs` — new `fixPreviewSoftBreak` (anchor-asserted, registered in
   `vditorSourceConfig.plugins`): in `previewRender.ts`, anchor on the unique `lute.SetHeadingID(true);`
   inside `md2html` and insert before it `lute.SetSoftBreak2HardBreak(!(window).__vmarkdReflowPreview);`
   (flag unset/false → `true` = current behaviour → no default regression).
4. `media-src/src/main.ts` — set `(window as any).__vmarkdReflowPreview = !!options.reflowLineBreaks`
   at init and in `handleConfigChanged`; best-effort live re-render of an open preview
   (`const iv=(window.vditor as any)?.vditor; if (iv?.preview?.element && iv.preview.element.style.display!=='none') iv.preview.render(iv)`).
   Consider an `applyReflowSetting(options)` helper in `live-config.ts` (parallel to
   `applyBodyOptions`/`applyLinkOpenSetting`). Editor lutes untouched.
5. Tests: e2e `softbreak.spec.ts` (preview path: flag on → no `<br>`; off → `<br>`; AND edit surface
   still `<br>` regardless — proves preview-only); backend `vditor-source-patches.test.ts`
   (patch injects `SetSoftBreak2HardBreak` + throws on missing anchor).

## Problem
CommonMark treats consecutive non-blank lines inside one paragraph as a **soft
break**, rendered as a space → the text reflows/wraps. GitHub and VS Code's
markdown preview do this. vMarkd (Vditor IR / Lute) instead **preserves the source
line breaks** — each `>`/paragraph line stays on its own visual line.

Concretely, the top blockquote of e.g. `tasks/13-outline-heading-flash.md`
(`> **Status:** … \n > **Source:** … \n > **Value / Risk:** …`) renders as 3+
stacked lines in vMarkd, vs one flowing paragraph on GitHub (see task 82 screenshots).

This is **independent of the content theme** (github/material/vscode all show it) —
it's a markdown *rendering* behaviour, not theming.

## Goal
Make soft (single-newline) line breaks inside a paragraph/blockquote **flow** like
CommonMark/GitHub/VS Code — without breaking:
- **round-trip**: editing + saving must not rewrite/reflow the user's source line
  wrapping on disk (the editor is two-way synced to the file);
- **hard breaks**: a real hard break (trailing two spaces, or `\` , or a blank
  line) must still break;
- **all modes**: IR, WYSIWYG, SV, and the host-side prerender/preview.

## Investigate (decide during implementation)
1. **Lute / Vditor knob.** Find the option controlling soft-break → `<br>` vs
   space. Candidates: Lute `SetSoftBreak2HardBreak(false)`, or a Vditor
   `options.preview.markdown.*` flag. Check how it's currently set (likely defaults
   to preserving breaks for editor fidelity). Spike with the Node Lute shim
   (`[[lute-runs-in-node]]` pattern — shim window/self + require lute.min.js) to see
   the HTML/IR-DOM output with the flag on vs off, BEFORE wiring it.
2. **Round-trip safety.** The big risk: IR is WYSIWYG-ish and round-trips the DOM
   back to markdown. If soft breaks become spaces in the DOM, does serialize
   (`VditorIRDOM2Md` / the incremental path, task 69) **re-join** the lines on save →
   silently rewriting the user's wrapped source to one long line? That would be a
   regression. Verify serialize preserves the on-disk wrapping (or scope the change
   to **preview/prerender only**, leaving the editable IR as-is).
3. **Scope options:**
   - (a) only the **preview** pane + host prerender flow soft breaks (safe, no
     round-trip impact) — likely the right call;
   - (b) the live IR editing surface too (riskier round-trip);
   - (c) a setting (`vmarkd.editor.softWrap`?) if behaviour should be opt-in.

## Tests (per AGENTS)
- **Unit/spike:** Lute output for `a\nb` (one paragraph) → flowed (space) vs `<br>`;
  serialize round-trip of a soft-wrapped paragraph returns the SAME source (no
  reflow) — guards the round-trip risk.
- **E2e:** a soft-wrapped paragraph + blockquote render as one flowing block (one
  line box at wide width), and editing+`getValue()` returns the original wrapping.

## Verify
Open `tasks/13-outline-heading-flash.md`: the `> **Status:** …` blockquote and the
multi-line "Goal" paragraph render as flowing wrapped paragraphs (like GitHub),
not stacked lines. Edit + save → the file's line wrapping on disk is unchanged.

## See also
- `82-custom-editor-themes.md` — surfaced this while matching GitHub/VS Code render.
- task 69 — incremental IR serialize (the round-trip path to protect).

## Regression: first keystroke / paste after open landed in the previous block (fixed)

With `reflowLineBreaks` on (the default), `list-tight.spec.ts` "IR list edits preserve tight..." failed:
a pasted `para one\n\npara two` (caret at the start of a nested list item) ended up outside the list. Root
cause: Vditor's `undo.recordFirstPosition` (first keydown of a freshly opened document, incl. the Ctrl of
Ctrl+V) inserts a `<wbr>` at the caret, snapshots, strips it and deliberately does NOT restore the
selection, so a caret at offset 0 is left in the now-EMPTY pre-split text node. The decorator's observer
(microtask) then ran `wrapTopBlock` -> `withSelectionKept`, whose character-count carry resolved that empty
node to the END of the previous item's text (same count), and rewrote the selection there; the paste (and
any first typed character: "Z" at an item start merged it into the previous item) went to the wrong block.
Fix: `carry()` in `soft-break.ts` carries a caret in an empty text node as the node itself (wrapping never
removes a text node). Tests: unit `withSelectionKept` empty-node case, chromium
`media-src/e2e/soft-break-paste.spec.ts` (paste + typing, reflow on/off; drives the same private
`undo.addCaret`), real-VS-Code `list-tight.spec.ts` (existing). Red-proved: unfixed -> chromium
reflow-true cases fail, real spec fails; fix broken again -> same failure.

## Regression: typing in a callout body went into the `[!NOTE]` title line (fixed)

`callout-arrow-nav.spec.ts` / `callout-edit.spec.ts` (real VS Code) failed from 371095c on: the caret was
placed at the end of the callout paragraph's FIRST text node and typed text came out as
`[!NOTE]\nXYZeditable body text`. Root cause: `wrapNewlines` in `soft-break.ts` stepped over the callout
title-line newline (which is deliberately not wrapped) with `node.splitText(i + 1)`, so every callout
paragraph became two text nodes (`"[!NOTE]\n"` + `"body"`) and everything that treats `p.firstChild` as
the callout text (callouts.ts, the specs' caret placement, Vditor's caret code) landed on the title node.
Fix: a newline that is not wrapped is skipped by index (`from`), never by splitting the node, so an
unwrapped newline leaves the DOM untouched. Tests: unit `soft-break.test.ts` "lone callout ... ONE text
node" (red on the old code: 2 child nodes), real-VS-Code callout-* / soft-break-reflow / list-tight /
hard-break-roundtrip / reflow-toolbar specs green.
