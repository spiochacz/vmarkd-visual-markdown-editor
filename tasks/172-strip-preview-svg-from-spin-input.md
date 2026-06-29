# Task 172 — Strip the rendered preview SVG out of the spin input (the diagram-edit prize)

**Status:** 🟢 READY TO PATCH — **Node-Lute spike DONE 2026-06-29, gate PASSED** (byte-identical
output + a ~190× timing delta; see *Spike results* below). Implementation (the esbuild patch + e2e)
is the remaining work. The single best lever for typing inside a diagram source.
**Source:** vMark edit-responsiveness analysis (2026-06-28, workflow `wf_2c64003e-264`); spike measured
2026-06-29 in response to the user report "jest nieakceptowalny lag podczas pisania".
**Value / Risk:** 🟥 high *for diagram-source typing* (kills the residual stutter task 161 could not touch) / 🟡 medium (must keep the source `<code>` + `<wbr>` intact and prove byte-identical round-trip).
**Engines:** every SVG/canvas engine (mermaid, d2, graphviz, plantuml, echarts). Neutral for STL (source-text-dominated).

## Spike results — gate PASSED (2026-06-29, `lute-runs-in-node` recipe)

Ran `SpinVditorIRDOM` directly on the same `media/vditor/dist/js/lute/lute.min.js` the webview loads,
with controlled block inputs (median of 30 iters, after 5 warm-up; Node V8). This is the per-keystroke
re-spin cost as a function of what's embedded in the edited block:

| edited block | input len | median / keystroke | p95 |
|---|--:|--:|--:|
| plain prose `<p>` | 109 | **0.63 ms** | 1.37 ms |
| list — 10 items | 1 054 | 2.40 ms | 6.85 ms |
| list — 40 items | 4 174 | 5.49 ms | 8.42 ms |
| list — 100 items | 10 414 | 13.29 ms | 18.04 ms |
| diagram block — ~200 svg nodes | 20 641 | 7.08 ms | 23.91 ms |
| diagram block — ~800 svg nodes | 83 641 | **27.34 ms** | 37.91 ms |
| diagram block — ~2000 svg nodes | 216 661 | **66.75 ms** | 91.65 ms |
| **diagram block — preview STRIPPED** | 265 | **0.35 ms** | 0.86 ms |

- **Cost ∝ input length, confirmed.** Plain prose is ~0.6 ms (the "already-optimized common case").
  The embedded rendered SVG is the entire amplifier: a realistic 800–2000-node diagram costs
  **27–67 ms PER KEYSTROKE** in the spin alone, before the engine even re-renders. That is the
  "nieakceptowalny lag".
- **Stripping the preview → 0.35 ms (≈190× / −99.5%).** Overwhelmingly passes the "patch only if
  ParseHTML is >30% of the spin" gate from the Plan.
- **Byte-identical proven (the risk gate):** for the same block with vs without the embedded SVG,
  BOTH `VditorIRDOM2Md` (what gets SAVED → `"graph TD; A-->B;\n"`) AND the full `SpinVditorIRDOM`
  output are **identical strings**. The embedded render contributes zero bytes — emptying it cannot
  change output. ⇒ the strip is provably safe (do still re-assert in the unit test + real e2e).
- **Conservative:** these are Node V8 numbers. The webview adds the `blockElement.outerHTML = html`
  reparse + relayout on top per keystroke, so real-world is *worse* than the table — the win is too.
- **List-widening (task 177) is the secondary, smaller axis:** a 100-item list is ~13 ms/keystroke
  (this task does NOT touch it — lists embed no render; that's task 177).

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

1. ✅ **Spike DONE (2026-06-29)** — `lute-runs-in-node` recipe, results table above. Byte-identical
   output confirmed (save + spin), timing delta ≈190× (66.75 → 0.35 ms). Gate (>30% of spin) passed
   overwhelmingly. STL left out of scope (source-text-dominated → embedding no render, neutral).
2. **Implement (the remaining work):** an anchor-guarded esbuild patch (drift-throw) just before `ir/input.ts:179`
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
- ✅ The Node-Lute spike (byte-identical + timing delta) — the **gate** — is DONE and PASSED (see
  *Spike results* above). Remaining verification below is for the implementation itself.
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
