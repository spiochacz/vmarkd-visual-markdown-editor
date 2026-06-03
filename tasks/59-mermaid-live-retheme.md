# Task: Live re-theme Mermaid diagrams on VS Code color-theme change

> **Status:** ⬜ Not started.
> **Source:** `tuanpmt/vditor` — "auto dark/light mode switching for mermaid". See `out/vditor-co-aplikuje-raport.md` §2.1. Completes the mermaid half of task 25.
> **Value / Risk:** 🟡 closes a visible gap in live theming / medium (needs diagram re-render, not just config)

## Problem
Code-block highlighting already follows the VS Code theme live: `applyVditorTheme()` (`media-src/src/main.ts:120-130`) calls `vditor.setTheme(..., codeHljsStyle(theme), contentThemePath)`; `handleSetTheme` re-runs it on every `set-theme` message (`main.ts:547-551`), posted from the host's `onDidChangeActiveColorTheme` (`src/extension.ts:1042-1048`).

But **mermaid does not re-theme**:
- `applyMermaidTheme` (`media-src/src/mermaid-theme.ts:18-53`) only injects the configured `mermaidTheme` setting; `'auto'` leaves Vditor's own dark/default choice.
- `handleSetTheme` calls `applyVditorTheme` but **never** `applyMermaidTheme`.
- `mermaidTheme` is in `INIT_ONLY_OPTIONS` (`media-src/src/live-config.ts:65`), so even a *setting* change forces a full re-init to re-theme diagrams.

Result: flipping VS Code dark↔light leaves existing mermaid diagrams in the stale theme until reopen/re-init. (Wavedrom is N/A — not used here.)

## Goal
On a live color-theme change, mermaid diagrams re-render in the matching dark/light theme — without a full Vditor re-init — at least when `mermaidTheme` is `'auto'`/unset.

## Steps
1. `media-src/src/mermaid-theme.ts` — add a mapping for `'auto'` → concrete mermaid theme based on the current editor theme (e.g. `dark` → `'dark'`, light → `'default'`), so theme can be derived from the `set-theme` payload, not just the setting.
2. `media-src/src/main.ts` `handleSetTheme` (`:547-551`) — after `applyVditorTheme`, also call `applyMermaidTheme(window, resolvedMermaidTheme(theme, options))` **and** trigger a re-render of already-rendered mermaid nodes. Re-rendering options:
   - re-run Vditor's mermaid render over `.language-mermaid` / rendered `<svg>` containers (check how `processCodeRender` / mermaid render is invoked in our bundled Vditor and in `stream-render.ts:140-144`), or
   - reset the rendered nodes' `data-processed` and call mermaid's render again.
3. Reconsider `INIT_ONLY_OPTIONS`: if a live re-theme path exists, `mermaidTheme` may no longer need to be init-only for the `'auto'` case (explicit non-auto theme changes can stay re-init if simpler). Keep `live-config.test.ts` in sync.
4. Preserve cursor/scroll (the whole point of `set-theme` vs re-init).

## See also
- `tasks/25-theme-live-switch.md` (the parent live-theme task — this is the mermaid follow-up).
- `media-src/src/mermaid-theme.ts` (+ `mermaid-theme.test.ts`), `live-config.ts:65`.

## Verify
Open a doc with a mermaid diagram; toggle VS Code light↔dark (and High Contrast): the diagram re-colours to match, cursor/scroll preserved, no reopen. Confirm explicit `mermaidTheme` setting values still win over `'auto'`. Update `mermaid-theme.test.ts` / `live-config.test.ts`.
