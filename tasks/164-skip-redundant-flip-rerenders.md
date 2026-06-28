# Task 164 — Skip redundant diagram re-renders on a theme flip (quick-wins bundle)

**Status:** TODO (ready — five independent S-effort waste-removals, low risk, ship as one PR).
**Source:** vMark perf analysis (2026-06-28, 39-agent workflow `wf_19aa433d-4fa`).
**Value / Risk:** 🟨 medium (theme-flip latency on diagram-heavy docs; visible flicker) / 🟢 low (all subtractive / exact-equality gated; skipping a re-render is strictly *safer* for caret + scroll than running one).
**Engines:** mermaid, echarts, the monochrome SVG group (plantuml/graphviz/abc/wavedrom/nomnoml/geojson/topojson), stl, all custom.

## Premise

On a VS Code dark↔light flip (`handleSetTheme`, `media-src/src/main.ts:559-569`) the diagram
re-theme path re-renders engines whose output is **byte-identical** for the new mode, and
fires some re-renders **twice**. None of this is a typing hot path — it's cold-path waste on an
infrequent user action — but it's pure waste with no upside, and several items also remove a
visible flicker (mindmap entry-grow animation, double WebGL rebuild). The five fixes below are
independent; bundle them because each is tiny and they share the "produce an identical result, so
don't do the work" shape. **No setting, no new DOM, no Worker/CSP surface.** Avoid `Date.now`/
`Math.random` (host-unavailable) — use exact string equality for the signatures.

---

### 1. Mermaid — skip re-render when the resolved init is unchanged

`resolveMermaidInit` (`media-src/src/mermaid-theme.ts:40-63`) **ignores its `_mode` arg** for the
explicit-builtin (45-47), explicit-palette (48-53) and content-theme-paired (55-61) branches; only
the `return null` fall-through (62, the auto-binary case) is mode-dependent. The `initialize`
wrapper (`mermaid-theme.ts:88-96`) force-overrides theme + `themeVariables`, so for any non-null
init a dark↔light flip yields a byte-identical SVG. Yet `rethemeDiagrams`
(`media-src/src/diagram-retheme.ts:151-157`) **unconditionally** calls `reRenderMermaid`, which
re-parses + re-runs full dagre layout for every diagram (`mermaid-retheme.ts:65`).

**Fix:** in `rethemeDiagrams` compute a signature of `resolveMermaidInit`'s `{theme, themeVariables}`
(**plus the effective light/dark mode ONLY when `resolveMermaidInit === null`**, the auto branch),
store it on `window` after `applyMermaidTheme`; if equal to the last-applied signature, still call
`applyMermaidTheme` but **skip `reRenderMermaid`**.
**Caveats:** the `init===null` (auto) branch genuinely needs the mode in the signature or auto
diagrams go stale; never skip on the first flip / before any prior render (no stored signature →
re-render); don't skip when `mermaid.min.js` was just re-loaded with no prior render.

### 2. ECharts — skip dispose+reinit when the resolved spec is unchanged

Same shape, heavier. `rethemeDiagrams` (`diagram-retheme.ts:158-169`) always calls
`reRenderEcharts`, which **disposes + re-inits every chart in every pane** and force-rebuilds all
mindmaps via `reconstructMindmaps(...,true)` (`media-src/src/echarts-retheme.ts:30-82`).
`resolveEchartsTheme` (`src/echarts-theme.ts:264-291`) is **mode-independent** for explicit/gallery/
custom themes (271-276) and content-theme-paired palettes (279-283); only the unpaired-auto case
(286-290) folds in mode (via `readVscodePalette`, `echarts-apply.ts:33-56`, whose CSS vars *do*
change on a flip).

**Fix:** in the `f.echarts` branch compute `sig = JSON.stringify(resolvedSpec)` (the **full**
`{name, theme}` — the auto case differs only inside `theme.backgroundColor`/`series`, so signing
`name` alone would wrongly skip and leave charts stale); always call `applyEchartsTheme` (cheap
`registerTheme` + reinstalls `window.__vmarkdEchartsResolve`/`__vmarkdMindmapStyle`); only call
`reRenderEcharts` when `sig !== window.__vmarkdLastEchartsSig`, then store it.
**Bonus:** skipping also drops the forced `reconstructMindmaps(...,true)` rebuild — the idempotent
`observeMindmaps` still handles genuine size changes, and you stop re-firing the mindmap entry-grow
animation on every toggle. The auto/unpaired case self-corrects (its sig differs → still re-renders).

### 3. Mono-group — fire once (change-gated), not twice unconditionally

`reThemeMonochromeGroup` (`diagram-retheme.ts:105-127`) runs `run()` at **both**
`requestAnimationFrame` **and** `setTimeout(400)` every flip (lines 125-126), so every plantuml/
graphviz/abc/wavedrom/nomnoml/geojson/topojson block is fully re-parsed + re-rendered **twice** per
flip — including TeaVM/viz.js WASM (`plantuml-retheme.ts:11-27` clears `data-processed`+`innerHTML`
with no short-circuit).

