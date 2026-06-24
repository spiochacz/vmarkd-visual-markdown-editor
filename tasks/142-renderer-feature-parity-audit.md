# Task 142 — Diagram renderer feature-parity audit (hub + verify-first matrix)

> **Status:** 🔎 audit / ongoing — created 2026-06-24. The single entry point for "do our diagram
> renderers support all the engine's features?". Holds the matrix + the **verify-first** list so we
> don't spawn speculative tasks for things that may already work. Confirmed gaps get reconciled into
> the existing per-renderer task (don't duplicate) or a new focused task. Companion to the D2
> (123–135) and PlantUML (87, 136–141) task families.

## Principle
**reconcile > duplicate**, and **verify before tasking**. Every renderer keeps the
faithful-by-construction contract: render faithfully or fall back loudly (raw source) — never a subtly
wrong picture. A "gap" is only worth a task once it's (a) verified real and (b) worth doing.

## Matrix (engine · theme model · status · open gap · task)
| renderer | engine / ver | theme | status | open gap → task |
|---|---|---|---|---|
| mermaid | mermaid 11.15.0 | ✅ palette (86) | shipped | `click`/callbacks disabled (securityLevel) — verify-first |
| echarts | echarts 6.1.0 | ✅ palette+gallery (89/90) | shipped | events + remote `dataset`/data-URL (offline) — verify-first |
| flowchart | flowchart.js | ✅ fg (91) | shipped | engine-limited (upstream) |
| graphviz | viz-js 3.x | ◑ fg only | shipped (94 ✅) | NO palette pairing; HTML-labels/clusters/images — verify-first → 94 |
| abc | abcjs 6.6.3 | ◑ fg (93) | shipped | **no audio/MIDI player** → task 143 |
| smiles | smiles-drawer 2.3.0 | ◑ binary dark/light | shipped | content-theme pairing + reactions → 97 |
| markmap | markmap 0.18.12 (vendored) | ❌ baked | verify | webview `Markmap.create` blocker + theming → 95 |
| mindmap | echarts-tree | ◑ baked | shipped | disable-vs-theme decision → 98 |
| nomnoml | nomnoml 1.7.0 | ? | shipped (wired) | theming (`#fill/#stroke`) — verify-first → 103 |
| wavedrom | wavedrom 3.6.1 | ◑ (signal colors kept) | shipped (wired) | reg/assign skins, config — verify-first → 101 |
| geojson/topojson | Leaflet 1.9.4 + topojson 3.1.0 | n/a | shipped (wired) | **no base-map tiles** (remote → CSP) → 99 |
| vega / vega-lite | vega 7.x (embed) | ? | shipped (wired) | **`data.url` stripped** (offline); theming — verify-first → 102 |
| stl | three.js 0.184 | n/a | shipped (wired) | orbit/lighting/large-model — verify-first → 100 |
| d2 | WASM + ELK/dagre | ✅ themes (119) | shipped | tasks 123–135 |
| plantuml | TeaVM | ◑ fg | shipped (87) | tasks 136–141 |
| math (KaTeX) | KaTeX | ✅ currentColor | shipped | — |

## Verify-first checklist (don't task until checked against the real engine)
- [ ] graphviz: HTML-like labels, clusters/subgraphs, `image=`, fontnames render via viz-js (→ 94 notes)
- [ ] mermaid: `click`/`href` interactions + `securityLevel` — confirm intentionally disabled (→ note)
- [ ] echarts: event handlers / `dataset` from URL — confirm offline behaviour (→ note)
- [ ] markmap: shipped 0.18.12 actually renders in the real webview (the 95 spike blocker); collapse/zoom
- [ ] nomnoml: `#fill`/`#stroke` directives + default colours vs content theme (→ 103)
- [ ] wavedrom: `reg`/`assign` skins + `config` honoured (→ 101)
- [ ] vega/vega-lite: theming (light/dark), responsive width/height; confirm `data.url` strip is desired (→ 102)
- [ ] geojson/topojson: confirm there's no tile layer at all → "geometry-only" vs vendored offline tiles (→ 99)
- [ ] stl: orbit controls, lighting, perf on large meshes (→ 100)

## How to use
1. Pick an unchecked item, render it through the real engine (throwaway harness / real-VS-Code suite).
2. PASS → check it off + note in the linked task. FAIL → reconcile into that task's "open gaps" (or, if
   substantial + untasked, spin a focused task and link it here).
3. Keep this matrix current as the renderer set / versions change.

## Related
Per-renderer tasks 89/90/91/93/94/95/97/98/99/100/101/102/103; abc audio 143; D2 123–135; PlantUML
87/136–141. Renderers wired in `media-src/src/custom-diagrams.ts` + Vditor `*Render.ts` patches in
`media-src/esbuild-shared.mjs`.
