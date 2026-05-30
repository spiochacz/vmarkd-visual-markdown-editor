# Task: Drop unused MathJax assets (~6.5 MB)

> **Source:** vMark performance audit (VSIX size) + research (Vditor defaults to KaTeX)
> **Value / Risk:** 🟧 ~6.5 MB install-size cut (biggest single asset win) / low —
> only while no MathJax engine is offered
> **Engines:** none

## Problem (measured 2026-05-30)
`media/vditor/dist/js/mathjax` is **6.5 MB** — the largest renderer asset shipped, and
the second-largest thing in the VSIX after `lute` (the required WASM core). It ships
only because `syncVditorAssets()` in `Foyfile.ts` copies **all** of
`node_modules/vditor/dist/js`.

Vditor's math engine is selectable via `preview.math.engine` (`'KaTeX' | 'MathJax'`).
The webview sets **no** engine, so Vditor defaults to **KaTeX** (~1.5 MB) and **never
fetches MathJax at runtime**. The 6.5 MB is pure dead weight in the package.

## Goal
Stop shipping MathJax while it is unused, without breaking math rendering (KaTeX), and
leave a clear guard so it's re-added if a MathJax option is ever introduced.

## Steps
1. **Confirm unused (do this first).**
   - `media-src` / `src` grep: no `engine: 'MathJax'`, no `mathjax` reference (none today).
   - Runtime: webview Network tab on a `$$…$$` document → KaTeX loads from the local
     cdn base, **no `mathjax` request** (ties to `39-lean-vditor-init.md` step 2).
2. **Exclude from the copy.** In `Foyfile.ts` `syncVditorAssets()`, skip
   `dist/js/mathjax` when copying `js` (copy selectively, or `rm` the `mathjax` dir
   right after the `cp`). Keeps both the repo working tree and the VSIX clean.
3. **Belt-and-suspenders:** also add `media/vditor/dist/js/mathjax` to `.vscodeignore`
   (overlaps `24-ci-cd-pipeline.md` §5) so a stray copy can't ship.
4. **Guard against regressions.** Add a comment in `syncVditorAssets` + in the webview
   init noting the KaTeX-only assumption: **if a `preview.math.engine` setting ever
   exposes MathJax, this exclusion must be reverted** (or made conditional on the
   chosen engine).
5. Rebuild (`foy build`) → repackage (`vsce package`) → confirm.

## See also
- `24-ci-cd-pipeline.md` §5 — broader VSIX hygiene (source maps, cruft); this is the
  single biggest item in it.
- `39-lean-vditor-init.md` — the math-engine / cdn-local runtime verification.

## Verify
The packaged `.vsix` is ~6.5 MB smaller (unpacked) and a few MB smaller zipped;
`$$ math $$` still renders correctly via KaTeX; the webview Network tab shows no MathJax
request.
