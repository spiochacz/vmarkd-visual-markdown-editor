# Task 178 — Unified validation/render-error box for ALL diagram engines

**Status:** DONE (2026-06-29). Shipped + installed; unit + real-VS-Code e2e green. Medium.
**Source:** user request (2026-06-29) — "mermaid pokazuje błędy parsowania w niesformatowany sposób" → fixed for mermaid; "dodaj obsługę błędów parsowania do następnych diagramów" → generalized to every engine.

## What shipped (2026-06-29)

- **Shared box** `media-src/src/diagram-error.ts` (`renderDiagramError`/`diagramErrorHtml`/`diagramErrorTitle`):
  one themed `.vmarkd-diagram-error` box, escaped `<pre>` message, `data-render="1"` (Lute-invisible).
  CSS renamed `.vmarkd-mermaid-error*` → `.vmarkd-diagram-error*` (mermaid now uses the shared class).
- **TS-module renderers** call `renderDiagramError`: graphviz (was raw dump), plantuml (hard infra
  throw only — its own SVG syntax error stays), nomnoml + stl (were silent→blank, now box + set
  `data-processed` so the observer doesn't loop), wavedrom + vega (via a new optional `faithfulRender`
  `onError` → box; faithfulRender marks `data-processed` to stop the re-find loop), smiles (box via the
  smiles-drawer error callback — see the 2026-06-29 follow-up — with a `data-vmsmilesErr` signature
  guard against the observer loop).
- **Native esbuild patches** (byte-identical inline markup, anchored + drift-throw): `patchMermaidErrorRender`
  (rewired to the shared class), `patchEchartsErrorBox`, `patchMindmapErrorBox`, `patchFlowchartError`
  (flowchart had NO catch — now wrapped; chained before `patchFlowchartTheme`). All in `VDITOR_TS_PATCHES`.
- **Rides the task-161 settle gate** (box renders on settle, not per-keystroke); `hasFreshRender`
  already treats the box as a terminal render → reveals immediately, no 3s wait.

### Follow-up fix (2026-06-29) — PlantUML diagram-type stickiness (separate bug, found while verifying)

**Symptom (user):** editing a PlantUML arrow into class syntax (`Alice -> Bob` → `Alice - Bob`, or
typing `.->`) flips the whole block to a **class diagram** (Alice/Bob as classes + the message labels
as associations) and it **never recovers** to the sequence diagram even after the source is valid again.

**Root cause (high confidence, reproduced + multi-agent diagnosed, wf_f9a87f0e-196):** the vendored
**TeaVM PlantUML engine carries sticky diagram-TYPE state across `render()` calls** on the ONE shared
module instance (`plantumlRenderFn` was cached once). Once it renders a class diagram, a later VALID
sequence source is misclassified as a class diagram. Proven deterministically: identical
`Alice -> Bob: Hello` renders as a SEQUENCE on a fresh engine but as a CLASS after the engine has
rendered a class; and STEP3 (`Hello`→`Helloo`) showed the engine DOES re-render the new source each
settle (label tracks the edit) — only the TYPE classification was stuck (so NOT a stale DOM / skipped
render / task-161 overlay — those were all falsified by the repro). Same root as the established
"2nd PlantUML block renders blank" finding (shared-engine poisoning, concurrency face).

**Fix:** `media-src/src/plantuml-render.ts` — the only reset lever is a fresh module instance (cache-
busted dynamic `import(\`${pumlUrl}?rev=${engineRev}\`)` → distinct URL → fresh statics). But re-
importing on EVERY render re-evaluates the ~7 MB module and **lags editing** (first attempt did this →
user reported "strasznie długi lag"). So we **reuse one cached engine** and re-import **only when the
diagram TYPE switches** (class↔non-class — the only thing that poisons it). Two pieces, both needed:
(1) `isClassSource(text)` — a CONNECTOR-based probe: a connector between two names containing a `.`
(`.->`/`..>`) or with NO arrowhead (`A - B`) is class; plain `->`/`-->` is sequence; + class keywords/
relations. (A naive "has `>` ⇒ not class" rule mis-classed `.->` → the user's 2nd "doesn't recover"
report; the connector rule fixes it.) (2) SAFETY NET: `engineLastClass` is corrected from the ACTUAL
render (the C/I/E/A class icon, `renderedIsClass`) in the observer — so a remaining heuristic misread
degrades to one extra reset (brief lag), never a stuck wrong diagram. Editing content (type unchanged)
reuses the engine → no lag; a type switch pays one re-import + recovers. Theming + task-161 debounce
untouched. Memory: re-imports (rare, only on type switches) aren't GC'd → bounded growth until reload.

