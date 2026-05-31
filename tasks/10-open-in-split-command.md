# Task: Open in Split command

> **Status:** ✅ Done. `markdown-editor.openInSplit` opens the visual editor in
> `ViewColumn.Beside` (mirrors `openEditor`'s target resolution + diff/non-md
> guards, then `vscode.openWith(..., ViewColumn.Beside)`). Declared with a
> `$(split-horizontal)` icon and an `editor/title` entry (navigation@11, next to
> "Open with markdown editor"). Single `option` registration kept — no dual
> default/option. Host-side → unit: +5 tests (110 total). No keybinding (avoids
> clashing with the built-in markdown-preview `ctrl+k v`).
> **Source:** `aqz236/vscode-markdown-editor` — §4b
> **Derived from (removed plan):** `aqz236-port-plan.md`
> **Value / Risk:** 🟡 low / low (optional)

## Goal
`markdown-editor.openInSplit` — open the editor (or the source) in
`ViewColumn.Beside`.

## Steps
1. We already have `openEditor`/`openTextEditor` using `vscode.openWith`. Add a
   variant passing `{ viewColumn: vscode.ViewColumn.Beside }`.
2. Register the command in `package.json` and add a keybinding/menu entry.

> ⚠️ Do **not** copy aqz236's dual registration (`priority: default` + `option`).
> We deliberately register as `option` only (cleaner true-default-editor).

## Verify
Run the command → editor/source opens beside the current view.
