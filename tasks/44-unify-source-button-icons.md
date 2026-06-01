# Task: Unify the "open source" button icons

> **Status:** ⏳ Todo.
> **Source:** user request (2026-06-01) — the two source-opening buttons should
> share one icon.
> **Value / Risk:** ⚪ cosmetic consistency / low (icon swap only).
> **Engines:** none.

## Problem
Two buttons open the markdown source, in two different UI surfaces, drawing two
different (but similar) icons:

- **"Open source to the side"** — VS Code **editor title bar** (chrome). Icon is a
  **codicon** name string: `"$(go-to-file)"` in `package.json`
  (`contributes.commands`). Renders a page-with-arrow glyph from VS Code's icon
  font. Opens the source **beside** + reveals the caret line.
- **"open in vs code"** (`edit-in-vscode`) — Vditor **toolbar** (inside the
  webview iframe). Icon is a **raw inline SVG** string, `editInVsCodeIcon` in
  `media-src/src/toolbar.ts:58` (a page+arrow path). Opens the source in the
  **same column** + reveals the caret line.

They are already visually close (both page+arrow), but not identical, because the
two surfaces use different icon mechanisms — VS Code codicons are NOT available
inside the webview document, so the toolbar must inline its own SVG.

## Goal
Make both buttons draw the same icon.

## Approach
Replace `editInVsCodeIcon`'s SVG path (`toolbar.ts:58`) with the exact `<path>`
data from VS Code's **`go-to-file`** codicon (codicons are MIT-licensed; copy the
glyph's path into the existing `<svg viewBox="0 0 24 24" …>` string wrapper used
by the other toolbar icons). Keep the codicon reference `"$(go-to-file)"` in
package.json for the title-bar button unchanged.

## Notes / decision
- The two buttons are DIFFERENT actions (same column vs beside). Sharing an icon
  risks confusion, but they live in different surfaces (toolbar vs title bar), so
  context distinguishes them. Confirmed acceptable by the user.
- Codicon source: https://github.com/microsoft/vscode-codicons → `go-to-file`.

## Verify
Open a `.md` in vMarkd → the toolbar "open in vs code" button and the title-bar
"open source to the side" button show the same page+arrow glyph. Both still open
the source and jump to the caret line.
