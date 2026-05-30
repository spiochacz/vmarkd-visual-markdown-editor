# Task: Declare extension capabilities (untrusted / virtual workspaces)

> **Source:** vMark VS Code stable-API audit (workspace capabilities)
> **Value / Risk:** 🟢 Marketplace professionalism + predictable behavior / low
> **Engines:** none (old contribution point)

## Problem
`package.json` declares no `capabilities`. The extension **writes files** (image
upload, wiki-page creation) and relies on Node `fs`/`path` with `file:`-scheme URIs.
Without a declaration, behavior in **Restricted Mode** (untrusted workspace) and
**virtual workspaces** is undefined, and VS Code shows no rationale to the user.

## Goal
Declare both capabilities explicitly with honest support levels + descriptions.

## Steps
1. `package.json` → add:
   ```jsonc
   "capabilities": {
     "untrustedWorkspaces": {
       "supported": "limited",
       "description": "vMark renders and edits markdown but defers writing images and creating wiki pages until the workspace is trusted."
     },
     "virtualWorkspaces": {
       "supported": "limited",
       "description": "Editing works; features that depend on the local filesystem (image upload, wiki page creation, asset resolution) are unavailable in virtual workspaces."
     }
   }
   ```
2. `src/extension.ts` → guard the FS-writing paths accordingly:
   - check `vscode.workspace.isTrusted` before the `upload` and wiki-page-create
     handlers; show an informational message instead of failing silently.
   - for virtual workspaces, detect non-`file` document schemes and disable
     FS-dependent actions gracefully.
3. Decide final support levels (`limited` vs `false`) based on how much you want to
   guarantee — `limited` keeps read/edit working, which fits a markdown editor.

## Verify
Open a folder in Restricted Mode → editing/rendering works, image upload + wiki
create are gated with a clear message. Open a virtual workspace (e.g. GitHub repo
via vscode.dev-style scheme) → no unhandled errors; FS features degrade cleanly.
