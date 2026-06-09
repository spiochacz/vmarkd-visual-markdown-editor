# Task: Mermaid theme palettes paired with content themes (Beautiful Mermaid import)

> **Status:** ✅ Done (2026-06-09). All 15 **Beautiful Mermaid** palettes vendored
> (`src/mermaid-palettes.ts`, MIT) + translated to mermaid `base` + `themeVariables`
> (`paletteToThemeVariables`); selectable via `theme.mermaid`. `auto` pairs the content
> theme's palette (registry `mermaid?` field + `autoMermaidTheme`). All five content
> themes paired (user's visual pick): github-light→github-light, github-dark→github-dark,
> material-dark→one-dark, vscode-light-modern→zinc-light, vscode-dark-modern→zinc-dark.
> Resolution (`resolveMermaidInit`) + injection (`applyMermaidTheme` now takes a theme
> name OR `{theme, themeVariables}`) wired into init/`set-theme`/`config-changed`.
> Re-theme gap closed: mermaid now re-renders on a content-theme change too, not just a
> VS Code flip. Unit (palettes + pairing + resolver) + e2e (`mermaid-palette.spec.ts`:
> explicit palette, auto pairing, explicit-wins). 578 unit / 226 e2e / typecheck / lint
> all green.
> **Source:** user request (2026-06-09) — follow-up to [59 — mermaid live re-theme](59-mermaid-live-retheme.md)
> + the [84](84-theme-registry.md)/[85](85-theme-completeness-contract.md) theme system. GitHub
> survey of mermaid theme projects: only [`beautiful-mermaid`](https://github.com/lukilabs/beautiful-mermaid)
> (npm, **MIT**) carries reusable named palettes; everything else is the `base`+`themeVariables` mechanism.
> **Value / Risk:** 🟡 cohesion / fidelity — additive (new options + pairing); main risk is
> `themeVariables` fidelity across diagram types (flowchart/sequence/class/state/gantt/pie).

## Problem
1. **Mermaid theming is independent of content themes.** Mermaid ships exactly **5**
   built-in themes (`default`/`base`/`dark`/`forest`/`neutral`) — and **no version bump
   adds more** (we bundle 11.6.0; verified 8→11 all carry the same 5). Our `--vmarkd-*`
   content-theme map applies **nothing** to mermaid: a diagram renders to `<svg>` with its
   own palette, so it only ever approximates *light vs dark*, never matches the chosen
   content theme (github/vscode/material). Code blocks pair an hljs style per content theme
   (task 84 `autoCodeStyle`); mermaid has no equivalent.
2. **Re-theme gap (bug, 2026-06-09).** Switching the **content theme** (e.g. `github-light`
   → `github-dark`) flips the effective light/dark mode and re-themes code blocks live, but
   does **not** re-render existing mermaid diagrams: `reRenderMermaid` is only called from
   `handleSetTheme` (VS Code theme flip) and from `handleConfigChanged` **only when
   `mermaidThemeChanged`** (`media-src/src/main.ts:878`). So diagrams stay stale until a VS
   Code flip or reopen.

## Goal
- All 15 Beautiful Mermaid palettes are selectable as `vmarkd.theme.mermaid` values,
  rendered via mermaid `base` + translated `themeVariables`.
- Content themes that **obviously map** are auto-paired (github-light→`github-light`,
  github-dark→`github-dark`). The rest (`vscode-light-modern`, `vscode-dark-modern`,
  `material-dark`) are left to a **visual decision by the user** — they default to `auto`
  (binary light/dark) until the user picks the best-fitting palette.
- The content-theme-change re-theme gap is closed.

## The palettes to vendor (Beautiful Mermaid, MIT — Copyright © 2026 Craft Docs)
Each is `{ bg, fg, line, accent, muted }` hex (zinc only sets `bg`/`fg` → rest derived).
Verbatim from `beautiful-mermaid@1.1.3` `src/theme.ts` `THEMES`:

| id | bg | fg | line | accent | muted |
|----|----|----|------|--------|-------|
| zinc-light | #FFFFFF | #27272A | — | — | — |
| zinc-dark | #18181B | #FAFAFA | — | — | — |
| tokyo-night | #1a1b26 | #a9b1d6 | #3d59a1 | #7aa2f7 | #565f89 |
| tokyo-night-storm | #24283b | #a9b1d6 | #3d59a1 | #7aa2f7 | #565f89 |
| tokyo-night-light | #d5d6db | #343b58 | #34548a | #34548a | #9699a3 |
| catppuccin-mocha | #1e1e2e | #cdd6f4 | #585b70 | #cba6f7 | #6c7086 |
| catppuccin-latte | #eff1f5 | #4c4f69 | #9ca0b0 | #8839ef | #9ca0b0 |
| nord | #2e3440 | #d8dee9 | #4c566a | #88c0d0 | #616e88 |
| nord-light | #eceff4 | #2e3440 | #aab1c0 | #5e81ac | #7b88a1 |
| dracula | #282a36 | #f8f8f2 | #6272a4 | #bd93f9 | #6272a4 |
| **github-light** | #ffffff | #1f2328 | #d1d9e0 | #0969da | #59636e |
| **github-dark** | #0d1117 | #e6edf3 | #3d444d | #4493f8 | #9198a1 |
| solarized-light | #fdf6e3 | #657b83 | #93a1a1 | #268bd2 | #93a1a1 |
| solarized-dark | #002b36 | #839496 | #586e75 | #268bd2 | #586e75 |
| one-dark | #282c34 | #abb2bf | #4b5263 | #c678dd | #5c6370 |

## Approach
1. **Vendor the palette data** — new isomorphic, dependency-free module
   `src/mermaid-palettes.ts` (pattern of `src/theme-registry.ts`): the 15 palettes above as
   a typed map + a MIT-attribution header (Craft Docs / `lukilabs/beautiful-mermaid`). This
   is **color data, not code** — we do **not** adopt beautiful-mermaid's renderer (it's a
   full standalone mermaid replacement; out of scope).
2. **Translation `paletteToThemeVariables(p)`** → mermaid **`base`** `themeVariables`. Map
   the 5 fields to the variables mermaid actually reads, e.g.:
   - `bg` → `background`, `mainBkg`/`primaryColor` (node fill, lightened on dark / as-is),
     `secondBkg`, `clusterBkg`, `noteBkgColor`.
   - `fg` → `textColor`, `primaryTextColor`, `titleColor`, `nodeTextColor`, `lineColor`
     fallback for text-on-edge.
   - `line` → `lineColor`, `primaryBorderColor`, `nodeBorder`, `clusterBorder`.
   - `accent` → `secondaryColor`/`tertiaryColor` or active/highlight nodes; sequence actor.
   - `muted` → `edgeLabelBackground`, `noteBkgColor` border, secondary text.
   - **Missing fields** (zinc): derive `line`/`accent`/`muted` from `fg`/`bg` (e.g. mix).
   - `darkMode: true` when `bg` luminance < 0.5 (mermaid needs it for derived contrasts).
   Keep the mapping in one place; iterate against real diagrams (fidelity is the only risk).
3. **Manifest** — extend `vmarkd.theme.mermaid` enum with the 15 ids (keep
   `auto`/`default`/`dark`/`forest`/`neutral`). Single-source the list in
   `media-src/src/mermaid-theme.ts` `MERMAID_THEMES` (or move to the registry) so the enum,
   the apply path, and tests share it.
4. **Apply path** — `media-src/src/mermaid-theme.ts` `applyMermaidTheme`: when the chosen
   theme is one of the **palette** ids, wrap `mermaid.initialize` to inject
   `{ theme: 'base', themeVariables: paletteToThemeVariables(palette) }`. Built-in names
   (`default`/`dark`/`forest`/`neutral`) keep today's behavior. `auto`/empty resolves per (6).
5. **Registry pairing** — add an optional `mermaid?: string` to `ThemeDef`
   (`src/theme-registry.ts`), analogous to `code`. Auto-pair **only the obvious**:
   `github-light` → `github-light`, `github-dark` → `github-dark`. Leave
   `vscode-light-modern`/`vscode-dark-modern`/`material-dark` **unset** (→ `auto`) — the
   user fills these after the **visual** check. Add a helper
   `autoMermaidTheme(mode, contentTheme)` mirroring `autoCodeStyle`.
6. **`mermaidTheme = auto` resolution** (precedence): explicit `vmarkd.theme.mermaid` wins →
   else the content theme's paired palette (5) → else today's binary dark/light.
7. **Close the re-theme gap** — in `handleConfigChanged` (`media-src/src/main.ts`), also call
   `reRenderMermaid` when `contentThemeChanged` (not just `mermaidThemeChanged`), using the
   resolved palette/mode. `reRenderMermaid` already renders offscreen + swaps SVG, so no
   scroll jump (task 59).

## Tests (per AGENTS)
- **Unit** (`mermaid-palettes.test.ts`, extend `mermaid-theme.test.ts`):
  `paletteToThemeVariables` — hex passthrough, missing-field derivation (zinc), `darkMode`
  from `bg` luminance; `MERMAID_THEMES` ⇄ palette-keys coverage (no id without a palette,
  none orphaned); registry pairing (`autoMermaidTheme('light','github-light')` ===
  `'github-light'`, vscode/material === null/`auto`).
- **e2e** (`media-src/e2e/`): a mermaid diagram renders with the paired palette (assert the
  injected `themeVariables` or an svg fill/stroke matching `bg`/`line`); **switching content
  theme re-renders mermaid** (the gap fix — diagram SVG changes); explicit
  `vmarkd.theme.mermaid` overrides the content-theme pairing.

## License / attribution
- Palettes are MIT — **Copyright © 2026 Craft Docs** (`lukilabs/beautiful-mermaid`). Include
  the notice in `src/mermaid-palettes.ts`'s header and a line in `NOTICE`/`source.json`.
  We vendor **only the color values** (facts/data), not the renderer code — minimal surface.
- No new runtime dependency; no engines bump; no asset-size change (palettes are a few KB of TS).

## Decision left to the user (visual)
Which palette best fits each content theme is a **look** call the user makes after seeing
them rendered. Sensible starting candidates to try:
- **vscode-dark-modern / material-dark:** `one-dark`, `tokyo-night`, `zinc-dark` (or keep `dark`).
- **vscode-light-modern:** `zinc-light`, `github-light` (or keep `default`/`neutral`).
The auto-pairing ships **only github↔github**; the user sets the rest in the registry once chosen.

## See also
- [59 — mermaid live re-theme](59-mermaid-live-retheme.md) (`reRenderMermaid` offscreen swap),
  [84 — theme registry](84-theme-registry.md) (`autoCodeStyle` is the pairing precedent),
  [85 — theme completeness contract](85-theme-completeness-contract.md).
- Files: `media-src/src/mermaid-theme.ts`, `media-src/src/mermaid-retheme.ts`,
  `media-src/src/main.ts` (`handleConfigChanged`/`handleSetTheme`), `src/theme-registry.ts`,
  `package.json` (`vmarkd.theme.mermaid` enum).
- Alternative for the vscode-* pair (future): beautiful-mermaid also extracts diagram colors
  from a **Shiki / VS Code TextMate theme** — we could derive mermaid colors straight from
  the active VS Code theme instead of a fixed palette. Out of scope here; logged.
