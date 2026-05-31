# Task: Reveal-in-Source (jump to cursor's line in the text editor)

> **Status:** ✅ Done. `markdown-editor.revealInSource` posts `get-cursor-offset`
> to the active panel (1s timeout, self-disposing listener), maps the reply via
> the new pure `selectionForOffset` (src/reveal-range.ts), then
> `showTextDocument(Beside)` + select line + `revealRange(InCenter)`. Webview
> replies using task-15's exact Lute-caret mapping. Contributes command +
> editor/title + palette entries (no keybinding). Tests: 6 unit (reveal-range) +
> 3 backend (registration, round-trip selection, no-panel abort).
> **Source:** `jes-bz/notemd` — `revealInSource` (adapted to `CustomTextEditorProvider`)
> **Derived from (removed plan):** `notemd-reveal-and-git-gutters-plan.md` §B
> **Value / Risk:** 🟢 self-contained / approximate for prose, exact for tables

## Depends on
`15-shared-dom-source-mapping.md` (`getCursorTextOffset`). **Build this first** — it
forces the mapping that gutters also need.

## Goal
A command that opens the underlying `.md` in a normal text editor **beside** the
WYSIWYG view and selects the line the cursor is on. Round-trip extension ↔ webview.

## Steps
**Extension (`src/extension.ts`):**
1. Register `markdown-editor.revealInSource`. We have no singleton panel — track the
   active panel via `webviewPanel.onDidChangeViewState` inside
   `resolveCustomTextEditor`, or resolve from the command's webview.
2. Post `get-cursor-offset`, await `cursor-offset` with a **1 s timeout** (no reply →
   offset = -1 → abort; listener self-disposes).
3. Map offset → line: `text.substring(0, offset).split('\n').length - 1`.
4. `showTextDocument({ preview:false, viewColumn: Beside })`, set the selection to
   the whole line, `revealRange(..., InCenter)`.
5. Add a keybinding (`when: activeCustomEditorId == markdown-editor.editor`) and
   optionally an `editor/title` menu entry.

**Webview (`media-src/src/main.ts`):**
6. Use `getCursorTextOffset()` from the shared module; handle the active mode (not
   only IR). Handle `get-cursor-offset` → reply `{ command: 'cursor-offset', offset }`.

## Notes
Approximate for prose (proportional), exact only for tables — lands on the right
line, not the exact column. Char-exact mapping would need Lute positions, not the DOM.

## Verify
Place the caret in prose and in a table cell → confirm the source lands on the right
line. Extension Development Host (no automated coverage).
