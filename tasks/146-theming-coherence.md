# Task 146 — Diagram theming coherence (policy + dedup the two palette systems)

> **Status:** 📋 TODO — created 2026-06-24 from a theming-coherence audit across all renderers.
> Architecture / consistency, not a feature.
> **Source:** architecture review (2026-06-24), measured against `main.ts` flip-wiring +
> `theme-registry.ts` + each renderer's theming code.
> **Value / Risk:** 🟢 a stated policy + one palette model + an honest skill / low — mostly
> doc + a decision; any code unification is opt-in per renderer.

## Measured map (2026-06-24) — model per renderer
| Model | Renderers | Follows palette? | Re-renders on flip? |
|---|---|---|---|
| **CSS-inherit** (currentColor free) | text, inline-code, KaTeX | n/a (fg) | ✅ auto |
| **Swapped stylesheet** (hljs) | code blocks | via registry `code` | ✅ |
| **Full palette-paired** (layer-1 `palette`→engine translation) | mermaid, echarts, mindmap(◑), D2 | ✅ full colour | ✅ |
| **Foreground-monochrome** (SVG post-process → currentColor) | graphviz, plantuml, flowchart, abc, wavedrom, nomnoml, geojson, topojson, stl, vega | ❌ fg only | ✅ |
| **Binary dark/light** | smiles (◑) | ❌ | ✅ |
| **Baked** | markmap | ❌ | ❌ |

Flip-wiring lives in `main.ts` `handleConfigChanged` (`:1130-1225`) + `reThemePlantumlGraphviz`
(`:1101-1117`, despite the name it re-renders plantuml/graphviz/abc/wavedrom/nomnoml/geojson/topojson/
vega/stl/d2), `reThemeSmiles`, `reThemeFlowchart`, `reRenderMermaid`, `reRenderEcharts`.

## Findings → work items (by ROI)

### 1. 🟠 No stated policy for palette-paired vs monochrome
Two philosophies run in parallel with no written rule for which a new renderer should use. Result:
a full-colour mermaid sits next to a monochrome plantuml/graphviz in the same doc — jarring. The skill
documents the *mechanism* but not the *should*.
- **Fix:** write the policy (ADR or skill section): "diagram renderers SHOULD be palette-paired
  (layer-1 mapping); foreground-monochrome currentColor is the accepted fallback ONLY for engines
  whose output can't be palette-mapped without per-engine work. Record which fallback is which and
  why." This turns the organic split into an intentional one and guides every future renderer.

### 2. 🟠 Inconsistent per-renderer theme SETTINGS
echarts exposes `vmarkd.theme.echarts` (auto + gallery); D2 exposes `vmarkd.theme.d2` (auto +
d2-native + paired) — **moved 2026-06-26 from `vmarkd.diagram.d2Theme` into the `theme.*` namespace
for consistency with echarts/mermaid; `d2Layout` stays under `diagram.*` as it's an engine, not a
theme**; mermaid/graphviz/plantuml expose nothing (implicit content-theme). No policy for which
renderers get an explicit theme-override picker.
- **Fix:** decide + document the rule (e.g. "expose an explicit picker only where the engine ships
  multiple first-class theme families worth choosing — echarts gallery, d2 native; everything else
  follows the content theme"). Audit the existing two against it; don't necessarily add more.

### 3. 🟠 D2 duplicates the layer-1 palette system
D2 has its own `D2_THEMES` registry + `d2Catalog` builder (`d2-render.ts:196-295`) and reuses
`MERMAID_PALETTES` only for the vscode/github variants (`pairedTheme`, `:226`). Defensible — d2's
token model (N1–N7 neutrals / B1–B6 primary / AA accents) is **richer** than the 5-field
`MERMAID_PALETTES` `{bg,fg,line,accent,muted}`. But there are now **two palette systems**.
- **Decision needed:** is `MERMAID_PALETTES` too thin? Options: (a) accept two systems, document the
  boundary (mermaid-family = 5-field; d2 = token catalog); (b) promote the richer d2 token model to
  the shared layer-1 and have mermaid/echarts derive their 5 fields from it; (c) leave d2 bespoke but
  make it consume `MERMAID_PALETTES` for ALL paired variants (not just vscode/github). Record the call.

### 4. 🟡 The skill is STALE on flip coverage — fix it
`vmarkd-renderer-theming` states "Only mermaid re-renders on a LIVE theme flip." That's false now —
~15 renderers re-render on `contentThemeChanged`. Leaving it wrong risks future redundant wiring or
false "it won't re-render" assumptions.
- **Fix:** update the skill's flip-coverage section + the per-renderer table's "Reacts to theme?"
  column to match `main.ts` reality; note the offscreen-swap pattern is now shared by many.

### 5. 🟡 mindmap (◑) + smiles (binary) are half-paired — set a target or accept
Both are partially themed (mindmap bakes some colours; smiles is binary dark/light, not palette).
Decide per renderer: bring to full palette-pairing (per the policy in #1) or accept + document as a
deliberate ◑. Link to the mindmap disable-vs-theme decision (task 98).

### 6. ⚪ markmap fully baked — already tracked
The one zero-theming renderer; tracked near task 95 (webview blocker) — no new work here, listed for
the complete picture.

## Tests / verification (per AGENTS)
- This is mostly policy + docs; the deliverable is the written rule + an updated skill, not code.
- If #3 unifies the palette model, the existing per-engine translation unit tests
  (`mermaid-theme`, `echarts-theme`, `d2-theme.test.ts`) are the regression net — they must still pass
  with the shared source.

## See also
- Skill `vmarkd-renderer-theming` (the 3-layer model + per-renderer table — item 4 updates it).
- `src/theme-registry.ts` (`pairedPalette`/`autoCodeStyle`, the `palette` field), `src/mermaid-palettes.ts`
  (the 5-field model), `media-src/src/d2-render.ts` (`D2_THEMES`/`d2Catalog` — the richer model).
- Tasks: 86 (mermaid pairing), 90 (echarts), 119 (D2 themes), 138 (plantuml pairing — a #1 candidate),
  98 (mindmap decision), 142 (renderer parity hub).