**Tests:** unit `isClassSource` (6 cases: sequence/bare-assoc/explicit-class/relations/other/flip) in
`plantuml-render.test.ts`; real-VS-Code `test/vscode-e2e/plantuml-edit-recovery.spec.ts` (1:
sequence→class→sequence on one block recovers; 2: a class block + a sequence block both render the
correct type) + `fixtures/plantuml-multi-type.md`. `plantuml.spec.ts` (theme) still green; full vitest
1034, lint 7-parity, typecheck clean. (A vitest unit can't drive the real TeaVM engine headless, so the
engine reset itself is covered by the e2e; `isClassSource`/`injectPlantumlTheme`/`themePumlSvg` are
unit-covered.)

### Follow-up fix (2026-06-29) — malformed SMILES rendered NOTHING (error callback, not throw)

**Symptom (user):** a SMILES block with a malformed molecule (e.g. caffeine + a trailing lowercase
`f`: `CN1C=NC2=C1C(=O)N(C(=O)N2C)Cf`) rendered NOTHING — no diagram, no error. ("smiles przy takim
czyms nic nie wyswietla… leci tam jakis blad ktorym mozna wyswietlic?")

**Root cause (verified against the vendored bundle):** smiles-drawer's `draw()` does **NOT throw** on a
parse error — its signature is `draw(smiles, selector, theme, successCb, errorCb)` and internally it
does `try { drawMolecule(...) } catch(e){ errorCb ? errorCb(e) : console.error(e) }`. We called it with
only 3 args, so the parser error was swallowed to `console.error` and our `try/catch` in `repairSmiles`
**never fired** — leaving the empty `<svg>` we'd just inserted. (The parser DOES reject the input — the
old task-178 "too lenient to throw" finding was wrong: `Parser.parse("…Cf")` throws `Expected … but "f"
found.`, it's just never re-thrown out of `draw()`.)

**Fix** (`media-src/src/smiles-render.ts`): pass the 5th-arg error callback to `draw()`; it fires
**synchronously** (parse + draw are sync) → record `vmsmilesErr` + `renderDiagramError(code,'smiles',e)`
→ the shared themed box. Kept the outer `try/catch` as belt-and-braces. The `data-vmsmilesErr`
signature guard (re-attempt only when the source changes) prevents the box-render mutation from looping
the observer. Updated the `declare class SmiDrawer` to the wider signature.

**Tests:** unit `smiles-render.test.ts` (+2: box rendered for a malformed SMILES via the error callback;
no observer loop — same source + box → skipped; RED-checked: both FAIL on the 3-arg call). Real-VS-Code
`smiles-render.spec.ts` (+1) + `fixtures/smiles-error.md`: a malformed SMILES shows the `SMILES`-titled
`<pre>` box, `svgPresent:false` (not the silent empty svg), `inSource:0`, source round-trips. Full
vitest 1062, lint 7-parity, typecheck clean. `diagram-errors.spec.ts` header comment corrected.

### Deliberate scope boundaries
- **geojson / topojson** keep the **source visible** on bad JSON (decision in plan item 5 — the bad
  JSON is the useful feedback), no box.
- **d2**: a COMPILE error now shows the shared box with d2's own message (like mermaid; user-requested
  2026-06-29) — `renderDiagramError(wrapper,'d2',res.error)`. A WASM boot/timeout still keeps the source
  visible (infra, not the user's syntax), and a valid-but-unsupported SHAPE keeps the source+note (that's
  not an error). Asserted in `diagram-errors.spec.ts` (the `## d2` block).
