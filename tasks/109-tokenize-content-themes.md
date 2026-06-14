# Task 109 — Tokenize content themes: converge github onto the `--vmarkd-*` model, cut `!important`

> **Status:** ✅ DONE. github-light + github-dark both tokenized (~23 KB → ~2–2.8 KB each), Primer
> heading scale restored, cross-mode VERIFIED — palette + treatments consistent across
> Preview/IR/WYSIWYG (incl. the code-block dual-node edit surface), `content-theme.spec` completeness
> contracts green for both. WYSIWYG inline-code h-padding fixed at the Vditor SOURCE
> (`build.mjs patchVditorIndexCss`, 0→.4em) and the now-redundant `main.css` `!important` removed.
> All five content themes now share ONE token model. Architecture recorded in ADR-0003.
> **Source:** CSS-simplification audit — too much `!important`/cascade-hacking.
> **Value / Risk:** 🟧 −~21 KB per github theme + theme-file `!important` (9→3) + ONE theme model /
> medium — github is the most-used theme; fidelity + regressions are visible.
> **Engines:** none (pure CSS + build).
>
> **Target (agreed 2026-06-13):** the GitHub *look* (palette + treatments) must be CONSISTENT across
> all three render surfaces — Preview pane, IR, WYSIWYG. **Spacing differences are ACCEPTED** (Vditor
> structure; even the verbatim github CSS diverged there — closing pixel spacing would be a separate
> effort overriding Vditor's block spacing scoped to the preview surface, deliberately out of scope here).
>
> **Premise correction (spike-verified):** tokenizing does NOT remove `main.css` `!important` — the
> github↔Vditor cascade-order war was already migrated to `var(--vmarkd-*)` in task 84/85. The
> remaining `main.css` `!important` are VS Code-default / IR / layout (not github referees). The win
> is the −21 KB/theme + model consistency, not a `main.css` purge.

## Problem (measured 2026-06-13)

Two incompatible theme models live in `media/markdown-themes/`:

| Theme | Model | Size | `!important` | Fights Vditor? |
|---|---|---|---|---|
| `github-markdown-{light,dark}.css` | full upstream github-markdown-css, **verbatim** | **~23 KB** (192 rules, 311 `.markdown-body` selectors, 73 raw hex) | 8–9 each | **yes** |
| `vscode-*`, `material-*` | **token**: a few deltas + `--vmarkd-*` vars | **~2 KB** (~30 lines) | 0–3 | **no** |

`.vditor-reset` carries the `.markdown-body` class, so three stylesheets hit it at once
(Vditor structural + Vditor content-theme + the theme file). The big github files restyle
*everything* under `.markdown-body`, colliding with Vditor's content-theme at equal specificity
(0,1,1) → `!important` in the github files AND in `main.css` (which then referees). The small
themes avoid this entirely: they **set `--vmarkd-*` tokens** that Vditor's content-theme +
`main.css` already read (build.mjs `varifyVditorPalette`, task 84/85) — their own comments say
"no `!important`, no `.vditor-reset` specificity tricks."

So the inconsistency *is* the problem, and the token model is the proven-good one.

## Goal

Rewrite `github-markdown-{light,dark}.css` in the **token model** (like vscode/material):
- set the existing `--vmarkd-*` palette vars to github's values (heading-border, hr, blockquote
  fg/border/bg, table border/row/stripe, inline-code bg — all already exist),
- add only the deltas github needs beyond Vditor's defaults (link colour, base text colour,
  inline-code colour, code-block bg + font-size),
- drop the ~23 KB verbatim upstream body.

Then remove the `!important` in `main.css` that existed only to referee github↔Vditor.
**Result:** one consistent theme model, ~2 KB per github theme, far less `!important`.

## Approach (spike first — this branch)

1. **Spike `github-markdown-light.css`** → token model. Diff github's look vs Vditor's content-
   theme default; keep only deltas. Measure `!important` removed (theme file + github-only ones in
   `main.css`). Build. Run `npm run test:visual` (the `@visual` goldens). Capture a before/after
   screenshot of a representative github-themed doc (headings + border, blockquote, table+stripe,
   inline code, code block, hr, lists) and eyeball fidelity.
2. **Decision gate:** if fidelity is acceptable (palette + key treatments on Vditor's structure —
   same bar as the vscode/material themes), repeat for `github-markdown-dark.css`; else keep the
   verbatim file and record why.
3. Remove the now-dead github-refereeing `!important` from `main.css` in small batches, re-running
   goldens + the numeric guards (`blockbg`/`codenav`/`width`) each batch.

## Trade-off (explicit)

The verbatim github-markdown-css aims for **pixel-perfect** GitHub rendering. Tokenizing trades
that for **github palette + key treatments on Vditor's structure** — the same fidelity bar the
vscode/material themes already meet and that looks right. This is a deliberate "good-enough
fidelity for an editor preview" decision. If pixel-perfect GitHub is required, keep the big file.

## Verify

`github-markdown-light.css` ≈ 2 KB (from ~23 KB); `!important` count down (theme + main.css);
`npm run test:visual` green (or accepted/intended diffs); a github-themed doc renders correctly in
the **real VS Code webview** (theme leaks + VS Code default CSS only reproduce there); build +
`lint:ci` clean.

## See also

- `tasks/40-drop-unused-mathjax.md`, `tasks/84/85` (the `--vmarkd-*` palette tokenization the small
  themes already use), `build.mjs` `varifyVditorPalette`.
- **Follow-up (separate):** CSS cascade layers (`@layer`) to fix the remaining order/specificity
  refereeing globally — complements this; do AFTER tokenization (fewer conflicts left to referee).
- Skills: `vmarkd-renderer-theming` (three theming models, cascade traps), `vmarkd-visual-debugging`
  (golden screenshots + real-vscode suite — the safety net for this).
