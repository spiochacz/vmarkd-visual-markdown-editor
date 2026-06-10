# Task 104 — D2 diagram renderer (offline WASM, standalone — no Lute merge)

> **Status:** 📋 TODO — **spike-first / likely park** (size gate). Render ` ```d2 ` blocks via
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
