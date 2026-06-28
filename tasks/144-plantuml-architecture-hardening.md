# Task 144 — PlantUML architecture hardening (patch→module, theming robustness)

> **Status:** ✅ DONE 2026-06-28 — all 6 items shipped (items 1-4 on 2026-06-27; items 5-6 on
> 2026-06-28). Created 2026-06-24 from a software-architecture review of the offline PlantUML pipeline
> (task 87).
>
> **🟢 Items 5-6 DONE 2026-06-28 (re-verified: plantuml + graphviz specs green):**
> - **6 (relocate shared viz-global.js):** moved the shared `@viz-js/viz` asset out of
>   `media-src/vendor/plantuml/` into its own neutral `media-src/vendor/viz/` (own `source.json` +
>   `LICENSE`); added a `viz` entry to `VENDORED_ASSETS` (ships to `media/vditor/dist/js/viz/`), dropped
>   it from the plantuml entry. Both `plantuml-render.ts` + `graphviz-render.ts` now load
>   `dist/js/viz/viz-global.js`. Kills the hidden coupling (removing/restructuring plantuml no longer
>   breaks graphviz). `vendored-licenses.test.ts` copyleft guard extended with the `viz` dir.
> - **5 (immutable tag):** re-pinned plantuml.js from the **mutable `snapshot` tag** (rolling
>   pre-release, `1.2026.7beta3` — a re-fetch could 404 / drift) to the **stable, immutable
>   `v1.2026.6`** release tag (latest stable shipping the TeaVM `js-plantuml` zip). New sha
>   `48bf2790…`. viz-global.js in v1.2026.6 is **byte-identical** to the snapshot copy (same
>   `@viz-js/viz`, sha `ef2cd8a0…` unchanged) → graphviz engine untouched; only plantuml.js changed.
>   The stable skin still uses the same default colours, so the named-constant theming + plantuml.spec
>   pass unchanged (the version downgrade beta3→.6 is render-safe, verified).
>
> **🟢 Items 1-4 DONE 2026-06-27 (render output identical; unit + real-VS-Code verified):**
> - **1 (patch→module):** the ~75-line `patchPlantumlRender` string + the ~60-line `patchGraphvizRender`
>   string are now thin shims that re-export from real, typed, lint+unit-tested modules
>   `media-src/src/plantuml-render.ts` (`plantumlRender` + `themePumlSvg`) and `graphviz-render.ts`
>   (`graphvizRender` + `themeGraphvizSvg`). The modules import NO Vditor internals (the trivial
>   adapter `getElements`/`getCode` are inlined as `querySelectorAll(".language-*")` / `textContent`;
>   script loading uses the shared `loadScript` from task 152) so the theming logic is jsdom-testable.
>   The anchor-drift asserts stay in the shims (still fail the build loudly on a Vditor bump).
> - **2 (named colours + render test):** the default-skin colours are named constants
>   (`PUML_FOREGROUND`/`PUML_BOX_FILL`/`PUML_TRANSPARENT`; `GV_FOREGROUND`/`GV_BG_FILL`) — a future
>   PlantUML/Viz default change is greppable + caught by the new tests, not a silent miscolour. New
>   unit tests `plantuml-render.test.ts` + `graphviz-render.test.ts` assert the SVG foreground →
>   `currentColor`, box fills flattened, transparent bg removed, idempotent. New real-VS-Code spec
>   `plantuml.spec.ts` (the task-141 render test) asserts the rendered `<svg>`'s foreground resolves to
>   the theme fg (not baked black) on dark; `graphviz.spec.ts` still green.
> - **3 (no innerHTML reparse):** theming is now a pure DOM walk (`querySelectorAll` + `setAttribute`),
>   no `container.innerHTML = …replace(…)` serialize→reparse; graphviz appends the live SVG node.
> - **4 (observer de-race):** the MutationObserver + 5000ms fallback now share a `themed` guard flag so
>   the fallback can't double-theme, and the magic `5000` is commented (per `.claude/rules/ts.md`). The
>   TeaVM `render()` exposes no completion promise, so the observer stays (documented).
>
> **Source:** architecture review (2026-06-24).
> **Value / Risk:** 🟢 removed the biggest maintainability debt + closed the "subtly-wrong" theming
> traps / low — pure refactor + tests, render output stayed identical (verified).

## Context — what was reviewed
Offline PlantUML (task 87) = pre-built TeaVM JS vendored under `media-src/vendor/plantuml/`
(`plantuml.js` 7.2M + shared `viz-global.js` 1.4M), sha256-pinned in `source.json`, verified at build
time by `syncPlantuml()` (`build.mjs:408`). Vditor's `plantumlRender.ts` is rewritten at bundle time
by `patchPlantumlRender` (`media-src/esbuild-shared.mjs:912`); live re-theme via
`reRenderPlantuml` (`media-src/src/plantuml-retheme.ts`), wired in `main.ts:1101`
(`reThemePlantumlGraphviz`). CSP `object-src 'none'` (`src/html-builder.ts:49`) is the boundary that
killed the original remote `<object>`.

