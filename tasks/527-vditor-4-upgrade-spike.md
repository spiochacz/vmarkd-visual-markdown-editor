# Task 527 — Spike: what would it take to move from Vditor 3.11.2 to 4.0.0?

**Status:** 🔬 spike (estimate only; no upgrade is committed by this task) · **Impact:** 🟡 med (upstream fixes we lack, and the price of every future bump) · **Origin:** upstream version check 2026-10-07

## Problem

We run `vditor@3.11.2` (2025-09-02, `media-src/package.json` `^3.11.2`, lockfile-pinned). Upstream has
since shipped **3.11.3** (2026-08-11) and **4.0.0** (2026-08-30). Highlights from the upstream
`CHANGELOG.md`:

- **4.0.0:**
  - WYSIWYG/IR no longer write non-breaking spaces on save (vditor#1938).
  - Content is no longer modified when an upload fails (vditor#1918).
  - Toolbar buttons no longer submit forms (vditor#1907).
  - Better list shortcuts on multi-line selections (vditor#1937) and multi-line paste in table cells
    (vditor#1012).
  - **SV mode rewritten to use a `<textarea>`** (vditor#1319).
  - `customWysiwygMobileToolbar`.
- **3.11.3:**
  - Native callout support (vditor#1866), WaveDrom rendering (vditor#1931), image captions
    (vditor#930).
  - Mermaid 11.16.1.
  - IR bold/italic toggling fixed, and IR copy keeps marks.
  - The first Enter in a list aligns with sibling blocks (vditor#939).
  - About 15 round-trip bug fixes, most of them inside Lute (already covered by task 526).

**Why this is not a version bump:** we carry anchor-asserted source patches (`VDITOR_TS_PATCHES` in
`media-src/esbuild-shared.mjs`) on about 34 Vditor files, plus CSS patches in `build.mjs`. Diffing
the npm 3.11.2 `src/` against the npm 4.0.0 `src/` (2026-10-07):

- About 1640 changed lines across 43 files. 3.11.3 alone accounts for about 460 of them.
- **15 of our patched files changed upstream:**
  - `undo/index.ts` (task 445's caret patch)
  - `ir/index.ts`, `ir/process.ts`
  - `util/selection.ts`, `util/fixBrowserBehavior.ts`, `util/editorCommonEvent.ts`,
    `util/processCode.ts`
  - `wysiwyg/afterRenderEvent.ts`
  - `sv/index.ts`, `sv/process.ts`
  - `preview/index.ts`
  - `markdown/setLute.ts`, `markdown/mermaidRender.ts`
  - `toolbar/EditMode.ts`
  - `upload/index.ts`
- `assets/less/index.less`, `_reset.less`, `_sv.less` and `_wysiwyg.less` changed too, and those
  feed `patchVditorIndexCss` / `varifyVditorPalette`.
- **The SV rewrite** hits our SV patches, split-mode scroll sync and the sv-preview re-theme paths
  (tasks 454 / 466) directly. Read from the 3.11.3 → 4.0.0 source diff, it is also a **feature loss**
  for the split view:
  - The source pane becomes a plain `<textarea>`, so Lute's `SpinVditorSVDOM` span markup and the
    `_sv.less` styling (`.strong`, `.em`, `.sup`, `newline` spans, the `--editor-bottom` spacer) are
    deleted. There is no markdown syntax colouring in SV any more.
  - `sv/processKeydown.ts` shrinks from 202 to 35 lines. What is left is Tab / Shift+Tab plus the undo
    record. List and blockquote continuation on Enter and the Backspace handling are gone.
  - `sv/inputEvent.ts` and `sv/combineFootnote.ts` are deleted.
  - `selection.ts` `getEditorRange` now *throws* in SV. Any of our code that reads a DOM Range while in
    SV must branch onto `selectionStart` / `selectionEnd`.
  - Our `patchSvCopyGuard` (`sv/index.ts`) and `patchDeferGetMarkdown` (`sv/process.ts`) anchors
    disappear with the rewritten files.

  Decide explicitly whether losing SV colouring and list continuation is acceptable, or whether we
  keep the 3.11 SV implementation ourselves (that is a fork of one subsystem).
- **Native callouts and WaveDrom** overlap our own implementations (task 106 / 179 callouts; our
  vendored WaveDrom renderer). Choose one owner per feature; do not run both.

ADR-0004 makes a bump fail loudly at build time when an anchor breaks, so the risk is mostly time.
Task 401 asks *when* to fork instead of patch. The measured re-anchor cost from this spike is
exactly the input it needs.

## Scope (spike)

- [ ] Do this AFTER task 526: a Vditor bump assumes a recent Lute.
- [ ] On a throwaway branch: bump to `4.0.0`, run `node build.mjs`, and list every patch whose anchor
      no longer matches. For each one, record whether the patch is (a) re-anchorable as is,
      (b) obsolete because upstream fixed the same thing, or (c) in need of a redesign. SV patches
      are expected to land in (c).
- [ ] Same exercise for the `build.mjs` CSS patches against the new `index.css`.
- [ ] For callouts and WaveDrom: compare upstream's built-in behaviour with ours (round-trip, theming,
      editing), and recommend which one to keep and how to switch off the other.
- [ ] Check the bundle-size delta, the new `diff-match-patch` dependency, and the Mermaid version
      versus our vendored Mermaid.
- [ ] Also estimate stopping at 3.11.3 instead. It is probably not worth it: same files, and no SV
      rewrite to avoid later.
- [ ] Write up an hours estimate per bucket and a go/no-go recommendation here. Feed the measured
      cost into task 401.

## Out of scope

- Shipping the upgrade. If the spike says go, that becomes its own task (with real-VS-Code e2e for
  every re-designed patch).
- Forking Vditor (task 401's decision).

## Verify

- [ ] This file lists every broken anchor and every CSS patch with its bucket.
- [ ] There is a written recommendation (go / no-go / fork) with an estimate the user can decide on.
- [ ] The throwaway branch is not merged, and the working tree is back on `3.11.2`.

## See also

- `docs/adr/0004-patching-vditor.md`, task 401 (fork trigger), and task 526 (Lute re-pin, a prerequisite).