**Fix:** replace the fixed rAF+400 double-fire with the **foreground-change poll** already used by
`reThemeOnForegroundChange` (`diagram-retheme.ts:62-80`, ~2 s / 14×150 ms — strictly covers the
late >400 ms content-theme `<link>` settle): pass a union probe selector over the mono language
classes + a combined callback invoking the mono `reRenderLang` set; re-render only when the settled
container colour actually changes.
**Caveat:** keep **D2 off** the foreground poll — it fires on `d2LayoutChanged`/`d2ThemeChanged`
(`main.ts:651`), which don't move the editor foreground; leave its separate deferred path as-is.

### 4. STL — drop from the mono re-render group entirely

`reThemeMonochromeGroup` calls `reRenderStl` (`diagram-retheme.ts:120`), which tears down +
rebuilds the entire three.js WebGL scene (`custom-diagrams.ts:798-813` → `initStlViewer`,
700-772). But the STL material is the **fixed, theme-independent** `STL_MATERIAL_COLOR='#9aa0a6'`
(`custom-diagrams.ts:685`, applied 715-720) on a transparent canvas — a flip changes nothing
visually (and the comment at 679-684 says it must *not* follow the foreground). Combined with item 3
that's **two full WebGL rebuilds per STL block per flip for zero change**.

**Fix:** drop `reRenderStl` from the mono branch (`diagram-retheme.ts:120`) and remove the now-unused
import (~`:19`). STL needs no flip re-render at all; the transparent canvas already shows the new
page bg through.

### 5. observeCustomDiagrams — only invoke + yield for languages that have work

`observeCustomDiagrams.run` (`custom-diagrams.ts:840-856`) does
`for (const render of renderers) { render(appEl); await requestAnimationFrame(...) }` — yielding a
frame after **every one of the 8 renderers** (array 821-830) even when a renderer found zero blocks.
D2 is **last** (829), so in a D2-only doc the first D2 paint waits behind ~7 empty-renderer frame
boundaries; a no-diagram doc churns 8 `querySelectorAll`s per open-burst sweep (re-triggered by
native-render mutations). Each renderer already early-returns on empty (`findBlocks` + `if
(!blocks.length) return`).

**Fix:** do **one** combined `querySelectorAll` over `appEl` for
`code[class*="language-"]:not([data-processed="true"]), div[class*="language-"]:not([data-processed="true"])`,
bucket present langs into a `Set`, then only call `render()` **and** only `await` a frame for renderers
whose lang is present (synchronous skip for empty engines).
**Caveats:** keep the `running`/`dirty` do-while re-entrancy and the `isTyping` `deferUntilSettle`
path (863-878) intact; the pre-scan must be a **superset** of `findBlocks`' selector (do NOT add the
edit-surface `.closest(...)` filter — a false positive degrades to today's no-op, a false negative
silently drops a real diagram). The win is frame-boundary **latency** (D2-first-paint + observer
churn), not reclaimed CPU — the yields already release the thread.

---

## Verification (per AGENTS.md — real-VS-Code e2e is MANDATORY for renderer behaviour)

- **Unit:** signature equality + the mermaid `init===null` mode-sensitivity case; echarts full-spec
  signature; an all-empty `observeCustomDiagrams` pass performs **zero** rAF yields.
- **Real-VS-Code e2e** (`test/vscode-e2e/`, headless `xvfb-run -a`):
  - flip a **paired-palette** doc → mermaid + echarts SVGs unchanged AND **no** re-render/dispose
    churn (spy instance / `data-processed`); flip an **auto/unpaired** doc → they DO re-render and
    follow the new VS Code palette.
  - flip with a plantuml/graphviz block → recolours correctly across the flip **and** a late
    (>400 ms) content-theme settle (proves the poll replaces the 400 ms fallback).
  - flip with an STL block → `data-processed` + canvas instance **unchanged** (no rebuild).
  - D2-only + no-diagram fixtures → first D2 render starts sooner / no empty-engine yields.
- Keep `custom-diagrams-render.spec.ts`, `d2-theme`, mermaid + echarts retheme specs green.
- **Verify coverage** on the new code. `tsc` + `biome` + full vitest + Playwright green, headless.

## See also
- `diagram-retheme.ts` (the flip orchestrator), `mermaid-theme.ts`/`mermaid-retheme.ts` (task 59/86),
  `echarts-theme.ts`/`echarts-retheme.ts`/`echarts-apply.ts` (task 90), `custom-diagrams.ts`.
- Memory `computed-color-renderers-need-fg-polling` (the foreground poll item 3 reuses),
  `stl-3d-material-theme-independent` (item 4), `mindmap-retheme-reconstruct-from-datacode`.
- ADR-0006 (diagram theming policy). Complement: task 166 (viewport-gate the mermaid flip re-render).
