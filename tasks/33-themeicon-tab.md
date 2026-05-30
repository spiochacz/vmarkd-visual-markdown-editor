# Task: ThemeIcon on the editor tab

> **Source:** vMark VS Code stable-API audit (`ThemeIcon` tab icon)
> **Value / Risk:** 🟡 small polish / low
> **Engines:** ⚠️ `^1.110` — `ThemeIcon` as a custom-editor `webviewPanel.iconPath`
> stabilized in 1.110. **This is the highest engines floor selected** → it dominates
> the manifest minimum (see README engines note).

## Problem
The custom-editor tab shows no icon (`webviewPanel.title` is set, `iconPath` is not),
so vMark tabs are visually indistinguishable from plain editors.

## Goal
Give the WYSIWYG editor tab a recognizable codicon.

## Steps
1. `src/extension.ts`, in `resolveCustomTextEditor` (near where `webviewPanel.title`
   is set, ~line 185): set
   `webviewPanel.iconPath = new vscode.ThemeIcon('markdown')` (or another fitting
   codicon / a light+dark file-icon pair if you prefer brand art).
2. Keep the existing `[edit]`/dirty title logic (`extension.ts:300`) — icon is
   independent of title.
3. Bump `engines.vscode` **and** `@types/vscode` to `^1.110`.

## Engines consequence
Raising the floor to `^1.110` makes the bumps required by tasks **34** (1.106),
**30** (l10n ~1.73), **31** (telemetry ~1.75), and **18 §2d** (LogOutputChannel ~1.74)
all **free**. If you ship those together, do the `engines`/`@types` bump once here.

## Verify
Open a markdown file in vMark → the tab shows the chosen icon, themed correctly in
light/dark. Dirty indicator still works.
