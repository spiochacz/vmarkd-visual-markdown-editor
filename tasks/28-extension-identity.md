# Task: Extension identity for Marketplace publication

> **Source:** vMark Marketplace-publication audit (manifest identity)
> **Value / Risk:** 🔴 hard blocker for publishing / trivial
> **Engines:** none
>
> **Status (2026-05-30):** ✅ manifest identity set — `name: vmarkd`,
> `displayName: vMarkd — Visual Markdown Editor`, `publisher: spiochacz`,
> `author: Sławomir Piochacz`, `repository.url →
> github.com/spiochacz/vmarkd-visual-markdown-editor`, `version → 1.0.0`.
> `viewType` / command ids left unchanged (internal). VSIX filename convention
> aligned to `vmarkd-<ver>.vsix` across the release tooling (`release-marketplace.sh`,
> `republish.md`, `copilot-instructions.md`, `README.md`). Brand text refreshed:
> `description`, `keywords` (+`vmarkd`, `visual-markdown`), and
> `customEditors[0].displayName → "Visual Markdown Editor"`.
> Release tooling `master → main` fixed (`release-marketplace.sh`, `republish.md`,
> `copilot-instructions.md`; task 24 plan text too).
> **Verified since:** (a) `icon` ✅ — `media/logo.png` is now the vMarkd brand mark
> (M↓V), which `package.json` already references; (c) `vsce package` builds a clean
> VSIX under the new identity (done while preparing 1.0.0); (d) security tasks
> 18/27 ✅ landed.
> **Remaining before publish:** (b) register/login the `spiochacz` Marketplace
> publisher (`vsce login spiochacz`) — operational, not code.

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
   - [x] `name` → `vmarkd`
   - [x] `displayName` → `vMarkd — Visual Markdown Editor`
   - [x] `publisher` → `spiochacz`
   - [x] `author` → `Sławomir Piochacz`
   - [x] `repository.url` → `github.com/spiochacz/vmarkd-visual-markdown-editor`
   - [x] `description` refreshed for the brand
   - [x] `keywords` += `vmarkd`, `visual-markdown`
   - [x] `icon` → `media/logo.png` is the vMarkd brand mark (M↓V); referenced by `package.json`
2. [x] `viewType` (`markdown-editor.editor`) and command ids (`markdown-editor.*`)
   kept unchanged (internal — changing them would break user keybindings/settings).
   Note: `customEditors[0].displayName` (a label, not an id) was rebranded to
   `Visual Markdown Editor`.
3. [ ] Confirm a Marketplace publisher exists (`vsce login spiochacz`); create one
   via the Azure DevOps publisher portal if not. **(operational)**
4. [x] `.vscodeignore` excludes `node_modules` (so `sharp`, a devDep, is excluded too).

## Verify
- [ ] `vsce package` builds a VSIX with the new identity; `vsce ls` / inspecting the
  VSIX shows the correct publisher/name. (Do not publish until the security tasks
  18/27 land.)
