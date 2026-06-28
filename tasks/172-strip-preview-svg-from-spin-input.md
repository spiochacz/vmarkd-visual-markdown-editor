# Task 172 — Strip the rendered preview SVG out of the spin input (the diagram-edit prize)

**Status:** TODO (medium; **MEASURE FIRST via a Node-Lute spike** before patching). The single best lever for typing inside a diagram source.
**Source:** vMark edit-responsiveness analysis (2026-06-28, workflow `wf_2c64003e-264`).
**Value / Risk:** 🟥 high *for diagram-source typing* (kills the residual stutter task 161 could not touch) / 🟡 medium (must keep the source `<code>` + `<wbr>` intact and prove byte-identical round-trip).
**Engines:** every SVG/canvas engine (mermaid, d2, graphviz, plantuml, echarts). Neutral for STL (source-text-dominated).

## Problem

On every keystroke inside a diagram block, `SpinVditorIRDOM` (`ir/input.ts:179`) is fed the block's
`outerHTML` (`ir/input.ts:134`, reassigned `:185`), which **embeds the previously-rendered
`.vditor-ir__preview` SVG/canvas** plus our injected `data-render="1"` keep-last overlay. Inside the
spin, `vditorIRDOM2Md` → `K.ParseHTML` **tokenizes that entire foreign DOM string** — and the
`data-render`/`svg`-namespace skip in the AST walker (`genASTByVditorIRDOM`, blob `@~1444697`:
`if("1"===c||"2"===c){return}; if("svg"===a.Namespace){return}`) happens **AFTER the parse**. So a
multi-thousand-node SVG is **fully tokenized every keystroke, then discarded** — contributing zero
bytes to the AST. This is **exactly the residual stutter task 161 documented but could not touch**
(task 161 deferred the engine *render*, not the *spin*; `tasks/161*.md:42-43` scopes the per-keystroke
re-spin explicitly out of scope).

The output is provably unaffected by emptying the preview: the code-block preview is rebuilt fresh
from the AST source tokens as an **empty `data-render="2"` placeholder** (blob `@2596625/@2609238`),
never copying the input render. `processCodeRender` then re-renders async (already deferred by
task 161).

## Plan

1. **Spike (do this FIRST — `lute-runs-in-node` recipe):** feed a real mermaid/d2/echarts block
   `outerHTML` **with** and **without** the rendered SVG/canvas-`<img>` to `SpinVditorIRDOM`:
   (a) assert **byte-identical** output, (b) **time the delta**. Patch only if `ParseHTML` +
   `adjustVditorDOM` is a meaningful fraction (say >30%) of the spin — for small-source/large-SVG
   families it should be; for STL it won't (leave STL as-is).
2. **If it proves out:** an anchor-guarded esbuild patch (drift-throw) just before `ir/input.ts:179`
   and `wysiwyg/input.ts:142`: empty the render children (`svg`/`canvas`/`img`) of each
   `.vditor-ir__preview` **and** our `.vmarkd-stale-overlay` (`data-render="1"`) in the assembled
   html string, keeping the source `<code>` as `firstElementChild` and the `<wbr>` in the source.

## Constraints
- Off-thread constraints do **not** apply — the spin stays on the main thread; only its **input
  shrinks**.
- **Keep the source `<code>` as the preview's `firstElementChild`** (`processCode.ts:66` reads
  `firstElementChild.className`) and the **`<wbr>` in the source `<code>`**, not the emptied preview
  (caret survives).
- During a typing burst the strip must also drop `edit-activity`'s `data-render="1"` overlay (an
  `<img>` base64 dataURL for canvas engines = a huge attribute value); `snapshotRenders` runs
  capture-phase **before** the spin, so coordinate ordering with `restoreOverlay`/`snapshotRenders`
  (it's safe — snapshot precedes the strip).
- Don't perturb `processCodeRender`'s `firstElementChild` contract or the `restoreOverlay` /
  `hasFreshRender` swap logic.
- **Byte-identical round-trip must be PROVEN by the spike, not assumed.**
- Helps ONLY diagram-source editing (prose/code blocks have no embedded render). STL is
  source-text-dominated → neutral.

## Verification
- The Node-Lute spike (byte-identical + timing delta) is the **gate**.
- **Real-VS-Code e2e (MANDATORY):** `test/vscode-e2e/d2-edit-perf.spec.ts` `blockingMs` before/after;
  a byte-identical round-trip unit test; the patch drift-guard in
  `test/backend/vditor-source-patches.test.ts`.
- `tsc` + `biome` + vitest + Playwright, headless. Verify coverage.

## See also
- Memory `diagram-edit-debounce` (the residual = this spin), task 161 (deferred the render only),
  the `vmarkd-lute-features` skill (`SpinVditorIRDOM`, `data-render`, the Node-Lute probe).
- Cheaper than, and the recommended fallback for, task 175 (full code-body spin-skip) — land this
  first; 175 only adds value if the GopherJS round-trip overhead itself (not just the SVG parse)
  proves material.
