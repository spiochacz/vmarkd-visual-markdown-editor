# Task: Link / image path autocomplete from workspace

> **Source:** vMark VS Code stable-API audit (`workspace.findFiles` autocomplete)
> **Value / Risk:** 🟡 writing-tool UX win / medium
> **Engines:** none (`workspace.findFiles` + `FileSystemWatcher` are old API)

## Goal
When inserting a link or image in the WYSIWYG editor, suggest paths from the
workspace (markdown files for links, image assets for images) instead of typing them
by hand. Keep the suggestion list fresh as files change.

## Steps
1. `src/extension.ts`: on the `ready` handshake (and on demand), build candidate
   lists with `vscode.workspace.findFiles`:
   - links → `**/*.{md,markdown}`
   - images → `**/*.{png,jpg,jpeg,gif,svg,webp}`
   Make paths **relative to the document dir** (mirror the existing upload-path logic
   at `extension.ts:415-419`). Post them to the webview.
2. Keep current via a `FileSystemWatcher` (create/delete/rename) scoped to the
   workspace folder; debounce and re-post. Dispose in `onDidDispose`.
3. `media-src/src/main.ts`: feed the candidates into Vditor's hint/at mechanism
   (Vditor supports `hint` extensions) so typing `[`/`![` or a trigger offers the
   list and inserts the chosen relative path. Reuse the wiki `pageKeys` plumbing
   (`main.ts` already receives `msg.wiki.pageKeys`) as the model for passing a list.
4. Respect large workspaces: cap results and `log()` when truncated (see task 18 §2d
   logging channel).

## See also
- `23-wikilinks-resolution.md` — wiki page suggestion already passes a key list; this
  generalizes the pattern to arbitrary links/images.
- `29-capabilities-declaration.md` — disable in virtual workspaces where `findFiles`
  semantics differ.

## Verify
In a workspace with several `.md` files and images, trigger link/image insertion →
relative-path suggestions appear, selecting one inserts the correct relative path;
adding/removing a file updates suggestions without reopening.
