# Task 79 — Preview polish: heading spacing + scroll sync

## Status: TODO

## Problem

Two visual issues when toggling Edit ↔ Preview (toolbar button):

### A) Heading spacing differs

Headings in Preview have different vertical spacing than in Edit (IR mode). Both use `.vditor-reset h1..h6 { margin-top: 24px; margin-bottom: 16px }`, but the IR DOM inserts block separators / wrapper elements between headings that alter margin-collapsing. The result: heading distances don't match across modes.

### B) Scroll position not preserved

Switching to Preview scrolls to the top. Vditor's Preview._bindEvent calls `preview.render(vditor)` and shows the pane — no scroll position transfer. The user loses their place in the document.

## Approach

### A) Heading spacing

Compare computed margins in both modes (IR vs Preview) at the same viewport. Identify which elements disrupt margin-collapsing in IR. Either:
- Adjust Preview heading margins to match the IR visual spacing, OR
- Normalize IR margins to match standard rendered HTML (may affect editing feel)

### B) Scroll sync

On Preview toggle-on:
1. Record the scroll fraction (or the ID of the heading nearest to the viewport top) in the IR editor before hiding it.
2. After `preview.render(vditor)` completes, scroll the preview pane to the corresponding position (matching heading by ID, or proportional scroll).

On Preview toggle-off (back to Edit):
- Same in reverse — restore scroll to the equivalent position in the IR editor.

Vditor's Preview doesn't have built-in scroll sync, so this will be a patch or a post-render hook in main.ts.

## References

- Vditor Preview button: `node_modules/vditor/src/ts/toolbar/Preview.ts`
- Vditor heading margins: `node_modules/vditor/dist/index.css` line ~811
- Centring fix: PR #75 (`fix/polish-batch`)
