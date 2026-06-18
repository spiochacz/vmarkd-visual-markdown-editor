# Task 111 — Diagram-syntax validation MCP server (headless, standalone)

**Status:** planned (spike-first — Node-feasibility audit + tool contract before building)

## Origin / motivation

We ship a large fleet of fenced-diagram renderers (mermaid, flowchart.js, graphviz,
abcjs, smiles-drawer, PlantUML, d2, vega/vega-lite, nomnoml, wavedrom, echarts,
markmap, geojson/topojson, stl, math). An AI assistant authoring markdown into one
of our documents has **no cheap way to check a diagram block is well-formed before
inserting it** — it finds out only when the block renders (or doesn't) in the webview.

Expose a small **MCP server** whose *only* job is syntax/compile validation of a
diagram block: `validate_diagram(lang, code) → { ok, errors[] }`. The consumer is an
LLM (e.g. Claude Code) closing the loop "I generated a `mermaid` block — is it valid?"
**No rendering, no images, no VS Code UI** — validation only.

## Why option C (standalone headless package), not A/B

Discussed 2026-06-18. Three shapes were on the table:

- **A — MCP inside the extension host (Node).** Simplest wiring, but couples the
  validator to the running extension and to VS Code's lifecycle; external clients
  (Claude Code, CI) can't reach it without a server anyway.
- **B — MCP that drives a hidden webview** to reuse the *exact* browser render path.
  Highest fidelity ("valid ⟺ renders 1:1") but heavyweight — webview lifecycle, far
  too much machinery for pure validation.
- **C — standalone headless npm package** bundling the validators, no VS Code
  dependency. **Chosen.** Runs from Claude Code / CI / cron headless; cleanest
  separation; can still **share parser code** with `media-src/src/*` so we don't fork
  logic. The cost is re-creating a slice of the browser environment in Node for the
  DOM-bound libs (see audit).

VS Code ≥1.101's `McpServerDefinitionProvider` only exposes a server to VS Code's own
LM; for an external client we need a stdio/HTTP server regardless — which C already is.
(A thin VS Code provider that *points at* the same package can be a later add-on.)

## Core problem: validators live in the browser, not Node

For almost all of these renderers there is **no separate linter** — "validate syntax"
means **"attempt to parse/compile and capture the error (with line/col where the lib
gives it)."** `mermaid.parse()` throws, the d2 WASM compile returns diagnostics,
viz.js throws, vega `compile()` throws, etc. So the server is a thin, per-lang
"compile, catch, normalize to `{line, col, message}`" wrapper. The real work is
**environment**: which libs run under plain Node, which need a DOM shim, which can't.

## Spike first — Node-feasibility audit (do this before committing)

Classify every lang we render (start from `CUSTOM_LANGS` / `custom-diagrams.ts` +
`media-src/vendor/*`). Expected buckets (verify, don't trust):

- **Pure JS/WASM, runs in Node out-of-the-box**: d2 (WASM — already booted under
  Node in `media-src/src/d2-wasm.test.ts`/vitest), vega + vega-lite (`compile()`),
  nomnoml (parse), wavedrom (WaveJSON parse), graphviz/viz.js (`viz-global.js`).
- **Needs a DOM shim (jsdom / linkedom)**: mermaid (`mermaid.parse()`), abcjs,
  markmap (markmap-lib). Doable but adds a shim layer + drift risk vs the real webview.
- **Check carefully**: PlantUML (TeaVM JS — does the *parse* path run without DOM?),
  echarts (validation = does `setOption` throw? needs a canvas/DOM stub), smiles-drawer.
- **Schema/JSON, trivial**: geojson/topojson (JSON + geometry shape), math (KaTeX
  `parse` with `throwOnError`), stl (ASCII grammar).

Output of the spike: a table `lang → {runtime: node|jsdom|unsupported, validator entry,
error-shape}`. v1 ships the green bucket; DOM-bucket langs land iteratively; anything
unsupported is **reported as `unsupported`, never a silent `ok`** (project rule:
no claiming validated when it isn't — see memory "always-thorough-and-proper").

## Tool contract (proposed)

```
validate_diagram(lang: string, code: string)
  → { ok: boolean,
      lang: string,
      supported: boolean,          // false ⇒ we have no validator for this lang yet
      errors: [{ line?, col?, message }],
      engine: string }             // e.g. "d2-wasm@…", "mermaid@…" (provenance)
```

- Optional companion: `list_supported_diagrams() → [{lang, runtime, engine}]` so the
  client can discover coverage instead of guessing.
- Strip the ```` ```lang ```` fence if the client passes a full block (accept both raw
  body and fenced).
- **Pure function, no network** (offline; same posture as our renderers). Heavy WASM
  (d2) lazy-loaded + cached across calls.

## Fidelity risk — the thing to guard

The danger of C is **drift**: the Node validator says OK but the webview won't render
(different lib version, missing DOM feature). Mitigations:

- **Pin the same versions** the webview ships (vendored `media-src/vendor/*` + the
  `?v=` pins) — ideally import the very same artifact.
- Per supported lang, a parity test: *the same snippet is valid in the MCP server **iff**
  it renders in the Playwright harness* (extend `media-src/e2e/custom-diagrams*`).
- Where a lib needs a DOM shim, assert the shim covers the parse path (not just "didn't
  throw on import").

## Scope / out of scope

- **In:** validation-only MCP (stdio first; HTTP optional), green-bucket langs in v1,
  DOM-bucket iteratively, `unsupported` honesty, version pinning, parity tests.
- **Out (for now):** rendering / returning SVG/PNG (that's the webview's job; a separate
  task if ever wanted), quick-fixes / autocorrect, a VS Code `McpServerDefinitionProvider`
  wrapper (later add-on once the package exists), semantic linting beyond compile
  (e.g. "this mermaid edge points at an undefined node" — only if the lib surfaces it).
- **Decide during spike:** standalone repo vs a `packages/` sibling here (code-sharing
  with `media-src/src/*` argues for in-repo); stdio vs HTTP default; how to share the
  vendored artifacts without duplicating them.

## Verification

- Unit: each lang's validator over fixtures — a known-good snippet → `ok:true, errors:[]`;
  a known-broken snippet → `ok:false` with a sensible `line`/`message`; an unsupported
  lang → `supported:false` (never a false `ok`).
- Parity: for every supported lang, valid-in-MCP ⟺ renders-in-harness (shared fixtures
  with `custom-diagrams.spec.ts`).
- Integration: MCP handshake + `validate_diagram` / `list_supported_diagrams` round-trip
  over stdio.
- `tsc` + `biome` + full vitest green; headless (no GUI, no VS Code) per AGENTS.md.
