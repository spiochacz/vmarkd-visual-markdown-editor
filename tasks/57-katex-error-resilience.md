# Task: KaTeX error resilience (`throwOnError: false`, `strict: false`)

> **Status:** ⬜ Not started.
> **Source:** `GongXunSS/vditor` (`feat-vscode`) — "Allow errors in katex". See `out/vditor-co-aplikuje-raport.md` §1.2.
> **Value / Risk:** 🟢 a malformed formula shows a red inline error instead of breaking render / very low (≈1 line of config)

## Problem
KaTeX is fully local (`media/vditor/dist/js/katex/…`, copied by `build.mjs:46-60`; engine `KaTeX` is Vditor's default and we never override it; MathJax is stripped at build, `build.mjs:64-68`, task 40). In our Vditor options we only set `preview.math.inlineDigit: true` (`media-src/src/main.ts:298-300`). We do **not** pass `throwOnError: false` / `strict: false`.

Result: a single invalid LaTeX expression can throw inside KaTeX rather than rendering the standard red inline error message — degrading the whole preview/IR render for one bad formula.

## Goal
Invalid math renders as KaTeX's inline error (red) and never throws; valid math is unchanged.

## Steps
1. `media-src/src/main.ts` (~`:296-306`, the `preview.math` block) — confirm how Vditor threads math options to KaTeX's `renderToString`. Vditor exposes math options under `preview.math`; verify whether `errorRender` / passing KaTeX options is supported in our pinned version (`vditor@3.11.2`).
2. Set the resilience options on the math config:
   - `throwOnError: false` and `strict: false` for KaTeX.
   - If our Vditor version doesn't forward these through `preview.math`, patch the KaTeX call site in `vditor/src/ts/markdown/mathRender.ts` via the esbuild `onLoad` pattern (see `media-src/esbuild-shared.mjs` `fixDmpInterop`), adding `strict:false, throwOnError:false` to `katex.renderToString(...)` — this is exactly what the GongXunSS fork did.
3. Keep `inlineDigit: true` as-is.

## See also
- `tasks/40-drop-unused-mathjax.md` (KaTeX is the sole engine).
- `out/vditor-forki-analiza.md` §3a (GongXunSS `mathRender.ts` `extPath` + allow-errors commit).

## Verify
Open a doc containing a deliberately broken formula (e.g. `$\frac{1}{$`) alongside valid math: the broken one shows the red KaTeX error inline, valid formulas render normally, and the rest of the document is unaffected. Toggle IR/WYSIWYG/SV.
