# Task: Vditor `listToggle` upstream bugfixes (null-deref + sibling scope)

> **Status:** ⬜ Not started.
> **Source:** `Aloklok/vditor` fork (4 ahead, 0 behind) — pure bugfixes. See `out/vditor-co-aplikuje-raport.md` §1.1 and `out/vditor-forki-analiza.md` §4.
> **Value / Risk:** 🟢 fixes a real, reproducible bug in code we ship / low (string-replace patch, no behaviour change beyond the fix)

## Problem
We import Vditor from source (`media-src/src/main.ts:14`, `import Vditor from 'vditor/src/index'`), so we ship Vditor's `listToggle` verbatim — including two upstream bugs in
`media-src/node_modules/vditor/src/ts/util/fixBrowserBehavior.ts` (`listToggle`, ~line 178). Reachable from the list/checkbox toolbar buttons in both IR (`vditor/src/ts/ir/process.ts`) and WYSIWYG (`vditor/src/ts/wysiwyg/toolbarEvent.ts`).

1. **Null-pointer** (`fixBrowserBehavior.ts:230`): `item.querySelector("input").remove()` has no optional chaining. The `if (itemElement.querySelector("input"))` guard at `:228` only checks the *current* `<li>`, then the loop at `:229` iterates **all** siblings — a sibling `<li>` without a checkbox throws on `.remove()`.
2. **Affects all siblings** (`:229`, also the `check` branch at `:222`): `itemElement.parentElement.querySelectorAll("li")` mutates **every** `<li>` in the list instead of just the toggled one. Toggling one checklist item to a plain list strips checkboxes off its siblings too.

We have **zero** list-related patches of our own today.

## Goal
Toggling list type / checklist on one item affects **only that item**, and never throws when a sibling lacks a checkbox — without forking Vditor.

## Steps
1. **Reproduce first** (cheap): in a doc with a checklist where items are mixed, toggle list type on one item; confirm (a) the no-`<input>` sibling crash, and (b) siblings losing/gaining checkboxes. Capture a minimal repro doc.
2. **Patch via esbuild `onLoad`** in `media-src/esbuild-shared.mjs`, following the existing `fixDmpInterop` plugin pattern (it already string-rewrites a Vditor source file at bundle time). Add a `fixListToggle` plugin with `filter: /vditor[/\\]src[/\\]ts[/\\]util[/\\]fixBrowserBehavior\.ts$/` that:
   - adds optional chaining: `item.querySelector("input").remove()` → `item.querySelector("input")?.remove()`;
   - scopes the mutation to `itemElement` only (port Aloklok's fix: for `check`, add the checkbox just to `itemElement`; for list/ordered, detect task-siblings via `:scope > li` and split the current item into a new sibling `<ul>`/`<ol>` preserving `data-tight`, else operate on the single item).
   - Register the plugin in both `build.mjs` and `e2e/serve.mjs` paths (esbuild-shared is shared by both).
3. Keep the string-replace **anchored and minimal** so a Vditor version bump fails loudly (mismatch → no replacement) rather than silently mis-patching. Add a guard that throws if the expected source substring isn't found.

## See also
- `media-src/esbuild-shared.mjs` — `fixDmpInterop` / `stubUnusedVditorButtons` are the precedent for source-level patching.
- `out/vditor-forki-analiza.md` §4 (exact Aloklok commits `474336c1`, `eaf07e42`, `71e16a38`).

## Reported upstream (repro + verify these)
- Vditor **#460** — "checkbox is not working (Windows/Firefox)" — same checklist/`listToggle` area; reproduce and confirm our fix also covers it. https://github.com/Vanessa219/vditor/issues/460

## Verify
- Repro doc no longer crashes on toggle; toggling one item leaves siblings' checkboxes untouched (IR **and** WYSIWYG).
- Build (`node build.mjs`) succeeds; the patch-guard throws if `fixBrowserBehavior.ts` no longer matches (version-bump safety).
- Add a unit/e2e test covering the sibling-scope behaviour if feasible.
