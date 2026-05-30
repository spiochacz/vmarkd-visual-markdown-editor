# Task: Extension identity for Marketplace publication

> **Source:** vMark Marketplace-publication audit (manifest identity)
> **Value / Risk:** 🔴 hard blocker for publishing / trivial
> **Engines:** none

## Problem
`package.json` still carries the **original author's** identity — you cannot publish
to the Marketplace under someone else's publisher:
- `name: "markdown-editor-extended-settings"` (line 2)
- `publisher: "oleksiiko"` (line 7)
- `author: "Oleksii Konashevich"` (line 8)
- `repository.url` → `github.com/konashevich/...` (line 34)

## Goal
Switch the manifest to the vMark identity under your own Marketplace publisher.

## Steps
1. `package.json`:
   - `name` → vMark slug (e.g. `vmark-visual-markdown-editor`).
   - `displayName` → `vMark` (or chosen display name).
   - `publisher` → your registered Marketplace publisher id.
   - `author` → you.
   - `repository.url` → `github.com/spiochacz/vmark-visual-markdown-editor`.
   - Review `description`, `keywords`, `icon` for the new brand.
2. The `viewType` (`markdown-editor.editor`) and command ids (`markdown-editor.*`)
   are internal — **changing them is optional and breaks user keybindings/settings**;
   keep them unless you deliberately rebrand the contribution surface.
3. Confirm a Marketplace publisher exists (`vsce login <publisher>`); create one via
   the Azure DevOps publisher portal if not.
4. Check `.vscodeignore` excludes `sharp` and `node_modules` build cruft from the VSIX.

## Verify
`vsce package` builds a VSIX with the new identity; `vsce ls` / inspecting the VSIX
shows the correct publisher/name. (Do not publish until the security tasks 18/27 land.)