**What's already good (do NOT regress):** sha256 supply-chain pin + fail-loud build verify;
anchor-asserted patch that throws a named error on Vditor version drift; lazy-load (no main-bundle
cost); `currentColor` theme-agnostic model; offline/privacy via local inline SVG.

## Findings → work items (by priority)

### 1. 🟢 Extract the patch body from a string into a real TS module — DONE 2026-06-27 (plantuml + graphviz)
`patchPlantumlRender` returns a **~75-line JS string** that replaces the entire Vditor function
(`esbuild-shared.mjs:922-997`). Consequences: not type-checked, not lintable, not unit-testable as
code; escaped regex (`\\r\\n`) is a footgun; lazy-load + render + theming + error-handling are all
inlined in one template literal.
- **Fix:** move the runtime logic to a real `media-src/src/plantuml-render.ts` (exports
  `plantumlRender` + `themePumlSvg`). The esbuild patch becomes a thin shim that imports and
  re-exports it — keep the anchor assertion for drift detection. Result: typed, linted, unit-tested.
- **Graphviz has the IDENTICAL problem** (`patchGraphvizRender`, `esbuild-shared.mjs:786-846`) — apply
  the same extraction (`graphviz-render.ts`) in this task or a sibling, so the two share the pattern.

### 2. 🟢 Name the skin colours + add a render test (anti "subtly-wrong") — DONE 2026-06-27
`themePumlSvg` hardcodes PlantUML's default-skin colours (`#181818 #000000 #E2E2F0 #222222 #00000000`,
opacity `0.06`) inline (`esbuild-shared.mjs:933-951`). The dep is a **beta snapshot**
(`1.2026.7beta3`); if PlantUML changes its default skin the diagram still renders but in the **wrong
colours** — a silent failure, exactly what the faithful-by-construction rule forbids. No test asserts
the output actually contains `currentColor`.
- **Fix:** lift the colours to named constants in the new module; add a render test (extends
  [task 141](141-plantuml-render-tests.md)) asserting the rendered SVG's foreground became
  `currentColor` and the participant-box fill was flattened.

### 3. 🟢 Replace the `innerHTML` serialize→reparse in theming — DONE 2026-06-27 (DOM walk)
`themePumlSvg` does `container.innerHTML = container.innerHTML.replace(/(fill|stroke)=…/)`
(`esbuild-shared.mjs:932`) — a full SVG serialize + reparse on every theme pass (costly reflow on
large diagrams, drops listeners), then switches to DOM-API for `rect`/`text` in the same function.
- **Fix:** do all of it via DOM walk (`querySelectorAll` + `setAttribute`) — no reparse, one
  consistent style.

### 4. 🟢 Document / de-race the MutationObserver + 5s fallback — DONE 2026-06-27 (themed guard + comment)
Theming fires on first `<svg>` via a `MutationObserver`, with a `setTimeout(…, 5000)` fallback
(`esbuild-shared.mjs:984-989`). If the observer already ran, the timeout re-themes (harmless but
wasteful); a multi-mutation render could be themed half-built.
- **Fix:** if the TeaVM `render()` exposes a completion promise, await it instead. If it genuinely
  doesn't, keep the observer but guard the fallback with a "already themed" flag and **comment why**
  the magic `5000` exists (per `.claude/rules/ts.md`).

### 5. 🟢 Pin a stable release, not a mutable `snapshot` tag — DONE 2026-06-28 (v1.2026.6)
`source.json` pins `1.2026.7beta3` from the `snapshot` GitHub tag. sha256 protects integrity but the
**snapshot tag is mutable** → a rebuild can 404 / drift. Move to a stable PlantUML release tag (keep
the sha guard).

### 6. 🟢 Relocate the shared `viz-global.js` out of `plantuml/` — DONE 2026-06-28 (vendor/viz/)
Graphviz loads `…/dist/js/plantuml/viz-global.js` (`esbuild-shared.mjs:800`) — a hidden coupling:
removing/restructuring PlantUML breaks Graphviz, and the location is misleading. Move the shared
`@viz-js/viz` asset to a neutral `vendor/viz/` (update both patches + `build.mjs` sync).

## Out of scope (tracked elsewhere)
- Full **palette pairing** (accent/surface, beyond foreground currentColor) → [task 138](138-plantuml-theme-pairing.md).
- The standalone render e2e → [task 141](141-plantuml-render-tests.md) (item 2 extends it with a
  colour assertion).

## Tests (per AGENTS)
- **unit** — `plantuml-render.ts` `themePumlSvg` over a fixture SVG: asserts `#181818/#000000`→
  `currentColor`, participant fill flattened, transparent bg rect removed; idempotent on a second pass.
- **unit** — the existing anchor-drift test still passes (the shim keeps the anchor).
- **e2e** — extend [task 141](141-plantuml-render-tests.md): the rendered block contains `<svg>` whose
  foreground is `currentColor` (not raw `#181818`), in the real VS Code webview.

## See also
- Skill `vmarkd-renderer-theming` (model #3 self-contained SVG; the patch-registry + `data-code`
  re-render pattern). Task 87 (offline PlantUML/TeaVM), 138 (theme pairing), 141 (render tests).
- The patch-as-string + extraction concern applies equally to **graphviz** (`patchGraphvizRender`).
