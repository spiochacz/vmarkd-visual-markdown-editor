# Task 100 — Bug: can't create `---` under `---`, and arrow-nav between two `<hr>` is stuck

> **Status:** 📋 TODO (bug, reported 2026-06-16). In IR/WYSIWYG, a thematic break (`---` →
> `<hr>`) is a block with **no editable text**, so the caret has nowhere to land between two
> adjacent rules. Two symptoms:
> 1. **Can't create a second `---` directly under an existing `---`** — typing `---` /
>    pressing Enter below a rule doesn't produce a new rule (or swallows it / merges).
> 2. **Arrow keys get stuck between two `<hr>`** — Up/Down can't move the caret past / between
>    adjacent rules (no landing paragraph), so you can't navigate or insert between them.
> **Source:** user report. **Value / Risk:** 🟢 nav/authoring correctness / low–medium —
> same class as the code-block/blockquote nav fixes; touch IR nav + a transient gap paragraph,
> not core Lute.

## Repro (real VS Code webview — likely won't repro in the Playwright harness)
1. New doc, IR mode. Type `---` Enter → one `<hr>`.
2. Try to add a second `---` on the line below the rule → fails / no new rule.
3. With two `<hr>` (separated by a blank line in source), put the caret above and press
   Down (and below, press Up) → caret can't sit between them / jumps past both.

## Likely cause (to confirm)
- `<hr>` is a void block: no text node for the caret. Vditor's IR doesn't splice a landing
  `<p>` between two voids, so there's nowhere to type the next `---` or rest the caret —
  mirrors the **code-block** trailing-paragraph / **blockquote↔code** gap-paragraph problems.
- Creating `---` under `---`: the second fence likely needs a transient empty paragraph
  between the rules (like `gap-paragraph.ts` for code blocks) so the `---` has a line to be
  typed on before Lute promotes it to a rule.

## Approach (investigate first — mirror the existing block-nav fixes)
- Reuse the pattern from [[codeblock-arrow-nav-empty-paragraph]] / `gap-paragraph.ts`
  (`observeGapParagraphs`, wired in `main.ts`) and the trailing-invariant work
  ([[codeblock-nav-no-empty-block]] / `endsWithBlock`): a **self-cleaning transient gap
  paragraph** adjacent to an `<hr>` so the caret can land + you can type the next `---`,
  reclaimed on `selectionchange` when left empty.
- Check whether `<hr>` needs the same treatment as code blocks in `endsWithBlock` (a doc
  ending in `<hr>` may need a trailing paragraph invariant too).
- Files to look at: `media-src/src/gap-paragraph.ts`, the IR nav helpers in `main.ts`, and
  any `insertAfterBlock`/`insertBeforeBlock` esbuild patches (cf. the table-IR-wrapper /
  EOF caret work, `fix-table-ir-wrapper`).
- Decide WYSIWYG vs IR scope (report is general — verify both).

## Verification
- Real-VS-Code e2e (xvfb) in `test/vscode-e2e/` — webview-only nav; the Playwright harness
  likely can't repro (same as the other caret-nav bugs). Add a `codenav`-style spec:
  create `---` under `---`, arrow Up/Down across two rules, assert caret lands between them
  and a new rule is produced. **Verify the final caret behaviour WITH THE USER.**
