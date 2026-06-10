# Task: Support VS Code's `markdown.copyFiles.destination` for the image save path

> **Status:** 📋 TODO
> **Source:** VS Code built-in Markdown — [Inserting images and links to files](https://code.visualstudio.com/docs/languages/markdown#_inserting-images-and-links-to-files)
> **Value / Risk:** 🟢 settings interop — users who already configured the built-in Markdown editor get the same image destination in vMarkd with zero extra config / low (read-only consumption of a stable, documented setting)

## Problem
When an image is pasted/dropped into the built-in Markdown editor, VS Code copies it to the
location configured by **`markdown.copyFiles.destination`** — a glob→path map with its own
variable set (`${documentDirName}`, `${documentBaseName}`, `${documentWorkspaceFolder}`,
`${fileName}`, …) and optional snippet-style transforms.

vMarkd's upload path ignores that setting entirely: `MarkdownEditorProvider.getAssetsFolder`
(`src/extension.ts:1525`) only reads our own `vmarkd.image.saveFolder` with a different,
smaller token set (`${projectRoot}`, `${file}`, `${fileBasenameNoExtension}`, `${dir}`).
A user who set up `markdown.copyFiles.destination` for the native editor gets images saved
to a *different* folder the moment they paste inside vMarkd — silent config divergence.

## Goal
Pasting/dropping an image into vMarkd lands in the same folder the built-in Markdown editor
would use, honoring `markdown.copyFiles.destination` (glob matching + its variables), without
breaking existing `vmarkd.image.saveFolder` configs.

## Design notes
- **Precedence** (proposal): explicit `vmarkd.image.saveFolder` (non-default) →
  `markdown.copyFiles.destination` (first matching glob) → default `assets`. Document it in
  the `saveFolder` setting description.
- **No public API** resolves the setting — VS Code's logic lives in its bundled
  `markdown-language-features` extension. We re-implement: read the map via
  `workspace.getConfiguration('markdown', uri).get('copyFiles.destination')`, match the
  document path against the glob keys, expand variables.
- **Glob matching**: zero-deps posture (see task 45) — either a small hand-rolled matcher for
  the common subset (`**`, `*`, `?`) or vendor a micro-matcher with license shipping (mirror
  the Mermaid/Lute vendoring pattern). Decide in step 1.
- **Variables**: support at least `${documentDirName}`, `${documentRelativeDirName}`,
  `${documentFileName}`, `${documentBaseName}`, `${documentExtName}`,
  `${documentWorkspaceFolder}`, `${fileName}`, `${fileExtName}`. Snippet transforms
  (`${documentBaseName/(.*)/${1:/lowercase}/}`) are optional — log + skip if too costly.
- A destination value ending in `/` is a directory; otherwise the last segment can rename
  the file (`${fileName}` interpolation) — `getAssetsFolder` currently returns a folder only,
  so the rename case needs a small upload-path extension or explicit non-support (documented).

## Steps
1. **Spike** the matcher decision (hand-rolled vs vendored micro-glob) against real
   `copyFiles.destination` examples from the docs.
2. Implement resolution in/next to `getAssetsFolder` (`src/extension.ts:1525`): glob match →
  variable expansion → absolute folder; keep the existing `saveFolder` path untouched.
3. Wire precedence + update the `vmarkd.image.saveFolder` description in `package.json`
   (mention the interop and precedence).
4. Unit tests (vitest, `test/backend/`): glob matching, each variable, precedence,
   multi-root workspace (`scope: resource` — per-folder overrides), no-match fallback.
5. CHANGELOG entry (fork-vs-original style: "honors VS Code's
   `markdown.copyFiles.destination`").

## Verify
With `"markdown.copyFiles.destination": { "/docs/**/*": "images/${documentBaseName}/" }` and
no `vmarkd.image.saveFolder` override, pasting an image into `docs/guide.md` inside vMarkd
saves it under `docs/images/guide/` and inserts the matching relative link — identical to
what the built-in Markdown editor does. With an explicit `vmarkd.image.saveFolder`, the old
behavior wins.

## See also
- `src/extension.ts:1525` — `getAssetsFolder` (current `saveFolder` token expansion).
- `media-src/src/main.ts` upload handler — inserts `![](relpath)` after host saves the file.
- Task 32 (link/image path autocomplete), task 74 (WebP conversion on upload) — same path.
- VS Code docs: https://code.visualstudio.com/docs/languages/markdown#_inserting-images-and-links-to-files
