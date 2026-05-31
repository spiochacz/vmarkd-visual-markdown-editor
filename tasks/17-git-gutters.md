# Task: Git gutters — change markers vs git HEAD

> **Status:** ✅ Done. Added/modified bars next to blocks differing from git
> HEAD, themed via `--vscode-editorGutter-*`. Host: `diff-lines.ts`
> (dependency-free LCS — the `diff` pkg wouldn't ship under .vscodeignore'd
> node_modules + plain-tsc build), `git-diff.ts` (getHeadContent via vscode.git
> API, debounced scheduler). Webview: `diff-markers.ts` (pure computeBlockMarkers
> + DOM render, block→source via sample+indexOf, re-applied after setValue).
> Tests: 6+9+5 unit + 2 e2e. Block-level placement (approximate), diff exact.
> **Source:** `jes-bz/notemd` — diff markers (adapted to `CustomTextEditorProvider`)
> **Derived from (removed plan):** `notemd-reveal-and-git-gutters-plan.md` §A
> **Value / Risk:** 🟡 / medium (must re-render on mode switch & layout changes)

## Depends on
`15-shared-dom-source-mapping.md` (block→source mapping).

## Goal
Show added/modified bars next to blocks (like VS Code's editor gutter) in the
WYSIWYG view. The diff is **exact**; only on-screen placement is block-level.

## Steps
**Extension (`src/extension.ts`):**
1. Add `diff` to runtime `dependencies`.
2. `getHeadContent(fsPath)` — use the built-in `vscode.git` extension API
   (`getExtension('vscode.git').exports.getAPI(1)`), find the repo containing the
   file, `repo.show('HEAD', relativePath)`. Return `null` if no git (self-disable).
3. `computeDiffChanges(head, current)` — `diffLines` from the `diff` package, walk
   parts tracking `currentLine`: `added` → `{startLine,endLine,type:'added'}`;
   `removed` → a `'modified'` marker at the preceding line; unchanged → advance.
4. `computeDiffInfo` — guard on `MAX_DIFF_CONTENT_SIZE` (1 MB).
5. `createDiffScheduler(webview, fsPath)` — **300 ms debounced**, skip if content
   unchanged, then `postMessage({ command: 'diff-info', changes })`. Reuse our
   existing debounce infra / `lastSyncedContent`.

**Webview (`media-src/src/main.ts` + `main.css`):**
6. `renderDiffMarkers` + `findEditorElement` (active mode element). For each block,
   map DOM → source lines (shared module), find overlapping changes; on conflict
   pick by priority `removed(3) > modified(2) > added(1)`.
7. Render an absolutely-positioned bar per block at `block.offsetTop` /
   `block.offsetHeight`. Rename `notemd-diff-*` → e.g. `me-diff-*`. CSS: editor
   container `position: relative`; markers `position:absolute; left:0; width:3px`
   themed via `--vscode-editorGutter-{added,modified}Background`.
8. `clearDiffMarkers()` before each re-render; `pendingDiffChanges` stashes changes
   if the editor isn't ready; clear on `init`.
9. Re-render on: content `update`, **mode switch** (IR/WYSIWYG/SV have different
   DOM), and window resize.

## Notes / risks
Block-level placement via the approximate heuristic — good for "this paragraph
changed", not char-level. Re-render on mode switch & layout is the main maintenance
cost. Adds a small runtime dep (`diff`).

## Verify
Edit a committed file → bars appear on changed blocks and clear on revert.
Extension Development Host (no automated coverage).