- **math (KaTeX, ◑)** keeps its own inline red error (`throwOnError:false`, task 57) — already readable,
  not part of the "raw dump / silent" set; not converted.
- **smiles** — box now ASSERTED in the e2e via the smiles-drawer error callback (corrected
  2026-06-29; the old "too lenient to throw" note was wrong — see the follow-up below).
- **abc / markmap (✗)** can't meaningfully error — untouched.

### Tests
- Unit: `media-src/src/diagram-error.test.ts` (escape/title/`<pre>`/Error-instance — 100% cover);
  `test/backend/vditor-source-patches.test.ts` (+ echarts/mindmap/flowchart patches + mermaid class
  rename + drift-throws); `edit-activity.test.ts` (+2: `deferIrDiagramRender` SKIPS the render for a
  cached diagram lang while `isTyping()` → the box can't strobe mid-keystroke, and renders on settle).
  Full suite 1028 green, lint 7-parity-only, typecheck clean.
- Real-VS-Code e2e (`test/vscode-e2e/diagram-errors.spec.ts`):
  1. broken-fixture (`fixtures/diagram-errors.md`) — graphviz/echarts/flowchart/vega/wavedrom/nomnoml
     each show a titled `<pre>` box, no raw dump, never in the editable source.
  2. settle-gate (`fixtures/diagram-error-settle.md`) — a VALID graphviz, broken by REAL keyboard
     typing into its IR source (proven d2-edit-perf caret pattern), shows the box AFTER the edit
     settles via Vditor's real spin and the box REPLACES the live SVG (`svgLeft:0`), never in source.
  `mermaid-error.spec.ts` updated to the shared class, still green.
- Finding (CORRECTED 2026-06-29): the original "smiles-drawer is too lenient to throw" was wrong — it
  DOES reject malformed input, but its `draw()` catches the parser error internally and routes it to a
  5th-arg error callback (else `console.error`); without the callback we got a silent empty `<svg>`.
  See the follow-up below — the box is now e2e-asserted in `smiles-render.spec.ts`.
**Value / Risk:** 🟨 medium (consistent, readable validation feedback across all diagrams; today it's either an unformatted raw dump or silent nothing) / 🟢 low (per-engine catch rewrites + a shared box; preview-only, never serialized).
**Engines:** all (mermaid done; echarts, mindmap, graphviz, plantuml, math/KaTeX, d2, smiles, wavedrom, nomnoml, vega, geojson, topojson, stl, flowchart, abc, markmap).

## Premise — the mermaid precedent (already shipped, generalize it)

The mermaid parse-error UX was just fixed: `suppressErrorRendering: true` + an esbuild patch
(`patchMermaidErrorRender`, `esbuild-shared.mjs`) replaces Vditor's raw dump with a compact themed
**`.vmarkd-mermaid-error`** box — escaped message in a `<pre>` (preserves newlines + the caret
diagram), null-safe, lives in the `data-render="2"` preview (Lute-invisible), styled in
`media-src/src/main.css`. **This task generalizes that box to every engine.**

## Problem — the current per-engine landscape (audited 2026-06-29)

Whether an engine can even *report* a validation error governs the scope. **Reports errors?** —
✅ throws a hard parse/validation error (box applies) · ◑ renders its OWN error, doesn't throw (box
optional — catch only the hard throws) · ✗ effectively can't error / always renders (skip). Current
behaviour is then inconsistent: raw unformatted dump, silent nothing, or raw source.

| Engine | Reports errors? | Current behaviour | Where |
|---|---|---|---|
| **mermaid** | ✅ parse error | ✅ clean themed box | `patchMermaidErrorRender` (done) |
| **graphviz** | ✅ invalid DOT | ❌ raw `graphviz render error: <br>` dump | our `graphviz-render.ts:120-121` (+ native `graphvizRender.ts:39`) |
| **d2** | ✅ compile error | ◑ source + note ("d2: … — showing source") + `data-d2-error` | `custom-diagrams.ts:~346-363` |
| **echarts** | ✅ parse spec / `setOption` | ❌ raw `echarts render error: <br>` dump | native `chartRender.ts:31-33` |
| **mindmap** | ✅ `setOption` (rare) | ❌ raw `mindmap render error: <br>` dump | native `mindmapRender.ts:67-69` |
| **vega / vega-lite** | ✅ invalid spec | ⚠️ silent catch → blank | `custom-diagrams.ts` (per-engine catch) |
| **wavedrom** | ✅ bad WaveJSON | ⚠️ throw leaves the raw source visible | `custom-diagrams.ts:245` |
| **nomnoml** | ✅ bad syntax | ⚠️ silent catch → blank | `custom-diagrams.ts` (per-engine catch) |
| **smiles** | ◑ invalid SMILES — error via callback, NOT a throw (corrected; see follow-up) | ⚠️ silent → blank svg, no feedback | `smiles-render.ts` |
| **flowchart** | ✅ parse error | ⚠️ no catch → uncaught throw possible | native `flowchartRender.ts:20` |
| **geojson / topojson** | ✅ `JSON.parse` (bad JSON) | ⚠️ silent catch → leave source / blank | `custom-diagrams.ts` (per-engine catch) |
| **stl** | ✅ bad ASCII STL | ⚠️ silent catch → blank | `custom-diagrams.ts:~791` |
| **plantuml** | ◑ own red "syntax error" SVG (throws only on boot/encode) | ❌ raw `plantuml render error: <br>` (infra only) | our `plantuml-render.ts:165-167` |
| **math (KaTeX)** | ◑ own red inline error (`throwOnError:false`, task 57) | ❌ raw `e.message` (secondary catch) | native `mathRender.ts:64` |
| **abc** | ✗ lenient — renders partial, warnings not throws | no catch | — |
| **markmap** | ✗ any outline is valid | no catch | — |

So a typo gives you **unformatted red text** (echarts/mindmap/graphviz/plantuml/math), **nothing at
all** (smiles/nomnoml/vega/geojson/topojson/stl), or the raw source (wavedrom) — depending on which
diagram you typed.

**Scope from the capability column:** the box targets the **12 ✅ engines** (turn raw dump / silence
into a clean box; mermaid done, so 11 to do). The **2 ◑ engines** (plantuml, math) keep their own
rendered error — apply the box only to their hard (boot/encode/secondary) throws, don't fight their
inline error. The **2 ✗ engines** (abc, markmap) are skipped — they can't meaningfully error. The
goal is **one clean, themed validation-error box everywhere an engine actually reports an error**.

## Goal

Every diagram, on a parse/validation/render error, shows the same compact themed box: engine name +
the engine's error message (escaped, newline-preserving `<pre>`), instead of a raw dump or silence.

## Plan

1. **Shared box helper + CSS** — generalize the mermaid box into a reusable
   `renderDiagramError(el, engine, message)` (new `media-src/src/diagram-error.ts`) that builds the
   `.vmarkd-diagram-error` markup (escape `&`/`<`/`>`, `<pre>` body, title = engine). Rename
   `.vmarkd-mermaid-error` → **`.vmarkd-diagram-error`** in `main.css` (keep mermaid's box pointing at
   the shared class). Expose it as `window.__vmarkdDiagramError` so the native esbuild patches can call
   it without bundling.
2. **Custom renderers** (`custom-diagrams.ts` + `smiles-render.ts`, `graphviz-render.ts`,
   `plantuml-render.ts`) — replace each raw-dump / silent / leave-source catch with
   `renderDiagramError(el, '<engine>', String(err))`. Keep **d2's** richer source+note fallback (it's
   intentional — show the source so the user can fix it; just align the note to the box's styling, or
   leave as-is).
