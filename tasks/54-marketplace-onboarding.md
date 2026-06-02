# Task 54 — Marketplace onboarding (editorAssociations docs + walkthrough)

**Status:** planned (do near a Marketplace release)

## Problem

First-run / discovery polish is missing. The custom editor is registered with
`priority: "option"` (deliberately NOT forcing itself as the default `*.md` editor),
but nothing tells the user how to make it default, and there's no getting-started
surface after install. Both hurt the Marketplace first impression.

## Scope

### Part A — README: set vMarkd as the default `*.md` editor (docs only)
- Add a short README section explaining that vMarkd opens via right-click / "Open
  With…" by design (`priority: "option"`), and how to make it the default:
  - `workbench.editorAssociations`: `{ "*.md": "vmarkd.editor" }` (and `*.markdown`).
  - Or via UI: open a `.md` → "Open With…" → "Configure default editor for *.md".
- Note the trade-off (it then shadows the built-in Markdown preview / text editor;
  users can still "Open With…" the text editor — `Ctrl+Alt+E` reveals source).
- Pure docs; no code.

### Part B — `contributes.walkthroughs` getting-started
- One walkthrough `vmarkd.gettingStarted` with a few steps, each a short markdown
  file under `media/walkthrough/` + optional image/gif:
  1. **Open the visual editor** — right-click a `.md` → Open with vMarkd (button:
     run `vmarkd.openEditor`). Mention "Open to the side" (`vmarkd.openInSplit`).
  2. **Switch to source & back** — `Ctrl+Alt+E` / the title-bar buttons
     (`vmarkd.openTextEditor` / `vmarkd.openSourceToSide`); reveal-in-source.
  3. **Make it your default** — link Part A's `editorAssociations` (button: open
     settings to `workbench.editorAssociations`).
  4. **Tune it** — point at key settings: `theme.*`, `editor.toolbar`, `outline.*`,
     `advanced.instantPreview`, `css.custom` (button: `vmarkd.openSettings`).
  - Use `completionEvents` (e.g. `onCommand:vmarkd.openEditor`,
    `onSettingChanged:vmarkd.*`) so steps auto-check as the user does them.

## Out of scope

- Video/GIF production (placeholders/screenshots first; richer media later).
- Telemetry on walkthrough completion (separate, see task 31 opt-in telemetry).

## Notes

- Walkthrough step buttons reference the existing (now `vmarkd.*`) command IDs —
  keep them in sync if commands are renamed again.
- Markdown step files can themselves be opened in vMarkd → nice dogfooding demo.
- This is release polish; sequence it just before publishing, not mid-refactor.

## Verification

- `package.json` valid; `manifest.test.ts` extended to assert the `walkthroughs`
  contribution (id + step count) so it doesn't silently rot.
- Manual: Help → Welcome / "Get Started with vMarkd" shows the walkthrough; each
  step's button runs the right command / opens the right setting.
- `tsc` + `biome` + full vitest green.
