# Task: Tab-group awareness (open-beside-as-source, no duplicate tabs)

> **Source:** vMark VS Code stable-API audit (`window.tabGroups` API)
> **Value / Risk:** 🟡 multi-view UX polish / low–medium
> **Engines:** none (`window.tabGroups` available since ~1.67, below current `^1.64`+
>   floor — verify exact version in docs before relying on newer members)

## Goal
Use the `window.tabGroups` API to make the WYSIWYG ⇄ source relationship tab-aware:
- **Open beside as source:** open the text view of the current file in the adjacent
  group (`ViewColumn.Beside`), reusing an existing tab for that file if one is already
  open instead of creating a duplicate.
- **Avoid duplicate vMark tabs:** when invoking the editor on a file that already has a
  vMark tab open in some group, reveal that tab rather than opening a second one.

## Context / overlap
The code already inspects the active tab via `vscode.window.tabGroups.activeTabGroup`
and `TabInputText` / `TabInputCustom` / `TabInputTextDiff`
(`extension.ts:37-69`). This task extends that from *reading the active tab* to
*scanning all groups* and *targeting columns*.

**Overlaps `10-open-in-split-command.md`** (which adds a simple `openInSplit` via
`vscode.openWith` + `ViewColumn.Beside`). Decide the split: either fold the
reuse/dedup logic into task 10, or keep task 10 as the minimal command and this task
as the tab-graph–aware layer on top. Do not ship two competing "open beside" commands.

## Steps
1. Add a helper that scans `vscode.window.tabGroups.all` for a tab whose input matches
   a given uri + kind (`TabInputCustom` with our `viewType`, or `TabInputText`).
2. "Open source beside": if a source tab exists, focus it; else
   `vscode.commands.executeCommand('vscode.openWith', uri, 'default', { viewColumn: vscode.ViewColumn.Beside })`.
3. Before opening a vMark editor (`openEditor`, `extension.ts:86-109`), check for an
   existing vMark tab for that uri and reveal it instead of re-opening.
4. Register any new command + menu/keybinding in `package.json`.

## See also
- `10-open-in-split-command.md` — resolve the overlap before implementing.
- `35-status-bar-reading-time-mode.md` — shares active-tab-kind detection.

## Verify
With a file open in vMark, "open source beside" puts the text editor in the adjacent
column; running it again focuses the same source tab (no duplicate). Invoking the vMark
editor on an already-open file reveals the existing tab instead of opening a second.