3. **Native Vditor renderers** (`chartRender.ts` echarts, `mindmapRender.ts`, `mathRender.ts`, and
   `flowchartRender.ts` — wrap its render in a catch) — esbuild patches mirroring
   `patchMermaidErrorRender`: rewrite each `e.innerHTML = "X render error: <br>" + error` to
   `window.__vmarkdDiagramError(e, 'X', error)`, anchored + drift-throw. (graphviz/plantuml are already
   our modules via `patchGraphvizRender`/`patchPlantumlRender` — edit the module, not a new patch.)
4. **Don't flash errors while typing** — the box should appear on **settle**, not mid-keystroke
   (a half-typed diagram is "invalid" on every keystroke). Render is already debounced per task 161
   (edit-activity `isTyping` gate); confirm the error path rides that gate too (don't bypass it) so the
   box doesn't strobe during editing.
5. **Decision per silent engine** — show the box (feedback) vs keep "show source". Recommend the box
   for hard parse errors (smiles/nomnoml/vega/wavedrom), but keep the **source visible** for
   geojson/topojson (`JSON.parse` failure → showing the bad JSON is useful). Resolve while implementing.

## Constraints
- **Escape** the message (`&`/`<`/`>`) — engine errors echo user source; an unescaped `<` injects HTML.
- **`<pre>` + `white-space:pre`** to preserve multi-line errors (the user's exact complaint) + caret
  diagrams; horizontal-scroll, don't blow the `width:100%` diagram layout.
- **Null-safe** — never assume the engine left a DOM node to read (the mermaid bug: `errorElement`
  was null with `suppressErrorRendering`).
- **Preview-only / Lute-safe** — the box lives in the `data-render="2"` preview half; never the
  editable source, never serialized (round-trip byte-identical). Theme-var driven (`--vscode-*`), no
  palette interaction.
- **Native patches** carry an anchor-drift `throw` (fail the build loudly on a Vditor bump), like
  every patch in `VDITOR_TS_PATCHES`; add each to `vditor-source-patches.test.ts`.
- Keep d2's source-fallback (richest); don't regress it.

## Verification (per AGENTS.md — real-VS-Code e2e MANDATORY for renderer behaviour)
- **Unit:** each new esbuild patch (anchor found, rewrite shape, drift-throw) in
  `test/backend/vditor-source-patches.test.ts`; `renderDiagramError` escaping + `<pre>` (jsdom unit).
- **Real-VS-Code e2e** (`test/vscode-e2e/`, headless `xvfb-run -a`): a fixture with a deliberately
  **broken** block per engine family (echarts / d2 / graphviz / plantuml / smiles / vega / wavedrom /
  geojson) → assert `.vmarkd-diagram-error` (title = engine, `<pre>` message, non-empty), **no** raw
  `"… render error:"` text, **no** silent-blank. Extend the existing `mermaid-error.spec.ts` pattern;
  reuse `fixtures/`. Confirm the box does **not** appear mid-typing (settles only).
- `lint:ci` (7 parity warnings only) + `typecheck` + full vitest + Playwright green. Verify coverage.

## See also
- The mermaid precedent: `patchMermaidErrorRender` (`esbuild-shared.mjs`), `.vmarkd-mermaid-error`
  (`main.css`), `mermaid-error.spec.ts`, `mermaid-error.md` fixture — the box + test pattern to
  generalize.
- `custom-diagrams.ts` (custom-engine catches), `custom-renderer.ts`, `graphviz-render.ts`,
  `plantuml-render.ts`, `smiles-render.ts`; native `chartRender.ts` / `mindmapRender.ts` /
  `mathRender.ts` / `flowchartRender.ts`.
- ADR-0006 (diagram theming policy), task 161 (edit-debounce — the settle gate the box must ride),
  `vmarkd-renderer-theming` skill (the box CSS), `vmarkd-lute-features` skill (preview `data-render=2`
  is Lute-invisible). Validation-only MCP companion idea: task 111.
