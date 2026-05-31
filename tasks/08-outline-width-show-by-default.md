# Task: Outline width + show-by-default settings

> **Status:** ✅ Done. `outlineWidth` (`--me-outline-width` var) + `showOutlineByDefault` (Vditor `outline.enable`). Same panel as 07. Unit + e2e (outline.spec).
> **Source:** `aqz236/vscode-markdown-editor` — §3 (`showOutlineByDefault`, `outlineWidth`)
> **Derived from (removed plan):** `aqz236-port-plan.md`
> **Value / Risk:** 🟡 medium / low

## Goal
Add `outlineWidth` (number, px) and `showOutlineByDefault` (boolean) on top of the
`outlinePosition` setting. **Merge — do not duplicate** the outline panel config.

## Steps
1. `package.json` → add settings:
   - `markdown-editor.outlineWidth` (number, default 200)
   - `markdown-editor.showOutlineByDefault` (boolean, default false)
2. Pass both through the webview `options:` block (as in `07-...`).
3. `media-src/src/main.ts` wiring:
   - `showOutlineByDefault` → Vditor `outline.enable`
   - `outlineWidth` → CSS var / panel width override in `main.css`
4. Rebuild the webview (`foy build`).

## See also
- `07-settings-highlight-headings-outline-position.md` — owns `outlinePosition`
  and the panel config. Implement the panel once; reference it here.
- `13-outline-heading-flash.md` — navigation flash on the same panel.

## Verify
Outline opens at the configured width and is visible by default when enabled.
