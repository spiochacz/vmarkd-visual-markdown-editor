# 523 — the git gutter still misses tables

**Status:** 📋 OPEN — verified empirically, not fixed · **Impact:** 🟡 no gutter bar when you edit a
table, same class as the list gap · **Found:** 2026-08-13 while fixing the list half in
[task 516](516-qa-journey-coverage-plan.md).

## Symptom

Edit a table in a git-tracked document: the host computes the diff and posts it, but no
`.me-diff-marker` bar appears next to the table. Measured on a real table in real VS Code:
`bars: []` after a genuine edit.

## Why

Same mechanism as the list gap fixed in 516. `blockLineRange`
(`media-src/src/chrome/diff-markers.ts`) maps a rendered block back to source lines by finding its
text in the markdown. The fix for lists switched the input from `textContent` to `innerText`, which
renders `<li>`/`<tr>` as separate LINES — enough for lists, not for tables: `innerText` on a
`<table>` separates CELLS with **tabs**, giving `"a\tb\nc edited\td"`, which never appears in the
markdown's `"| a | b |"` row syntax. `indexOf` misses, `blockLineRange` returns null, the block is
skipped.

## Fix sketch

The per-line lookup needs a table-aware line form: build each row's expected source shape from the
cell texts (they appear in order within the row's markdown line) rather than matching the row line
verbatim — e.g. locate the row by its FIRST cell's text and confirm with the second, or match the
markdown line that contains all the row's cell texts in order.

Cheaper alternative worth measuring first: match on the first cell alone. Table rows are far more
likely to be unique by their leading cell than by their whole rendered line, and the existing
`BLOCK_SAMPLE` truncation already accepts that kind of approximation elsewhere.

## Coverage to add

`test/vscode-e2e/diff-gutter.spec.ts` covers the list case against a temp git repo it builds itself
(see its header). Add a table case there, and a pure-core unit case in
`media-src/src/chrome/diff-markers.test.ts` alongside the list one.
