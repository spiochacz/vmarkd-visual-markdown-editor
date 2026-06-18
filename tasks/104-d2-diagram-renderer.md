# Task 104 — D2 diagram renderer (offline WASM, standalone — no Lute merge)

> **ELK layout engine — selectable + RUNNING in the webview (2026-06-18, NOT committed):** new setting
> `vmarkd.diagram.d2Layout` (`dagre` default | `elk`) — package.json enum + `collectConfigOptions`
> (extension.ts) → `window.__vmarkdD2Layout` (main.ts, live re-render on change via `reRenderD2`). ELK adds
> ORTHOGONAL edge routing + native container nesting (engine-neutral `Layout` in d2-render.ts → one `toSVG`;
> `elk-layout.ts` builds the ELK graph, dagre stays default). **Key fix:** the stock `elk.bundled.js` spawns a
> blob **Web Worker** that `elk.layout()` REJECTS under the VS Code webview (selecting `elk` silently fell back
> to dagre). Now we vendor `elk-api.js` + `elk-worker.min.js` (the in-process **"fake worker"**, sha-pinned,
> EPL-2.0) and esbuild-bundle them via `elk-entry.ts` → `media/vditor/dist/js/elk/elk-main.js`, which constructs
> a **MAIN-THREAD** ELK instance (`window.__vmarkdElk`, no Worker/blob/CSP). Separate lazy-loaded bundle (~1.4 MB,
> fetched only when `elk` is active). `renderD2` stamps the wrapper `data-d2-engine="elk"|"dagre"`. **Gates:**
> vitest **741/741** (elk pin block: sha both files + main-thread-export guard + "no elk.bundled.js" lock +
> elk-entry wiring); `node build.mjs` (`syncElk` sha-gate + webview build emits elk-main.js); **real-VS-Code e2e
> `d2-elk.spec.ts` PASSES** — `__vmarkdElk` boots, `elk.layout()` RESOLVES in the webview (the call that used to
> reject), DOWN layout has edge sections, two D2 blocks rendered `data-d2-engine=elk` (real ELK, not fallback).
> Packaged + installed locally. `lint:ci`: my files clean (2 pre-existing format errors in unrelated files).
>
> **ELK render-fidelity fixes (2026-06-18, after rendering `tmp/tala-demo/complex.d2` through the REAL
> extension pipeline via a chromium harness):** (1) **intra-container edges were stranded at the origin**
> (top-left) — ELK `INCLUDE_CHILDREN` requires each edge declared on its endpoints' least-common-ancestor;
> dumping ALL edges on root mis-routed them. Fixed in `elk-layout.ts`: compute LCA container per edge +
> attach to that node's `.edges`, and collect edges from EVERY node offset by that node's absolute origin
> (not just `res.edges`). (2) **person/cloud/queue rendered as plain rects** — added glyphs to `toSVG`
> (`d2-render.ts`, shared by both engines): person = head circle + shoulder dome, cloud = arc-bump path,
> queue = horizontal-cylinder. Verified: all 17 shapes of complex.d2 render correctly + edge labels land in
> their containers. New unit tests: `elk-layout.test.ts` (fake worker in node + LCA intra-container
> regression) + 3 glyph tests in `d2-render.test.ts`. vitest now **746/746**. **Separate pre-existing bug
> found, NOT yet fixed:** `dagre` (the default engine) THROWS on `complex.d2` ("Cannot set properties of
> undefined (setting 'rank')") — dagre compound layout chokes on edges to/from CONTAINER nodes
> (e.g. `gateway -> frontend`). So a nested-container D2 currently renders only under `elk`; under `dagre` it
> hits the LOUD raw-text fallback. Candidate follow-up: reroute container-endpoint edges to a representative
> child, or skip them, before dagre layout.
>
> **Status:** 🟢 PHASE 1 IMPLEMENTED (2026-06-18) — built + tested locally, NOT yet committed (awaiting user go).
> Vendored compile-only D2 WASM (Go 1.25 @ d2 `2446e24`, fonts+mathjax stubbed → 10.6 MB raw, sha-pinned
> `source.json` + MPL `LICENSE`, reproducible `build/` inputs); `syncD2()` in build.mjs verifies + installs it
> into `media/vditor/dist/js/d2/`; `d2-wasm.ts` (lazy loader, owns the `D2Graph` contract, `?v=` cache-buster) +
> `d2-render.ts` (faithful `lib/shape` `dimsToFit`, `@dagrejs/dagre@3.0.0` compound layout, currentColor SVG,
> `unsupportedReason` guard) + `renderD2`/`reRenderD2` in custom-diagrams.ts (observer + theme-flip via
> `reThemePlantumlGraphviz`) + main.css (`.language-d2` in the 3 diagram groups, `.language-d2-unsupported`
> fallback panel, `@font-face`) + bundled **Source Sans 3** (SIL OFL, Regular+Bold). A top-level
> `shape: sequence_diagram` lives on the ROOT (not in `g.Objects`), so detection uses a graph-level `sequence`
> flag emitted by `main.go` (ancestor walk) → LOUD raw-text fallback. **Gates:** vitest **728/728** (d2-wasm node
> smoke 4, d2-render + detector 9, pin + font-stack guard 6), `lint:ci` clean, `node build.mjs` installs the
> artifact; e2e harness (d2 block + `test.fixme`, matching the unknown-language convention) + real-VS-Code render
> spec extended with d2 (plain → SVG, sequence → loud fallback). Also fixed a pre-existing over-strict regex in
> `webview-html.test.ts` (didn't allow the `?v=` cache-buster shipped 2026-06-17).
>
> **Task 9 follow-ups DONE (2026-06-18, A+B+C — verified rendering in the real VS Code webview):**
> (A) per-node `stroke` honoured + label-contrast (`labelColor`) on explicit fills; (B) styles
> `strokeWidth`/`strokeDash`/`opacity`/`fontColor`/`borderRadius`/`bold`/`italic` emitted from the WASM
> (`main.go` `outShape`) + applied in `toSVG`; (C) **grid** layout (manual cell placement, not dagre),
> **sql_table** (header + name/type/constraint rows, PK/FK abbrev) and **class** (fields + methods +
> visibility tokens) rendered as bespoke JS boxes (columns/members emitted from `o.SQLTable`/`o.Class`),
> curved-spline edges (Catmull-Rom). `unsupportedReason` now only fires for `sequence_diagram` (Mermaid)
> + `near`. WASM rebuilt + re-sha'd. Also fixed: new diagram langs were missing from `code-source.ts`
> `CUSTOM_LANGS` → their edit-surface source got the `.hljs` code panel; now excluded like smiles.
> **Pending:** user commit (NOT committed — project rule). `fill-pattern`/`shadow`/`3d`/`multiple`/
> `double-border` deferred (visually heavy, low value). Phase-0 detail below.
>
> **Status (Phase 0):** 🟢 PHASE 0 PASSED — **green-light Phase 1** (2026-06-18). Both go/no-go gates measured in
> REAL headless Chromium (the webview engine) + adversarially verified, every load-bearing number
> independently reproduced. **GATE 1 (init/heap): PASS** — nofonts WASM **10.6 MB raw / 1.82 MB brotli**,
> cold init **~440–590 ms** (sub-second), first compile 11–63 ms, warm 15-node compile 3–12 ms, resident
> **~28.5 MB** (16 MB WASM linear + 12.5 MB JS, leak-free) — nowhere near the disqualifying multi-second /
> 159 MB profile of the full pipeline. **GATE 2 (fidelity): PASS** — Canvas-measureText-vs-freetype drift is
> a benign systematic horizontal scale (~+9% no-font, **<1% if Source Sans Pro is bundled**, CV ~3%) that
> produces **ZERO dagre rank/ordering reshuffles** on all flat-rect diagrams in both font modes; all 10 test
> diagrams render recognizable/readable/unbroken (real side-by-side PNGs vs canonical d2 0.1.33). Artifacts
> staged at `/tmp/d2gate/` (compile-only entrypoint, both wasm variants, MVP renderer `mvp-render.mjs`,
> canonical-diff harness). **PHASE 1 next steps (in priority order):** (1) promote `/tmp/d2gate/mvp-render.mjs`
> (compile-only WASM → Canvas sizing → `@dagrejs/dagre` compound layout → SVG) into a real renderer module,
> wired into `custom-diagrams.ts` (lazy-load, currentColor theme, `data-processed`, re-render on theme flip);
> (2) bundle Source Sans Pro (SIL OFL) via @font-face → drops the +9% bias to <1%; (3) faithful-port D2's
> container box-padding + special-shape size constants (circle/diamond/hexagon/cylinder) from `lib/shape`
> (MVP used hand-tuned approximations); (4) curved-spline edges + outside-top container labels + feed
> edge-label widths into dagre; (5) **LOUD raw-text fallback** for `sequence_diagram`/`grid`/`near`/`sql_table`
> (detectable via the graph's `special` flags — NON-NEGOTIABLE, this is what keeps us faithful-by-construction);
> sequence stays Mermaid permanently. **Maintenance tax:** vendored patched-d2 prebuild (stub `init()`-welded
> fonts+mathjax), sha-pinned + rebuilt on d2 bumps — precedented by Lute. Add a Chromium fidelity-regression
> harness (reuse `/tmp/d2gate/canonical.mjs`) + confirm init/heap once inside the real VS Code Electron
> webview (gates were WSL2 headless Chromium — same V8/WASM runtime, large sub-1s headroom, but not the
> literal iframe).
>
> ---
>
> **Phase-0 spike basis (2026-06-18):** the SPLIT architecture clears both the size AND faithfulness bars
> that parked every other approach: **WASM = D2's REAL compiler only (`d2 text → graph JSON`, no render
> side); JS = dagre layout + SVG render.**
> Empirically built (Go 1.25, GOOS=js, real d2compiler) + adversarially verified to the byte:
>
> | build | raw | gzip | brotli |
> |---|---|---|---|
> | official full d2.wasm | 21.0 MB | 6.75 MB | 5.24 MB |
> | compile-only (DCE drops d2svg/chroma/**goja**/sketch/dagre/elk) | 13.6 MB | 4.61 MB | 3.60 MB |
> | compile-only + fonts/mathjax stubbed (needs patched-d2 vendor) | 12.4 MB | **3.40 MB** | **2.39 MB** |
>
> **Faithful by construction** for plain nodes/edges/containers/**vars**/**globs**/classes/styles — verified in
> Node that exactly the cases the pure-JS hybrid would silently misrender (`a->b`, nested containers,
> `shape:sql_table`, `${vars}`, `circle+fill`) compile CORRECTLY (it's D2's actual d2ir/d2compiler).
> **Escapes the silent-misrender killer** because the bespoke-layout shapes (`sequence_diagram`, `grid`,
> `near`, `sql_table`/`class` — their own Go layout that dagre can't reproduce) are DETECTABLE from the
> compile-only graph (`IsSequenceDiagram`/`IsGridDiagram`/`NearKey`/shape value) → JS detects them and falls
> back to LOUD raw-text. Detection + loud fallback is NON-NEGOTIABLE wiring (without it the split
> re-introduces the exact silent misrender that killed the pure-JS hybrid).
>
> **Two unmeasured go/no-go GATES before committing** (probes only checked correctness, not these):
> 1. Runtime **init time + heap** of the compile-only WASM in the real VS Code webview (the 3.7 s / 159 MB
>    figure was the FULL pipeline; compile-only is likely far lower but UNMEASURED — multi-second init on a
>    lazy renderer would disqualify it).
> 2. A real **visual fidelity diff** of plain diagrams vs canonical D2 — node sizing moves from D2's freetype
>    to JS Canvas `measureText`, ~8-12% drift on one machine; Source Sans Pro is absent in the webview so
>    cross-OS box geometry varies. Must look acceptable beside the playground.
>
> **Cost:** JS side (dagre 14 KB gz + SVG renderer + special-shape detection) ≈ small; the real tax is a
> **vendored patched-d2 prebuild** (stub the `init()`-welded fonts/mathjax) rebuilt on d2 upgrades —
> precedented (Lute is exactly this). Ship ONLY if both gates pass AND the maintenance tax is accepted.
> If a gate fails → back to PARK.
>
> ---
>
> **Earlier PARK analysis (2026-06-18) — superseded by the split above, kept for the rejected approaches:**
> exhaustive 5-angle small-bundle hunt (TinyGo / compression / pure-JS-hybrid / version-sweep / init+CSP),
> every number measured + adversarially re-verified. Those approaches had three fail conditions:
>
> 1. **SIZE — the cheap win is exhausted.** Raw `d2.wasm` = 21 MB, but a .vsix is a ZIP so the real
>    download is the deflated size. Measured floors: gzip-9 = **6.75 MB**, brotli-11 = **5.50 MB**,
>    official self-contained browser bundle under .vsix deflate = **6.02 MB** ≈ **2× our 3 MB bar**.
>    `DecompressionStream('gzip')` works in the webview (Electron 34/Chromium 132) but buys *nothing*
>    over the .vsix's own deflate; brotli is smaller but is NOT in DecompressionStream (needs a bundled
>    decoder). No smaller wasm exists (version sweep + community builds + `wasm-opt -Oz` all checked —
>    wasm-opt is net-negative on Go wasm since reflection blocks dead-code elimination).
> 2. **CSP — NOT a blocker (corrected 2026-06-18).** An earlier note claimed D2's
>    `Blob → new Worker(blob:, {type:module})` is blocked; that was measured under a stripped test CSP.
>    The REAL extension CSP (`html-builder.ts:48`) already ships `worker-src ${cspSource} blob:`, so the
>    official bundle's blob module-worker runs fine. The official bundle's parking reasons are purely
>    size + ~159 MB heap + ~3.7 s cold init — not CSP.
> 3. **The only sub-3 MB theories are multi-month rewrites.** TinyGo: very likely blocked — D2 imports
>    `encoding/json` (panics under TinyGo's partial reflect), embeds `dop251/goja` (full ECMAScript
>    engine, reflect-heavy, documented TinyGo-incompatible), `text/template` fails
>    (`unimplemented: reflect.Type.NumOut()`); zero prior art; source-verified in `d2js/d2wasm/functions.go`
>    + `go.mod`.
>
> **Hybrid (JS parser + native-JS layout) — deep-analyzed 2026-06-18; verdict still PARK, but on the RIGHT
> reason (fidelity, not size).** Corrections to the earlier dismissal: **(a) size is a non-issue** — a
> core-80% subset is ~3,500–4,500 LOC ≈ 35–50 KB gz + `@dagrejs/dagre` 14 KB gz ≈ **~50–65 KB gz total**
> (50× under budget; mermaid already ships 3.2 MB, so size never gated a *faithful* D2 anyway).
> **(b) A parser DOES exist** — `ravsii/tree-sitter-d2` v0.7.2 (MIT, pure-CFG → WASM-compilable,
> `web-tree-sitter` is CSP-clean), self-described "usable for everyday cases." So parse is mostly solved.
> The real cost is the **compiler/IR** (`d2ir` 4,102 LOC, globs/vars woven through 86+70 refs = a rewrite,
> not a deletion), the **dagre routing-glue** (`layout.go` 1,755 LOC: edge-chop at box boundaries, bézier
> paths, arrowheads), and **text-measurement fidelity** (D2 sizes nodes via freetype + bundled fonts
> BEFORE layout; replacing with Canvas `measureText` drifts geometry). ~6–10 person-weeks for a core subset
> + permanent grammar drift. **DECIDING FACTOR — the faithfulness invariant.** All 16 shipped renderers run
> the language's CANONICAL engine → faithful by construction; they can't silently misrender valid input.
> The hybrid would be the FIRST unfaithful renderer: it silently mis-draws POPULAR constructs (sql_table,
> sequence_diagram, vars, md-labels) to plausible-but-wrong SVG WITHOUT throwing, bypassing our
> `catch { leave raw source }` fallback. "D2-like" is worse than no-D2: no-D2 fails LOUDLY (raw text);
> the hybrid fails QUIETLY with wrong geometry. No in-budget *faithful* path exists (GopherJS-sever is
> infeasible — freetype + 2.6 MB fonts + mathjax are welded into d2target/d2ir/d2graph). **Honest middle
> ground if D2 demand is real:** a flag-gated "experimental D2 (subset)" that HARD-REJECTS (raw-text
> fallback) any input with `sql_table`/`sequence_diagram`/vars/globs/imports — turning silent misrender
> into loud, explicit non-support. Narrower + more defensible than a full hybrid.
>
> Runtime (for the record): ~21 MB module decompressed, **~159 MB peak JS heap**, cold init 2.9–5.2 s.
> Lazy-loaded so docs without a ` ```d2 ` block pay zero. **Re-evaluate only if** D2 upstream drops goja /
> adds TinyGo build tags, OR a native-JS D2 parser appears. mermaid/nomnoml/graphviz/plantuml cover most
> D2 use cases. (Layout primitives surfaced here — `@dagrejs/dagre` 14 KB gz, `elkjs` 458 KB gz — are
> worth reusing if any *other* native-JS-layout diagram need arises.)
>
> **Original status:** 📋 TODO — **spike-first / likely park** (size gate). Render ` ```d2 ` blocks via
> D2's prebuilt **WASM** build (`@terrastruct/d2`), reusing the custom fenced-renderer pass
> (task 99). **Standalone**: vendor D2's own prebuilt wasm — **no Go toolchain, no merge with
> Lute** (we explored sharing a Go runtime with Lute and rejected it: different toolchains +
> hot-path risk, see below). Spike measures the real wasm size before committing.
> **Source:** ecosystem survey — D2 is the fastest-rising "diagram as code" lang (best auto-layout:
> dagre/ELK); user request to spec the integration.
> **Value / Risk:** 🟡 modern diagrams / **high (size)** — D2 is Go→WASM; expect multi-MB.

## Problem
D2 (`x -> y`, containers, classes, SQL tables; layout via dagre/ELK) has no renderer in vMarkd.
There is **no native-JS D2** — the browser path is a Go→WASM build. We want it offline + local.

## What's available
- **`@terrastruct/d2`** (npm, **MPL-2.0**, v0.1.33): "D2.js is a wrapper around the **WASM build**
  of D2." Ships a **prebuilt** wasm + JS wrapper → **no Go SDK needed** (vendor the prebuilt blob,
  like Lute task 66). ⚠️ Package is **~60 MB unpacked** — almost certainly multiple builds/maps;
  the **actual runtime `.wasm` is the number that matters** and the spike must measure it (expect
  several MB).

## Why standalone (NOT merged with Lute)
We considered co-compiling D2 + Lute into one Go-WASM module to share the Go runtime (~1–2 MB
saving). **Rejected:** Lute ships GopherJS (different toolchain), it's on the serialize hot path
(WASM migration risks tasks 68/69 perf), and it would add a Go build step + couple versions. So D2
is integrated **independently** as its own vendored prebuilt wasm. (Full reasoning in chat / skill.)

## Spike (do FIRST — go/no-go)
1. From `@terrastruct/d2`, identify + extract the **single runtime wasm + JS wrapper** actually
   needed for the browser; **measure its real size** (ignore the 60 MB package — find the shipped
   `.wasm`).
2. In a plain headless Chromium harness (reuse `media-src/e2e`), load it and render
   `x -> y: hello` → assert non-empty `<svg>`. Confirm it runs under a CSP matching ours
   (`script-src 'wasm-unsafe-eval'` — we have `unsafe-eval`; **no external host**).
3. Measure cold init (wasm instantiate + first render) + warm render. Pick a layout engine
   (**dagre** or **ELK** — TALA is proprietary/cloud, exclude).
4. **Decision gate:** if the wasm is multi-MB and/or init is slow → **park** (same call as PlantUML
   CheerpJ, task 87). Record the numbers here. Only proceed if the size/perf is acceptable.

## Approach (if GO)
1. **Reuse the custom fenced-renderer pass** from task 99 — register `{ lang: 'd2', fn }`.
2. **Vendor** the prebuilt wasm + wrapper into `media/` (Lute pattern: `media-src/vendor/d2/` +
   `source.json` sha + `build.mjs` `syncD2()` + LICENSE/NOTICE — **MPL-2.0**). **Lazy-load** — never
   in `main.js`; instantiate only when a `.language-d2` block exists.
3. **Render** — `d2.compile(src)` → `d2.render()` → inline SVG into the block; `data-processed` guard.
4. **CSP** — wasm needs `wasm-unsafe-eval` in `script-src` (verify our `unsafe-eval` covers it; add
   if not). No remote, no CDN.
5. **Theme** — D2 has built-in themes + a `sketch` mode; pick a theme by the content-theme mode, or
   pass palette-derived colors — reuse the shared mapping (task 86/90). Live re-render on flip.

## Tests (per AGENTS)
- **Spike harness** → kept as the size/perf record (numbers in this file).
- **e2e** — a ` ```d2 ` block renders an inline `<svg>` (not a code block); no network request; theme
  flip re-renders. **`d2-pin.test.ts`** sha/version/MPL-notice guard (mirror `mermaid-pin.test.ts`).

## See also
- Skill `vmarkd-renderer-theming` (offline/CSP discipline; the Go-WASM "heavy blob, no runtime
  sharing" finding). Task 99 (renderer pass), task 87 (PlantUML/TeaVM — the comparable WASM-engine
  size gate), task 66 (prebuilt-vendor pattern).
- `@terrastruct/d2` (npm, MPL-2.0); D2 lang: oss.terrastruct.com/d2.
