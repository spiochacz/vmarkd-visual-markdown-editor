# Task: Local (offline) PlantUML rendering — no remote server

> **Status:** 📋 TODO — **spike first** (2026-06-09). Render PlantUML **fully offline in the
> webview** using PlantUML's official **TeaVM** JS build (`plantuml/plantuml` → `./gradlew
> teavm`) — plain self-hostable JS, SVG output, **no server, no CDN, no Java at runtime**.
> User decisions (2026-06-09): offline in-browser; renders out-of-the-box; **local only**.
> **Source:** user request (2026-06-09); user pointed to `plantuml/plantuml/teavm.sh`.
> Surfaced while auditing how each renderer follows the theme (mermaid task 86) — PlantUML
> was the odd one out (remote + CSP-blocked).
> **Value / Risk:** 🟡 feature / **medium** — adds a few-MB JS bundle (lazy-loaded) + a
> build-time JDK/gradle step to produce the artifact. Spike to measure real size + confirm
> it runs under our CSP.

## Problem (current state)
PlantUML **does not render at all** in vMarkd today:
- Vditor's `plantumlRender` emits `<object data="https://www.plantuml.com/plantuml/svg/~1{enc}">`
  — a **remote** call to `plantuml.com` (privacy leak) **and** blocked by our CSP
  `object-src 'none'` (task 67). The bundled `plantuml-encoder` only builds the URL.
- The user wants **fully offline, local-only** rendering.

## The right engine: PlantUML's TeaVM build
PlantUML's main repo ships a first-class TeaVM target (`teavm.sh` → `./gradlew teavm`,
sources under `src/main/java/net/sourceforge/plantuml/teavm/`). Per its
`resources/teavm/GITHUB_INTEGRATION.md`:
- **JS API** (ES2015 module from the built `plantuml.js`):
  - `render(lines, targetId, options?)` — async; writes SVG into a DOM element. Options
    include `{ dark: true }`.
  - `renderToString(lines, onSuccess, onError)` — returns the SVG **string** via callback.
- **Two files**: `plantuml.js` (TeaVM-compiled engine) + `viz-global.js` (GraphViz layout).
  ⚠️ **Not the Viz.js we already bundle.** Our `graphviz` renderer uses the OLD mdaines
  `viz.js` + `full.render.js` (worker, `new Viz({worker})`). `viz-global.js` is the **modern
  `@viz-js/viz` 3.x** build (verified: `@viz-js/viz@3.28` ships `dist/viz-global.js`). So we
  vendor `@viz-js/viz`'s `viz-global.js` here — and (see note below) can repoint `graphviz`
  onto the SAME file, replacing the old two-file mdaines build with one shared Viz.js.
- **No server, no CDN, no proprietary runtime** — runs entirely in-browser; the engine starts
  an internal worker on first use (no explicit init). **Offline-capable. Self-hostable. MIT.**
- **Output is SVG** (crisp, scalable) — not PNG.
- **Size: "several MB"** (TeaVM is AOT Java→JS, far smaller than CheerpJ's ~17 MB JVM-in-WASM).
  Lazy-load recommended.
- **Theme**: the `{ dark: true }` option gives binary light/dark — so it can pair with the
  content theme like mermaid (task 86), at least dark/light.

### Why TeaVM, not CheerpJ (correcting the first pass)
`plantuml-core` / `plantuml.js` use **CheerpJ**, whose runtime **must load from
`cjrtnc.leaningtech.com`** and is **not self-hostable** without a paid licence
(`LICENCE-CHEERPJ.md`). That breaks "offline + local-only" and forces an external host into
our CSP. **Rejected.** The TeaVM build has none of those constraints.

## Build-tooling note (important)
`./gradlew teavm` needs a **JDK + gradle** at BUILD time. Our normal build is plain Node
(`node build.mjs`) — we must **not** add Java to it. Instead, mirror the Lute pattern (task
66): build the TeaVM artifact **once** (pinned PlantUML commit), **vendor the resulting JS**
into the repo (`media/...`), and have `build.mjs` just copy it. CI/users never need Java.
(Document how to regenerate it: pinned SHA + the `./gradlew teavm` command.)

## Spike (do FIRST — go/no-go, ~½ day)
1. Clone `plantuml/plantuml`, run `./gradlew teavm -Pfast`, grab `build/generated/teavm/js/`
   (`plantuml.js` + `viz-global.js`).
2. Measure **real on-disk size** of the engine JS (the "several MB").
3. In a **plain headless Chromium** harness (reuse Playwright `media-src/e2e`), load it +
   `renderToString("@startuml\nA->B\n@enduml")` → assert non-empty `<svg>`. Confirm it works
   under a CSP matching ours (`default-src 'none'`, `script-src` + worker, **no external
   host**, `style-src 'unsafe-inline'` for inline SVG). Check whether our **existing Viz.js**
   build is compatible or the engine needs its bundled `viz-global.js`.
4. Measure cold-start (first render spins the worker) + warm render time.
5. **Decision gate:** acceptable bundle size + runs under CSP offline → GO. Record numbers here.

## Approach (if GO)
1. **Vendor** the TeaVM `plantuml.js` (pinned PlantUML SHA) + **`@viz-js/viz`'s
   `viz-global.js`** into `media/` + a `build.mjs` copy step (Lute pattern). Lazy-loaded —
   **not** in `main.js`.
   - **Shared Viz.js opportunity (coordinate with [task 94](94-graphviz-theme-pairing.md)):**
     PlantUML's `viz-global.js` IS the maintained `@viz-js/viz` (our graphviz still runs the
     dead mdaines line). Once vendored here, **repoint `graphvizRender` onto the same
     `viz-global.js`** (`Viz.instance().then(v => v.renderSVGElement(dot))`) and drop the old
     `viz.js` + `full.render.js`. One Viz.js for both PlantUML + graphviz: smaller, maintained,
     one dependency. Graphviz's DOT-attr theming (task 94) is engine-agnostic, so it's unaffected.
2. **Replace vditor's `plantumlRender`** (esbuild patch, or a `media-src/src/plantuml-render.ts`
   the preview pipeline calls): when a `.language-plantuml` block exists, lazy-import the
   engine, `renderToString(code, …)` per block, inject the returned **inline SVG**. No
   `<object>`, no `plantuml.com`, no CDN.
3. **CSP**: inline SVG needs only what we already allow (`style-src 'unsafe-inline'`); the
   engine is same-origin (webview root) — **no external host added**. Confirm worker-src
   (`blob:`, present) covers the engine's internal worker.
4. **Theme pairing**: pass `{ dark: mode === 'dark' }` from the resolved editor/content-theme
   mode → diagrams follow light/dark (extend later to the task-86 palette story if wanted).
5. **Setting**: `vmarkd.plantuml.enabled` (default **on**, per "renders out-of-the-box";
   engine lazy-loads on first plantuml block). No server/URL/remote setting.

## Tests (per AGENTS)
- **Spike harness** → kept as the size/perf record (numbers in this file).
- **e2e** (`media-src/e2e/`): a `@startuml` block renders to an inline `<svg>` within a
  timeout; **no network request** occurs (assert via route interception — neither
  `plantuml.com` nor `leaningtech.com`); CSP doesn't block it; `{dark}` flips colours.
- **Unit**: block-detection + lazy-load gate (don't load the engine when no plantuml block).

## License / attribution
- PlantUML (incl. the TeaVM build) is **GPL/LGPL/MIT-triple-ish — verify**: PlantUML core is
  **GPL/LGPL/Apache/MIT** depending on the part; confirm the TeaVM-built artifact's effective
  licence before shipping (the renderer is the standard PlantUML codebase). Vendor its
  LICENSE/NOTICE in a shipped `media/` path (Lute pattern). **Flag for the spike.**
- No CheerpJ → no Leaning Technologies licence concern.

## Rejected / fallback designs (recorded)
- **CheerpJ (`plantuml-core`/`plantuml.js`)** — runtime CDN-locked + not self-hostable
  (`LICENCE-CHEERPJ.md`) → breaks offline/local-only + needs an external CSP host. Rejected.
- **Remote `plantuml.com` / configurable server** — rejected by the user (local-only). Kept as
  a fallback only if the TeaVM artifact proves too large or won't run under our CSP.

## See also
- Task 86 (mermaid theme pairing — same "renderer follows theme?" audit; `{dark}` here is the
  analogue), task 67 (CSP: `object-src 'none'` blocks the current remote `<object>`), task 66
  (Lute vendoring pattern — pin + build-once + vendor + license).
- `plantuml/plantuml` → `teavm.sh`, `src/main/java/net/sourceforge/plantuml/teavm/`,
  `src/main/resources/teavm/GITHUB_INTEGRATION.md`; vditor `plantumlRender.ts`.
