# Task: Live re-theme Mermaid diagrams on VS Code color-theme change

> **Status:** ✅ Done (2026-06-04; offscreen-render refinement 2026-06-05).
> `media-src/src/mermaid-retheme.ts` (`reRenderMermaid`) wired into `handleSetTheme`
> (`main.ts`): on a live color-theme change it reads each diagram's source from the sibling
> editable `<code>`, renders the new-theme SVGs in a hidden **offscreen sandbox**, then swaps
> each finished SVG into its live preview node atomically. `applyMermaidTheme` is re-applied
> first so an explicit `mermaidTheme` setting still wins over dark/light auto.
> **Why offscreen:** a first cut re-rendered in place (set the preview's textContent back to
> source for mermaid to read) — that momentarily collapsed the diagram's height, and when the
> diagram sat above the viewport it shrank the doc and **scrolled the view to the top**
> (user-reported, mermaid-only; code blocks were unaffected). Offscreen render keeps the live
> DOM intact (old SVG visible until the swap) → no scroll jump, no flash, cursor/scroll
> untouched. e2e (`media-src/e2e/mermaid.spec.ts`): asserts the embedded theme CSS changes
> (ids stripped), the live diagram **never loses its `<svg>`** during the swap (the
> no-collapse guard), and the source survives. `INIT_ONLY_OPTIONS` untouched — explicit
> setting changes still re-init; this handles the live color-theme flip. 381 unit · 101 e2e ·
> biome ci clean · build OK.
> **Source:** `tuanpmt/vditor` — "auto dark/light mode switching for mermaid". Completes the mermaid half of task 25.
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
