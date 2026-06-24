# Task 97 — smiles-drawer theme pairing (background/bond from palette; keep CPK atoms)

> **🔎 Audit 2026-06-24 (task 142):** smiles renders + binary dark/light works (Vditor +
> `media-src/src/smiles-render.ts` flatten-repair). Still open (this task): pair the dark/light to the
> CONTENT theme + live re-render on flip. Verify-first: reaction syntax + draw-options coverage.

> **Status:** 📋 TODO. smiles-drawer already does **binary dark/light** (Vditor passes
> `theme === 'dark' ? 'dark' : undefined` to `draw`), but it follows the **VS Code** mode, not
> the content theme's effective mode, and doesn't re-render on a live flip. Pair it properly:
> drive the built-in dark/light by the *content theme*, and optionally tune background/bond/
> carbon to the palette — **without recoloring the CPK atom colors** (those are semantic).
> **Source:** renderer-theming audit (the `vmarkd-renderer-theming` skill); user request.
> **Value / Risk:** 🟢 cohesion/readability / low — small; smiles is already half-themed.

## Problem
`SMILESRender.ts` calls `sd.draw(code, '#'+id, mode === 'dark' ? 'dark' : undefined)` — so a
chemical structure DOES flip dark/light, but:
1. it keys off `mergedOptions.mode` (VS Code light/dark), **not** the content theme's effective
   mode — so a `github-dark` content theme under a light VS Code theme draws the molecule light;
2. it **paints once** — a live theme flip doesn't re-render (only Mermaid does, task 59);
3. the dark/light backgrounds/bonds are smiles-drawer's defaults, not the content-theme surface.

## Important: do NOT recolor the atoms
smiles-drawer colors atoms by element (CPK-like: O red, N blue, S yellow…). Those are **semantic
chemistry conventions** — flattening them to a content-theme palette would make structures
misleading. So "theming" here is **only**: pick the right light/dark base by the effective mode,
and (optionally) align the **background**, **bond/edge color**, and **carbon/default text**
to the palette's `bg`/`line`/`fg`. Element colors stay.

## The lever
smiles-drawer takes a **themes** option: `new SmilesDrawer.Drawer({ themes: { dark:{…},
light:{…}, vmarkd:{…} } })`, then `draw(code, sel, themeName)`. A theme object sets
`background`, `C` (carbon/default), bond color, etc. (+ per-element colors we leave alone).
**Verify the exact `themes` option shape** for the pinned version (task 96) during impl.

## Approach (mirror task 86; see the skill — 3 layers)
1. **Mapping (SHARED)** — reuse `pairedPalette(contentTheme)` + `MERMAID_PALETTES` data + the
   theme's `mode` (`themeDef(contentTheme).mode`) so the effective light/dark is the **content
   theme's**, not VS Code's.
2. **Translation (per-engine, minimal)** — `paletteToSmilesTheme(palette)` → a smiles-drawer theme
   object overriding only `background` (`bg`/transparent), bond color + `C`/default (`line`/`fg`);
   **omit element colors** (inherit CPK). Or, simplest v1: just select the built-in `dark`/`light`
   by `mode` and skip the custom theme — decide during impl.
3. **Application** — patch `SMILESRender.ts` via esbuild (`fixSmilesTheme`, mirror the other
   patches): register the `vmarkd` theme on the `SmiDrawer`/`Drawer` options and pass its name to
   `draw`, using the content-theme-derived mode/theme instead of the raw VS Code `mode`.
4. **Live re-render** — mirror `reRenderMermaid`'s offscreen-swap for smiles, wired into
   `main.ts` `handleSetTheme` + `handleConfigChanged` (on `contentThemeChanged`).

## Tests (per AGENTS)
- **Unit** — `paletteToSmilesTheme` sets `background`/bond/`C` from `bg`/`line`/`fg` (valid hex)
  and does NOT set element colors (O/N/S left to defaults).
- **e2e** — a `\`\`\`smiles` molecule renders on the correct base for the content theme (dark base
  under `github-dark` even with a light VS Code theme); switching the content theme re-renders it;
  element colors unchanged.

## See also
- Skill `vmarkd-renderer-theming` (three layers; "identify the lever" — smiles' lever is the
  `themes` option, and the call already takes a `theme` arg).
- Task 96 (smiles bump — verify the `themes` shape there), task 86/90/91/93/94 (pairing
  precedents; reuse shared mapping), task 59 (`reRenderMermaid` to mirror).
- `media-src/node_modules/vditor/src/ts/markdown/SMILESRender.ts`.
