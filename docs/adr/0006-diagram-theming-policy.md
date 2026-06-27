# ADR-0006 — Diagram theming policy: palette-pairing vs monochrome, settings, and the two palette models

- **Status:** Accepted
- **Date:** 2026-06-27
- **Tags:** theming, diagrams, palette, renderers, architecture
- **Related:** task 146 (theming-coherence audit), tasks 86 (mermaid pairing) / 90 (echarts) / 119 (D2 themes) / 91 (flowchart) / 87 (plantuml offline) / 98 (mindmap decision); skill `vmarkd-renderer-theming`; `src/theme-registry.ts` (`pairedPalette`), `src/mermaid-palettes.ts` (the 5-field model), `media-src/src/d2-render.ts` (`D2_THEMES`/`d2Catalog`), `media-src/src/diagram-retheme.ts` (the single live-flip authority, ADR-paired with task 152 item 3).

## Context

vMarkd renders ~16 diagram fence types, each via a different bundled engine. They do **not** share a theming mechanism (that's the #1 source of mistakes — see the `vmarkd-renderer-theming` skill for the per-engine mechanics). A 2026-06-24 coherence audit (task 146) mapped every renderer and found the theming worked but had **grown organically with no stated policy**:

- Two philosophies run in parallel — **full palette-paired** (mermaid, echarts, D2: real colour mapped from the content theme) and **foreground-monochrome** (graphviz, plantuml, flowchart, abc, wavedrom, nomnoml, geojson, topojson, stl, vega: the SVG is post-processed so its ink follows the theme foreground, but no palette) — with no written rule for which a *new* renderer should adopt. Result: a full-colour mermaid can sit next to a monochrome graphviz in the same document.
- Two **palette data models** exist: the 5-field `MERMAID_PALETTES` `{bg,fg,line,accent,muted}` (mermaid + echarts derive from it) and D2's richer token catalog (N1–N7 neutrals / B1–B6 primary / AA accents).
- Per-renderer **theme settings** are inconsistent: echarts (`vmarkd.theme.echarts`) and D2 (`vmarkd.theme.d2`) expose explicit pickers; everything else follows the content theme implicitly — with no rule for which renderers get a picker.
- The skill's flip-coverage claim ("only mermaid re-renders on a live flip") was stale.

This ADR records the **policy** so future renderers are intentional, not organic. It is mostly a written rule + a decision; no behavioural change ships with it (any code unification is opt-in per renderer).

## Decision

### 1. Palette-pairing is the default; foreground-monochrome is a documented fallback

A new diagram renderer **SHOULD be palette-paired** — map the content theme to the engine's colours via the layer-1 mapping (`pairedPalette` → engine-specific translation), so it sits visually with mermaid/echarts/D2.

**Foreground-monochrome (SVG post-process → `currentColor`/themed foreground) is the accepted fallback ONLY** for engines whose output cannot be palette-mapped without per-engine work disproportionate to the value (no theme API, or an opaque SVG we can only recolour by ink). When a renderer lands as monochrome, **record why** (in its task + the skill table) so the split stays intentional.

Current intentional fallbacks (no theme API / opaque output): graphviz, plantuml, abc, wavedrom, nomnoml, geojson/topojson, flowchart and vega (these two pair the *foreground* explicitly via `getComputedStyle` polling, not a palette — same monochrome tier). Promoting any of them to full pairing is opt-in future work, not a debt this ADR demands.

### 2. Expose an explicit theme picker only where the engine ships multiple first-class theme families

A per-renderer `vmarkd.theme.<engine>` override setting is justified **only when the engine ships several first-class theme families genuinely worth choosing between** — echarts (its gallery) and D2 (its native catalog). Everything else **follows the content theme implicitly**; do not add a picker per renderer by default.

The two existing pickers (`vmarkd.theme.echarts`, `vmarkd.theme.d2`) satisfy this rule and stay. (Engine vs theme namespacing: `d2Layout` stays under `diagram.*` — it's an engine, not a theme; theme overrides live under `theme.*`, consolidated 2026-06-26.)

### 3. Accept two palette data models; document the boundary (NOT unify)

`MERMAID_PALETTES` (5-field) and D2's token catalog (N1–N7 / B1–B6 / AA) **remain two separate systems**. We deliberately do **not** unify them:

- **mermaid-family (mermaid, echarts)** → the 5-field `MERMAID_PALETTES` `{bg,fg,line,accent,muted}` (`src/mermaid-palettes.ts`), selected by `pairedPalette` (`src/theme-registry.ts`).
- **D2** → its own richer token catalog (`D2_THEMES`/`d2Catalog`, `media-src/src/d2-render.ts`), reusing `MERMAID_PALETTES` only to derive the vscode/github paired variants (`pairedTheme`).

Rationale: D2's token model is **genuinely richer** than the 5-field one; promoting it to a shared layer-1 (or flattening D2 down to 5 fields for all paired variants) is churn that either complicates the mermaid/echarts path or loses D2 nuance, for no user-visible gain. The cost of "two systems" is one documented boundary — cheaper than either unification. (Considered and rejected: (b) promote D2's model to shared layer-1; (c) make D2 consume `MERMAID_PALETTES` for all paired variants.)

### 4. The skill is the living per-renderer reference; keep its flip-coverage honest

`vmarkd-renderer-theming` is the canonical per-renderer map. Its flip-coverage section and "Reacts to theme?" table MUST track `diagram-retheme.ts` reality (updated 2026-06-27: ~15 renderers re-render on a live flip through the single `rethemeDiagrams()` authority; only markmap stays baked). A renderer change that alters theming updates the skill in the same pass.

### 5. mindmap + smiles are accepted as deliberate partials (◑), not debt

- **smiles** is binary dark/light (smiles-drawer takes only `'dark'|undefined`) — accepted as-is; not worth a palette mapping (prior decision: "leave it").
- **mindmap** (ECharts tree) bakes some colours — accepted partial; revisit only alongside the mindmap disable-vs-theme decision (task 98), not as standalone work.

### 6. markmap is the one fully-baked renderer — tracked elsewhere

markmap has zero theming and does not re-render on a flip. No new work here; tracked near task 95 (its webview blocker). Listed for the complete picture.

## Consequences

- **Future renderers have a rule:** default to palette-pairing; fall back to monochrome only with a recorded reason; add a theme picker only for multi-family engines. The organic split becomes an intentional one.
- **No code churn now:** two palette models stay; the deliverable is this ADR + the refreshed skill. Existing per-engine translation unit tests (`mermaid-theme`, `echarts-theme`, `d2-theme.test.ts`) remain the regression net if any future unification is attempted.
- **The boundary is documented, not enforced by code** — a developer could still wire a new renderer the "wrong" way; the skill table + this ADR are the guard, reviewed per renderer.
