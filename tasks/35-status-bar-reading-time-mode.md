# Task: Status bar — reading time + editor mode indicator

> **Source:** vMark VS Code stable-API audit (native `StatusBarItem`)
> **Value / Risk:** 🟡 writing-tool polish / low
> **Engines:** none (`StatusBarItem` is old API)

## Goal
Show native VS Code **status bar** items while a vMark editor is active:
- **reading time** (estimated, derived from word count), and
- an **editor mode** indicator (WYSIWYG vs source) so the user can see / toggle which
  view the markdown file is currently open in.

Distinct from `02-word-count.md`, which surfaces a live word/char count **inside** the
Vditor webview. This task is about native status-bar affordances; if both ship, derive
the reading-time number from the same count rather than recomputing.

## Steps
1. `src/extension.ts`, in `activate`: create `vscode.window.createStatusBarItem(...)`
   item(s); push to `context.subscriptions`.
2. Show only when a vMark custom editor is the active tab. Reuse the existing
   active-tab tracking (`getActiveTabInput` / the `onDidChange*` listeners already
   wired around `updateEditorContexts`, `extension.ts:71-78,132-135`) to show/hide.
3. Reading time: get a word count for the active document
   (`document.getText()` → words / ~200 wpm) and render e.g. `~3 min read`. Update on
   `onDidChangeTextDocument` (debounced; a debounce helper already exists in
   `media-src/src/debounce.ts` — mirror it host-side or factor a shared one).
4. Mode indicator: show `WYSIWYG` when the active tab is `TabInputCustom` with our
   `viewType`, `Source` when it's `TabInputText` for the same file. Optional: make the
   item a command that runs `markdown-editor.openEditor` / `openTextEditor` to toggle.

## See also
- `02-word-count.md` — in-webview counter; share the count, don't duplicate it.
- `36-tabgroups-awareness.md` — both rely on knowing the active tab kind.

## Verify
Open a markdown file in vMark → status bar shows reading time + `WYSIWYG`. Switch the
same file to the text editor → indicator flips to `Source`. Close / switch to a
non-markdown tab → items hide. Editing updates the reading time live.
