# Task: Localization (vscode.l10n + package.nls.json)

> **Source:** vMark VS Code stable-API audit (`vscode.l10n` localization)
> **Value / Risk:** 🟡 nice-to-have (PL + others) / medium
> **Engines:** ⚠️ `vscode.l10n` API ≈ `^1.73` — requires an engines bump (moot if
> task 33 already raises the floor to `^1.110`; see README engines note)

## Scope
Two separate string surfaces:
- **Extension host** (`src/extension.ts`, `src/wiki.ts`): `showError` /
  `showInformationMessage` / `showWarningMessage`, `showQuickPick` titles &
  placeholders, the "Create Page" action label, etc.
- **package.json contributions**: command `title`s, setting `description`s.
- **Webview** already has its own `Langs` table (`media-src/src/lang.ts`) — leave
  that mechanism, just make sure new strings go through it too.

## Steps
1. `package.json` command/setting titles → replace literals with `%key%` and add
   `package.nls.json` (default/en) + `package.nls.<locale>.json` (e.g. `pl`).
2. Extension-host strings → wrap in `vscode.l10n.t(...)`; add bundle files under
   `l10n/` (`bundle.l10n.json`, `bundle.l10n.pl.json`) and point
   `package.json` `"l10n": "./l10n"`.
3. Bump `engines.vscode` + `@types/vscode` to at least `^1.73` (or the task-33 floor).
4. Provide a Polish translation as the first non-English locale.

## See also
- `33-themeicon-tab.md` — if taken, the engines floor is `^1.110` and this bump is free.

## Verify
Switch VS Code display language to `pl` → command titles, settings descriptions, and
runtime messages appear in Polish; English fallback intact otherwise.
